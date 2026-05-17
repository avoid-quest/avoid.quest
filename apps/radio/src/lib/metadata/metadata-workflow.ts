import { captureError } from "@avoid.quest/error";
import {
  type StreamUrlValidationResult,
  validatePublicStreamUrl,
} from "@/lib/proxy/url-policy";
import {
  getOrSetCachedRadioMetadata,
  getRadioMetadataCacheKey,
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
      ok: false,
      error: {
        code: "RADIO_METADATA_INVALID_URL",
        message,
      },
    },
  } satisfies MetadataConfigResult;
}

function parseMetadataConfig(params: URLSearchParams): MetadataConfigResult {
  const kind = params.get("kind");
  switch (kind) {
    case "icecast-status": {
      const metadataUrl = validateOptionalPublicUrl(params.get("metadataUrl"));
      if (metadataUrl && !metadataUrl.ok) {
        return invalidConfigResponse();
      }
      return {
        ok: true,
        config: {
          kind,
          url: metadataUrl?.url,
        },
      };
    }
    case "airtime-live-info": {
      const urls = params.getAll("metadataUrl");
      if (urls.length === 0) {
        return invalidConfigResponse();
      }
      const validatedUrls = urls.flatMap((url) => {
        const validation = validatePublicStreamUrl(url);
        return validation.ok ? [validation.url] : [];
      });
      if (validatedUrls.length !== urls.length) {
        return invalidConfigResponse();
      }
      return { ok: true, config: { kind, urls: validatedUrls } };
    }
    case "nts-live-api": {
      const channel = params.get("channel");
      if (channel !== "1" && channel !== "2") {
        return invalidConfigResponse("Invalid NTS channel");
      }
      return { ok: true, config: { kind, channel } };
    }
    case "radio-blackout-api": {
      const metadataUrl = validateOptionalPublicUrl(params.get("metadataUrl"));
      if (metadataUrl && !metadataUrl.ok) {
        return invalidConfigResponse();
      }
      return { ok: true, config: { kind, url: metadataUrl?.url } };
    }
    case "icy":
      return { ok: true, config: { kind } };
    case "none":
    case null:
      return {
        ok: false,
        response: {
          ok: false,
          error: {
            code: "RADIO_METADATA_UNSUPPORTED",
            message: "No metadata source is configured for this stream",
          },
        },
      };
    default:
      return invalidConfigResponse("Unsupported metadata source");
  }
}

export function createRadioMetadataWorkflow({
  captureError: captureErrorImpl = captureError,
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs,
}: RadioMetadataWorkflowDependencies = {}) {
  const retrieval = createRadioMetadataRetrieval({
    captureError: captureErrorImpl,
    fetchFollowingPublicRedirects: createMetadataUpstreamFetch(fetchImpl),
    now,
    timeoutMs,
  });

  const resolve = retrieval.retrieve;

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
      retrieve: () => resolve(validation.url, configResult.config),
      ttlForResponse,
    });
    return jsonResponse(
      response,
      origin,
      requestId,
      response.ok ? 200 : statusForError(response.error.code)
    );
  };

  return { handle, resolve };
}
