import { captureError } from "@avoid.quest/error";
import type { StreamUrlValidationFailure } from "@/lib/proxy/url-policy";
import { RADIO_METADATA_SUCCESS_TTL_MS } from "./cache";
import {
  type ExternalMetadataProviderInput,
  tryAirtimeLiveInfo,
  tryAzuraCastNowPlaying,
  tryHkcrSchedule,
  tryNtsLiveApi,
  tryRadioAlharaApi,
  tryRadioBlackoutApi,
  tryResonanceExtraApi,
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
import { tryLylApi } from "./lyl-provider";
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
  return { error: { code, message }, ok: false };
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
      | "hkcr-schedule"
      | "lyl-api"
      | "nts-live-api"
      | "radio-alhara-api"
      | "radio-blackout-api"
      | "resonance-extra-api"
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
    case "hkcr-schedule":
      return tryHkcrSchedule(input);
    case "lyl-api":
      return tryLylApi(input);
    case "shoutcast-status":
      return tryShoutcastStatus(input, {
        endpoint: config.url,
        sid: config.sid,
      });
    case "nts-live-api":
      return tryNtsLiveApi(input, config.channel);
    case "radio-alhara-api":
      return tryRadioAlharaApi(input);
    case "radio-blackout-api":
      return tryRadioBlackoutApi(input, config.url ?? undefined);
    case "resonance-extra-api":
      return tryResonanceExtraApi(input);
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
    ? { data: externalResult, ok: true }
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
      data: {
        album: null,
        artist: icy.artist,
        artworkUrl: icy.artworkUrl,
        bitrate:
          Number.parseInt(response.headers.get("icy-br") ?? "", 10) || null,
        expiresAt,
        genre: response.headers.get("icy-genre"),
        itemUrl: null,
        rawTitle: icy.rawTitle,
        resolvedUrl: response.url || undefined,
        sampledAt,
        source: "icy",
        stationDescription: response.headers.get("icy-description"),
        stationName: response.headers.get("icy-name"),
        streamUrl,
        title: icy.title,
      },
      ok: true,
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
      expiresAt,
      resolvedUrl: response.url || undefined,
      sampledAt,
      source,
      streamUrl,
    });
    return data ? { data, ok: true } : null;
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
      expiresAt,
      fetchImpl: providerFetch,
      sampledAt,
      streamUrl,
    };

    switch (config.kind) {
      case "icecast-status":
        return (
          (await tryIcecastStatus(streamUrl, sampledAt, signal, config.url)) ??
          unsupportedMetadataResponse()
        );
      case "airtime-live-info":
      case "azuracast-now-playing":
      case "hkcr-schedule":
      case "lyl-api":
      case "shoutcast-status":
      case "nts-live-api":
      case "radio-alhara-api":
      case "radio-blackout-api":
      case "resonance-extra-api": {
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
        operation: "radio-metadata.resolve",
        surface: "api-route",
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
