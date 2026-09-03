import { captureError } from "@avoid.quest/error";
import type { StreamUrlValidationFailure } from "@/lib/proxy/url-policy";
import { RADIO_METADATA_SUCCESS_TTL_MS } from "./cache";
import {
  type ExternalMetadataProviderInput,
  tryAirtimeLiveInfo,
  tryAzuraCastNowPlaying,
  tryNtsLiveApi,
  tryRadioBlackoutApi,
  tryShoutcastStatus,
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
import type {
  RadioMetadataConfig,
  RadioMetadataErrorCode,
  RadioMetadataResponse,
} from "./types";
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

function unsupportedMetadataResponse(): Extract<
  RadioMetadataResponse,
  { ok: false }
> {
  return errorResponse(
    "RADIO_METADATA_UNSUPPORTED",
    "No standard now-playing metadata was found for this stream"
  );
}

type ExternalRadioMetadataConfig = Extract<
  RadioMetadataConfig,
  {
    kind:
      | "airtime-live-info"
      | "azuracast-now-playing"
      | "nts-live-api"
      | "radio-blackout-api"
      | "shoutcast-status";
  }
>;

function retrieveExternalResult(
  input: ExternalMetadataProviderInput,
  config: ExternalRadioMetadataConfig
): Promise<Awaited<ReturnType<typeof tryAirtimeLiveInfo>>> {
  switch (config.kind) {
    case "airtime-live-info":
      return tryAirtimeLiveInfo(input, config.urls);
    case "azuracast-now-playing":
      return tryAzuraCastNowPlaying(input, config.url);
    case "shoutcast-status":
      return tryShoutcastStatus(input, {
        endpoint: config.url,
        sid: config.sid,
      });
    case "nts-live-api":
      return tryNtsLiveApi(input, config.channel);
    case "radio-blackout-api":
      return tryRadioBlackoutApi(input, config.url ?? undefined);
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported external metadata config: ${exhaustive}`);
    }
  }
}

async function retrieveExternalProvider(
  input: ExternalMetadataProviderInput,
  config: ExternalRadioMetadataConfig
): Promise<RadioMetadataResponse> {
  const externalResult = await retrieveExternalResult(input, config);
  return externalResult
    ? { ok: true, data: externalResult }
    : unsupportedMetadataResponse();
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
    case "hostname-resolution-failed":
      return errorResponse(
        "RADIO_METADATA_HOSTNAME_RESOLUTION_FAILED",
        "Failed to resolve stream host"
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
        album: null,
        artworkUrl: icy.artworkUrl,
        itemUrl: null,
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
    signal: AbortSignal,
    statusUrl = getIcecastStatusUrl(streamUrl)
  ): Promise<RadioMetadataResponse | null> => {
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
    config: Exclude<RadioMetadataConfig, { kind: "none" }>,
    signal: AbortSignal
  ): Promise<RadioMetadataResponse> => {
    const sampledAt = now();

    const expiresAt = sampledAt + RADIO_METADATA_SUCCESS_TTL_MS;
    const providerFetch = fetchWithSignal(signal);
    const input = {
      fetchImpl: providerFetch,
      streamUrl,
      sampledAt,
      expiresAt,
    };

    switch (config.kind) {
      case "icecast-status":
        return (
          (await tryIcecastStatus(streamUrl, sampledAt, signal, config.url)) ??
          unsupportedMetadataResponse()
        );
      case "airtime-live-info":
      case "azuracast-now-playing":
      case "shoutcast-status":
      case "nts-live-api":
      case "radio-blackout-api": {
        const externalResult = await retrieveExternalProvider(input, config);
        if (externalResult.ok) {
          return externalResult;
        }

        const icyResult = await tryIcy(streamUrl, sampledAt, signal);
        if (
          icyResult?.ok ||
          icyResult?.error.code === "RADIO_METADATA_UPSTREAM_ERROR"
        ) {
          return icyResult;
        }
        return externalResult;
      }
      case "icy": {
        const icyResult = await tryIcy(streamUrl, sampledAt, signal);
        if (
          icyResult?.ok ||
          icyResult?.error.code === "RADIO_METADATA_UPSTREAM_ERROR"
        ) {
          return icyResult;
        }
        return unsupportedMetadataResponse();
      }
      default: {
        const exhaustive: never = config;
        throw new Error(`Unsupported metadata config: ${exhaustive}`);
      }
    }
  };

  const retrieve = async (
    streamUrl: string,
    config: Exclude<RadioMetadataConfig, { kind: "none" }>
  ): Promise<RadioMetadataResponse> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await retrieveWithSignal(streamUrl, config, controller.signal);
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
