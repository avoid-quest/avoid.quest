import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { Radio } from "@/lib/audio";
import { getRadioMetadataConfig } from "@/lib/metadata/radio-config";
import { decodeRadioMetadataResponse } from "@/lib/metadata/response-decoder";
import type {
  RadioMetadataConfig,
  RadioMetadataResponse,
  RadioNowPlaying,
} from "@/lib/metadata/types";

const POLL_INTERVAL_MS = 30_000;
const ERROR_RETRY_INTERVAL_MS = 60_000;
const UNSUPPORTED_RETRY_INTERVAL_MS = 60_000;
const MIN_REFRESH_INTERVAL_MS = 30_000;
const MAX_REFRESH_INTERVAL_MS = 60 * 60_000;

function refreshAfterMs(
  response: RadioMetadataResponse | undefined
): number | null {
  const delay = response?.ok ? response.refreshAfterMs : undefined;
  return typeof delay === "number" && Number.isFinite(delay) && delay >= 0
    ? Math.min(delay, MAX_REFRESH_INTERVAL_MS)
    : null;
}

export function radioMetadataRefreshInterval(
  response: RadioMetadataResponse | undefined,
  dataUpdatedAt: number,
  now: number,
  hasError = false
): number {
  if (hasError) {
    return ERROR_RETRY_INTERVAL_MS;
  }
  if (response && !response.ok) {
    return UNSUPPORTED_RETRY_INTERVAL_MS;
  }
  const delay = refreshAfterMs(response);
  return delay === null
    ? POLL_INTERVAL_MS
    : Math.max(MIN_REFRESH_INTERVAL_MS, delay - (now - dataUpdatedAt));
}

export const radioMetadataKeys = {
  all: ["radio-metadata"] as const,
  stream: (
    url: string | undefined,
    metadataConfig: RadioMetadataConfig | undefined
  ) => [...radioMetadataKeys.all, url ?? "", metadataConfig ?? null] as const,
};

function isMetadataEligibleStreamUrl(
  streamUrl: string | undefined
): streamUrl is string {
  if (!streamUrl?.trim()) {
    return false;
  }
  try {
    const parsed = new URL(streamUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchRadioMetadata(
  streamUrl: string,
  metadataConfig: Exclude<RadioMetadataConfig, { kind: "none" }>
): Promise<RadioMetadataResponse> {
  const params = new URLSearchParams({
    kind: metadataConfig.kind,
    url: streamUrl,
  });
  if ("url" in metadataConfig && metadataConfig.url) {
    params.set("metadataUrl", metadataConfig.url);
  }
  if ("urls" in metadataConfig) {
    for (const url of metadataConfig.urls) {
      params.append("metadataUrl", url);
    }
  }
  if ("channel" in metadataConfig) {
    params.set("channel", metadataConfig.channel);
  }
  if ("sid" in metadataConfig && metadataConfig.sid) {
    params.set("sid", metadataConfig.sid);
  }

  const response = await fetch(`/api/radio-metadata?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const decoded = decodeRadioMetadataResponse(
    response,
    await readJson(response)
  );
  if (decoded.kind === "failure") {
    throw new Error(decoded.message);
  }
  return decoded.response;
}

function getUsableMetadataConfig(
  config: RadioMetadataConfig | undefined
): Exclude<RadioMetadataConfig, { kind: "none" }> | null {
  if (!config || config.kind === "none") {
    return null;
  }
  return config;
}

function getMetadataErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  return error ? "Failed to load radio metadata" : null;
}

export function useRadioMetadata({
  radio,
  poll,
  enabled: requested = true,
}: {
  radio: Radio | null;
  poll: boolean;
  enabled?: boolean;
}): {
  metadata: RadioNowPlaying | null;
  isLoading: boolean;
  isSupported: boolean | null;
  error: string | null;
} {
  const streamUrl = radio?.streamUrl;
  const metadataConfig = getUsableMetadataConfig(getRadioMetadataConfig(radio));
  const enabled =
    requested &&
    Boolean(metadataConfig) &&
    isMetadataEligibleStreamUrl(streamUrl);

  const query = useQuery({
    enabled,
    gcTime: 60_000,
    queryFn: () => {
      if (!(metadataConfig && streamUrl)) {
        throw new Error("Missing radio metadata configuration");
      }
      return fetchRadioMetadata(streamUrl, metadataConfig);
    },
    queryKey: radioMetadataKeys.stream(streamUrl, metadataConfig ?? undefined),
    refetchInterval:
      enabled && poll
        ? (current) =>
            radioMetadataRefreshInterval(
              current.state.data,
              current.state.dataUpdatedAt,
              Date.now(),
              current.state.error !== null
            )
        : false,
    refetchOnReconnect: poll,
    refetchOnWindowFocus: poll,
    retry: 1,
    staleTime: (current) =>
      current.state.data && !current.state.data.ok
        ? UNSUPPORTED_RETRY_INTERVAL_MS
        : (refreshAfterMs(current.state.data) ?? 15_000),
  });

  const wasPolling = useRef(poll);
  useEffect(() => {
    const startedPolling = poll && !wasPolling.current;
    wasPolling.current = poll;

    if (startedPolling && enabled && query.isStale && !query.isFetching) {
      query.refetch();
    }
  }, [enabled, poll, query.isFetching, query.isStale, query.refetch]);

  if (!enabled) {
    return {
      error: null,
      isLoading: false,
      isSupported: false,
      metadata: null,
    };
  }

  const response = query.data;
  const unsupported = response && !response.ok;
  const isSupported = response ? response.ok : null;
  const error = getMetadataErrorMessage(query.error);

  return {
    error: unsupported ? null : error,
    isLoading: query.isLoading,
    isSupported,
    metadata: response?.ok ? response.data : null,
  };
}
