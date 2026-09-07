import { captureError } from "@avoid.quest/error";
import {
  type StreamUrlValidationResult,
  validatePublicStreamUrl,
} from "@/lib/proxy/url-policy";
import {
  cacheMetadata,
  getOrSetCachedRadioMetadata,
  getRadioMetadataCacheKey,
  type MetadataStore,
  RADIO_METADATA_FAILURE_TTL_MS,
  RADIO_METADATA_SUCCESS_TTL_MS,
  RADIO_METADATA_UNSUPPORTED_TTL_MS,
} from "./cache";
import {
  createRadioMetadataRetrieval,
  validationErrorForReason,
} from "./retrieval";
import type {
  RadioMetadataConfig,
  RadioMetadataErrorCode,
  RadioMetadataResponse,
} from "./types";
import { createMetadataUpstreamFetch } from "./upstream-fetch";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_METADATA_URLS = 5;
const SHOUTCAST_SID_PATTERN = /^\d{1,5}$/;

type RadioMetadataWorkflowContext = {
  origin: string;
  request: Request;
  requestId: string;
};

type RadioMetadataWorkflowDependencies = {
  store?: MetadataStore;
  captureError?: typeof captureError;
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

function ttlForResponse(response: RadioMetadataResponse, now: number): number {
  if (response.ok) {
    return Math.max(0, response.data.expiresAt - now);
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
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Cache-Control": "private, no-store",
      "x-request-id": requestId,
    },
    status,
  });
}

function statusForError(code: RadioMetadataErrorCode): number {
  switch (code) {
    case "RADIO_METADATA_URL_REQUIRED":
    case "RADIO_METADATA_INVALID_URL":
    case "RADIO_METADATA_INTERNAL_ADDRESS":
    case "RADIO_METADATA_HOSTNAME_RESOLUTION_FAILED":
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

type MetadataConfigResult =
  | { ok: true; config: Exclude<RadioMetadataConfig, { kind: "none" }> }
  | { ok: false; response: Extract<RadioMetadataResponse, { ok: false }> };

function validateOptionalPublicUrl(
  url: string | null
): StreamUrlValidationResult | null {
  return url ? validatePublicStreamUrl(url) : null;
}

function invalidConfigResponse(message = "Invalid metadata configuration") {
  return {
    ok: false,
    response: {
      error: {
        code: "RADIO_METADATA_INVALID_URL",
        message,
      },
      ok: false,
    },
  } satisfies MetadataConfigResult;
}

function parseAirtimeConfig(params: URLSearchParams): MetadataConfigResult {
  const urls = params.getAll("metadataUrl");
  const uniqueUrls = [...new Set(urls)];
  if (
    urls.length === 0 ||
    urls.length > MAX_METADATA_URLS ||
    uniqueUrls.length !== urls.length
  ) {
    return invalidConfigResponse();
  }

  const validatedUrls = uniqueUrls.flatMap((url) => {
    const validation = validatePublicStreamUrl(url);
    return validation.ok ? [validation.url] : [];
  });
  if (validatedUrls.length !== uniqueUrls.length) {
    return invalidConfigResponse();
  }
  return {
    config: { kind: "airtime-live-info", urls: validatedUrls },
    ok: true,
  };
}

function parseMetadataUrlConfig(
  kind: "azuracast-now-playing" | "icecast-status" | "radio-blackout-api",
  params: URLSearchParams
): MetadataConfigResult {
  const metadataUrl = validateOptionalPublicUrl(params.get("metadataUrl"));
  if (metadataUrl && !metadataUrl.ok) {
    return invalidConfigResponse();
  }
  return { config: { kind, url: metadataUrl?.url }, ok: true };
}

function parseShoutcastConfig(params: URLSearchParams): MetadataConfigResult {
  const metadataUrl = validateOptionalPublicUrl(params.get("metadataUrl"));
  if (metadataUrl && !metadataUrl.ok) {
    return invalidConfigResponse();
  }
  const sid = params.get("sid")?.trim() || undefined;
  if (sid && !SHOUTCAST_SID_PATTERN.test(sid)) {
    return invalidConfigResponse("Invalid SHOUTcast stream id");
  }
  return {
    config: { kind: "shoutcast-status", sid, url: metadataUrl?.url },
    ok: true,
  };
}

function unsupportedConfigResponse(): MetadataConfigResult {
  return {
    ok: false,
    response: {
      error: {
        code: "RADIO_METADATA_UNSUPPORTED",
        message: "No metadata source is configured for this stream",
      },
      ok: false,
    },
  };
}

function parseMetadataConfig(params: URLSearchParams): MetadataConfigResult {
  const kind = params.get("kind");
  switch (kind) {
    case "icecast-status":
      return parseMetadataUrlConfig(kind, params);
    case "airtime-live-info":
      return parseAirtimeConfig(params);
    case "azuracast-now-playing":
      return parseMetadataUrlConfig(kind, params);
    case "shoutcast-status":
      return parseShoutcastConfig(params);
    case "nts-live-api": {
      const channel = params.get("channel");
      if (channel !== "1" && channel !== "2") {
        return invalidConfigResponse("Invalid NTS channel");
      }
      return { config: { channel, kind }, ok: true };
    }
    case "radio-blackout-api":
      return parseMetadataUrlConfig(kind, params);
    case "hkcr-schedule":
    case "lyl-api":
    case "radio-alhara-api":
    case "resonance-extra-api":
      return { config: { kind }, ok: true };
    case "icy":
      return { config: { kind }, ok: true };
    case "none":
    case null:
      return unsupportedConfigResponse();
    default:
      return invalidConfigResponse("Unsupported metadata source");
  }
}

export function createRadioMetadataWorkflow({
  store,
  captureError: captureErrorImpl = captureError,
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs,
}: RadioMetadataWorkflowDependencies = {}) {
  const retrieval = createRadioMetadataRetrieval({
    captureError: captureErrorImpl,
    fetchFollowingPublicRedirects: createMetadataUpstreamFetch(fetchImpl),
    now,
    store,
    timeoutMs,
  });

  const handle = async ({
    origin,
    request,
    requestId,
  }: RadioMetadataWorkflowContext): Promise<Response> => {
    const params = new URL(request.url).searchParams;
    const urlParam = params.get("url");
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

    const configResult = parseMetadataConfig(params);
    if (!configResult.ok) {
      return jsonResponse(
        configResult.response,
        origin,
        requestId,
        statusForError(configResult.response.error.code)
      );
    }

    const cacheKey = getRadioMetadataCacheKey(
      `${validation.url}#${JSON.stringify(configResult.config)}`
    );
    const response = await getOrSetCachedRadioMetadata(cacheKey, {
      now,
      retrieve: () =>
        cacheMetadata({
          expiresAt: (result) => (result.ok ? result.data.expiresAt : 0),
          key: [
            configResult.config.kind,
            "now-playing",
            validation.url,
            configResult.config,
          ],
          now,
          retrieve: () =>
            retrieval.retrieve(validation.url, configResult.config),
          shouldCache: (result) => result.ok,
          store,
          ttl: RADIO_METADATA_SUCCESS_TTL_MS / 1000,
        }),
      ttlForResponse: (result) => ttlForResponse(result, now()),
    });
    return jsonResponse(
      response,
      origin,
      requestId,
      response.ok ? 200 : statusForError(response.error.code)
    );
  };

  return { handle };
}
