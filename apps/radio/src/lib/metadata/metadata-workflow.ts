import { captureError } from "@avoid.quest/error";
import {
  type StreamUrlValidationFailure,
  validatePublicStreamUrl,
} from "@/lib/proxy/url-policy";
import {
  getCachedRadioMetadata,
  getRadioMetadataCacheKey,
  RADIO_METADATA_FAILURE_TTL_MS,
  RADIO_METADATA_SUCCESS_TTL_MS,
  RADIO_METADATA_UNSUPPORTED_TTL_MS,
  setCachedRadioMetadata,
} from "./cache";
import {
  tryAirtimeLiveInfo,
  tryNtsLiveApi,
  tryRadioBlackoutApi,
} from "./external-providers";
import {
  getIcecastStatusUrl,
  normalizeIcecastSource,
  parseIcecastStatusResponse,
  selectIcecastSource,
} from "./icecast-status";
import {
  normalizeIcyMetadata,
  parseIcyMetadataBlock,
  parseIcyMetaInt,
  readFirstIcyMetadataBlock,
} from "./icy-parser";
import type { RadioMetadataErrorCode, RadioMetadataResponse } from "./types";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type RadioMetadataWorkflowContext = {
  origin: string;
  request: Request;
  requestId: string;
};

type RadioMetadataWorkflowDependencies = {
  captureError?: typeof captureError;
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const EXTERNAL_METADATA_PROVIDERS = [
  tryNtsLiveApi,
  tryRadioBlackoutApi,
  tryAirtimeLiveInfo,
];

function errorResponse(
  code: RadioMetadataErrorCode,
  message: string
): Extract<RadioMetadataResponse, { ok: false }> {
  return { ok: false, error: { code, message } };
}

function ttlForResponse(response: RadioMetadataResponse): number {
  if (response.ok) {
    return RADIO_METADATA_SUCCESS_TTL_MS;
  }
  return response.error.code === "RADIO_METADATA_UNSUPPORTED"
    ? RADIO_METADATA_UNSUPPORTED_TTL_MS
    : RADIO_METADATA_FAILURE_TTL_MS;
}

function jsonResponse(
  response: RadioMetadataResponse,
  origin: string,
  requestId: string,
  status = response.ok ? 200 : 400
): Response {
  return Response.json(response, {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Cache-Control": "private, no-store",
      "x-request-id": requestId,
    },
  });
}

function statusForError(code: RadioMetadataErrorCode): number {
  switch (code) {
    case "RADIO_METADATA_URL_REQUIRED":
    case "RADIO_METADATA_INVALID_URL":
    case "RADIO_METADATA_INTERNAL_ADDRESS":
      return 400;
    case "RADIO_METADATA_TIMEOUT":
      return 504;
    case "RADIO_METADATA_UPSTREAM_ERROR":
      return 502;
    case "RADIO_METADATA_UNSUPPORTED":
      return 200;
    default:
      return 500;
  }
}

function validationErrorForReason(
  reason: StreamUrlValidationFailure
): Extract<RadioMetadataResponse, { ok: false }> {
  switch (reason) {
    case "required":
      return errorResponse(
        "RADIO_METADATA_URL_REQUIRED",
        "URL parameter is required"
      );
    case "internal-address":
      return errorResponse(
        "RADIO_METADATA_INTERNAL_ADDRESS",
        "Internal addresses are not allowed"
      );
    case "invalid-url":
    case "invalid-protocol":
      return errorResponse("RADIO_METADATA_INVALID_URL", "Invalid stream URL");
    default: {
      const exhaustive: never = reason;
      throw new Error(
        `Unsupported stream URL validation reason: ${exhaustive}`
      );
    }
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (!response.body) {
    return;
  }
  try {
    await response.body.cancel();
  } catch {
    // Some runtimes lock the stream once read/cancel has already happened.
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

class RadioMetadataValidationError extends Error {
  readonly reason: StreamUrlValidationFailure;

  constructor(reason: StreamUrlValidationFailure) {
    super(`Radio metadata URL validation failed: ${reason}`);
    this.reason = reason;
  }
}

export function createRadioMetadataWorkflow({
  captureError: captureErrorImpl = captureError,
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: RadioMetadataWorkflowDependencies = {}) {
  const withTimeout = async <T>(
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await operation(controller.signal);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const fetchFollowingPublicRedirects = async (
    url: string,
    init: RequestInit,
    signal: AbortSignal
  ): Promise<Response> => {
    let currentUrl = url;

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetchImpl(currentUrl, {
        ...init,
        redirect: "manual",
        signal,
      });

      if (!REDIRECT_STATUSES.has(response.status)) {
        return response;
      }

      const location = response.headers.get("location");
      if (!location) {
        return response;
      }

      await cancelResponseBody(response);
      const nextUrl = new URL(location, currentUrl).toString();
      const validation = validatePublicStreamUrl(nextUrl);
      if (!validation.ok) {
        throw new RadioMetadataValidationError(validation.reason);
      }
      currentUrl = validation.url;
    }

    throw new Error("Radio metadata upstream exceeded redirect limit");
  };

  const tryIcy = async (
    streamUrl: string,
    sampledAt: number
  ): Promise<RadioMetadataResponse | null> =>
    withTimeout(async (signal) => {
      const response = await fetchFollowingPublicRedirects(
        streamUrl,
        {
          headers: { "Icy-MetaData": "1" },
          method: "GET",
        },
        signal
      );

      if (!response.ok) {
        await cancelResponseBody(response);
        return errorResponse(
          "RADIO_METADATA_UPSTREAM_ERROR",
          "Metadata upstream returned an error"
        );
      }

      const metaInt = parseIcyMetaInt(response.headers.get("icy-metaint"));
      if (metaInt === null) {
        await cancelResponseBody(response);
        return null;
      }

      const block = await readFirstIcyMetadataBlock(response, metaInt);
      if (!block || block.byteLength === 0) {
        return null;
      }

      const icy = normalizeIcyMetadata(parseIcyMetadataBlock(block));
      if (!icy) {
        return null;
      }

      const expiresAt = sampledAt + RADIO_METADATA_SUCCESS_TTL_MS;
      return {
        ok: true,
        data: {
          streamUrl,
          resolvedUrl: response.url || undefined,
          source: "icy",
          title: icy.title,
          artist: icy.artist,
          rawTitle: icy.rawTitle,
          artworkUrl: icy.artworkUrl,
          stationName: response.headers.get("icy-name"),
          stationDescription: response.headers.get("icy-description"),
          genre: response.headers.get("icy-genre"),
          bitrate:
            Number.parseInt(response.headers.get("icy-br") ?? "", 10) || null,
          sampledAt,
          expiresAt,
        },
      };
    });

  const tryIcecastStatus = async (
    streamUrl: string,
    sampledAt: number
  ): Promise<RadioMetadataResponse | null> =>
    withTimeout(async (signal) => {
      const statusUrl = getIcecastStatusUrl(streamUrl);
      const response = await fetchFollowingPublicRedirects(
        statusUrl,
        {
          headers: { Accept: "application/json" },
          method: "GET",
        },
        signal
      );

      if (!response.ok) {
        await cancelResponseBody(response);
        return null;
      }

      const status = await parseIcecastStatusResponse(response);
      if (!status) {
        return null;
      }

      const source = selectIcecastSource(status, streamUrl);
      if (!source) {
        return null;
      }

      const expiresAt = sampledAt + RADIO_METADATA_SUCCESS_TTL_MS;
      const data = normalizeIcecastSource({
        source,
        streamUrl,
        resolvedUrl: response.url || undefined,
        sampledAt,
        expiresAt,
      });
      return data ? { ok: true, data } : null;
    });

  const resolve = async (streamUrl: string): Promise<RadioMetadataResponse> => {
    const sampledAt = now();
    try {
      const icyResult = await tryIcy(streamUrl, sampledAt);
      if (
        icyResult?.ok ||
        icyResult?.error.code === "RADIO_METADATA_UPSTREAM_ERROR"
      ) {
        return icyResult;
      }

      const icecastResult = await tryIcecastStatus(streamUrl, sampledAt);
      if (icecastResult) {
        return icecastResult;
      }

      const expiresAt = sampledAt + RADIO_METADATA_SUCCESS_TTL_MS;
      for (const provider of EXTERNAL_METADATA_PROVIDERS) {
        const externalResult = await withTimeout((signal) =>
          provider({
            fetchImpl: (url, init = {}) =>
              fetchFollowingPublicRedirects(url, init, signal),
            streamUrl,
            sampledAt,
            expiresAt,
          })
        );
        if (externalResult) {
          return { ok: true, data: externalResult };
        }
      }

      return errorResponse(
        "RADIO_METADATA_UNSUPPORTED",
        "No standard now-playing metadata was found for this stream"
      );
    } catch (error) {
      if (isAbortError(error)) {
        return errorResponse(
          "RADIO_METADATA_TIMEOUT",
          "Timed out while reading radio metadata"
        );
      }

      if (error instanceof RadioMetadataValidationError) {
        return validationErrorForReason(error.reason);
      }

      captureErrorImpl(error, {
        surface: "api-route",
        operation: "radio-metadata.resolve",
        tags: { endpoint: "radio-metadata" },
      });

      return errorResponse(
        "RADIO_METADATA_UPSTREAM_ERROR",
        "Could not read radio metadata"
      );
    }
  };

  const handle = async ({
    origin,
    request,
    requestId,
  }: RadioMetadataWorkflowContext): Promise<Response> => {
    const urlParam = new URL(request.url).searchParams.get("url");
    const validation = validatePublicStreamUrl(urlParam);
    if (!validation.ok) {
      const response = validationErrorForReason(validation.reason);
      return jsonResponse(
        response,
        origin,
        requestId,
        statusForError(response.error.code)
      );
    }

    const cacheKey = getRadioMetadataCacheKey(validation.url);
    const cached = getCachedRadioMetadata(cacheKey, now());
    if (cached) {
      return jsonResponse(
        cached,
        origin,
        requestId,
        cached.ok ? 200 : statusForError(cached.error.code)
      );
    }

    const response = await resolve(validation.url);
    setCachedRadioMetadata(cacheKey, response, ttlForResponse(response), now());
    return jsonResponse(
      response,
      origin,
      requestId,
      response.ok ? 200 : statusForError(response.error.code)
    );
  };

  return { handle, resolve };
}
