import { captureError } from "@avoid.quest/error";
import type { StreamUrlValidationFailure } from "@/lib/proxy/url-policy";
import { RADIO_METADATA_SUCCESS_TTL_MS } from "./cache";
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
import { EXTERNAL_METADATA_PROVIDER_ADAPTERS } from "./providers";
import type { RadioMetadataErrorCode, RadioMetadataResponse } from "./types";
import {
  cancelResponseBody,
  type MetadataUpstreamFetch,
  RadioMetadataValidationError,
} from "./upstream-fetch";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type RadioMetadataRetrievalDependencies = {
  captureError?: typeof captureError;
  fetchFollowingPublicRedirects: MetadataUpstreamFetch;
  now?: () => number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 8000;

function errorResponse(
  code: RadioMetadataErrorCode,
  message: string
): Extract<RadioMetadataResponse, { ok: false }> {
  return { ok: false, error: { code, message } };
}

export function validationErrorForReason(
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function createRadioMetadataRetrieval({
  captureError: captureErrorImpl = captureError,
  fetchFollowingPublicRedirects,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: RadioMetadataRetrievalDependencies) {
  const fetchWithSignal =
    (signal: AbortSignal): FetchLike =>
    (url, init = {}) =>
      fetchFollowingPublicRedirects(url, init, signal);

  const tryIcy = async (
    streamUrl: string,
    sampledAt: number,
    signal: AbortSignal
  ): Promise<RadioMetadataResponse | null> => {
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
  };

  const tryIcecastStatus = async (
    streamUrl: string,
    sampledAt: number,
    signal: AbortSignal
  ): Promise<RadioMetadataResponse | null> => {
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
  };

  const retrieveWithSignal = async (
    streamUrl: string,
    signal: AbortSignal
  ): Promise<RadioMetadataResponse> => {
    const sampledAt = now();
    const icyResult = await tryIcy(streamUrl, sampledAt, signal);
    if (
      icyResult?.ok ||
      icyResult?.error.code === "RADIO_METADATA_UPSTREAM_ERROR"
    ) {
      return icyResult;
    }

    const icecastResult = await tryIcecastStatus(streamUrl, sampledAt, signal);
    if (icecastResult) {
      return icecastResult;
    }

    const expiresAt = sampledAt + RADIO_METADATA_SUCCESS_TTL_MS;
    const providerFetch = fetchWithSignal(signal);
    for (const provider of EXTERNAL_METADATA_PROVIDER_ADAPTERS) {
      const externalResult = await provider.retrieve({
        fetchImpl: providerFetch,
        streamUrl,
        sampledAt,
        expiresAt,
      });
      if (externalResult) {
        return { ok: true, data: externalResult };
      }
    }

    return errorResponse(
      "RADIO_METADATA_UNSUPPORTED",
      "No standard now-playing metadata was found for this stream"
    );
  };

  const retrieve = async (
    streamUrl: string
  ): Promise<RadioMetadataResponse> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await retrieveWithSignal(streamUrl, controller.signal);
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
    } finally {
      clearTimeout(timeoutId);
    }
  };

  return { retrieve };
}
