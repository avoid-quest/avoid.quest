import { detectPlayablePlatformFromUrl } from "@avoid.quest/platforms";
import type {
  BandcampSearchFilter,
  BandcampSearchResult,
} from "@avoid.quest/platforms/bandcamp";
import { validateBandcampCdnUrl } from "@avoid.quest/platforms/bandcamp/url-policy";
import type { RadioGardenSearchResult } from "@avoid.quest/platforms/radiogarden";
import type { SoundCloudSearchResult } from "@avoid.quest/platforms/soundcloud";
import { validateSoundCloudCdnUrl } from "@avoid.quest/platforms/soundcloud/url-policy";
import { validatePublicHttpUrl } from "@avoid.quest/platforms/url-policy";
import type { PlatformMetadata } from "@/lib/platform-types";

export const BANDCAMP_RELAY_BASE_URLS = [
  "https://seep.eu.org/",
  "https://proxy.cors.sh/",
  "https://cors.zme.ink/",
] as const;

type BandcampRelayBaseUrl = (typeof BANDCAMP_RELAY_BASE_URLS)[number];

type BandcampRelaySelectionOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const BANDCAMP_RELAY_PROBE_TIMEOUT_MS = 5000;
const BANDCAMP_RELAY_CONTENT_RANGE_PATTERN = /^bytes 0-0\/\d+$/;

export type PlatformItem = {
  format?: "hls" | "progressive";
  metadata: PlatformMetadata;
  streamUrl: string;
};

function awaitWithSignal<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (signal === undefined) {
    return operation();
  }
  signal.throwIfAborted();

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", handleAbort);
    const handleAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    let pending: Promise<T>;
    try {
      pending = operation();
    } catch (error) {
      cleanup();
      reject(error);
      return;
    }
    pending.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function validateBandcampStreamUrl(streamUrl: string): string {
  const validated = validateBandcampCdnUrl(streamUrl);
  if (!validated.ok) {
    throw new Error("Bandcamp returned an unsafe media URL");
  }
  return validated.url;
}

function toBandcampRelayUrl(
  streamUrl: string,
  relayBaseUrl: BandcampRelayBaseUrl
): string {
  return relayBaseUrl + validateBandcampStreamUrl(streamUrl);
}

async function probeBandcampRelay(
  relayBaseUrl: BandcampRelayBaseUrl,
  streamUrl: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<boolean> {
  try {
    const response = await fetchImpl(relayBaseUrl + streamUrl, {
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "audio/*, application/octet-stream;q=0.8, */*;q=0.1",
        Range: "bytes=0-0",
      },
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });
    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    const contentRange =
      response.headers.get("content-range")?.toLowerCase() ?? "";
    const ready =
      response.status === 206 &&
      contentType.startsWith("audio/") &&
      BANDCAMP_RELAY_CONTENT_RANGE_PATTERN.test(contentRange);
    if (!ready || response.body === null) {
      await response.body?.cancel();
      return false;
    }

    const reader = response.body.getReader();
    try {
      const { done, value } = await reader.read();
      return !done && value !== undefined && value.byteLength > 0;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

export async function selectBandcampRelayBaseUrl(
  streamUrl: string,
  options: BandcampRelaySelectionOptions = {}
): Promise<BandcampRelayBaseUrl> {
  const validatedUrl = validateBandcampStreamUrl(streamUrl);
  const {
    fetchImpl = fetch,
    signal: parentSignal,
    timeoutMs = BANDCAMP_RELAY_PROBE_TIMEOUT_MS,
  } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Bandcamp relay probe timeout is invalid");
  }
  parentSignal?.throwIfAborted();

  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException("Bandcamp relay probe timed out", "TimeoutError")
      ),
    timeoutMs
  );
  const probes = BANDCAMP_RELAY_BASE_URLS.map((relayBaseUrl) =>
    probeBandcampRelay(relayBaseUrl, validatedUrl, fetchImpl, controller.signal)
  );

  try {
    for (const [index, relayBaseUrl] of BANDCAMP_RELAY_BASE_URLS.entries()) {
      const ready = await probes[index];
      parentSignal?.throwIfAborted();
      if (ready) {
        return relayBaseUrl;
      }
    }
    throw new Error("No public Bandcamp relay is currently available");
  } finally {
    clearTimeout(timeout);
    controller.abort();
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function relayBandcampItem(
  item: PlatformItem,
  relayBaseUrl: BandcampRelayBaseUrl
): PlatformItem {
  if (item.metadata.platform !== "bandcamp") {
    return item;
  }

  return {
    ...item,
    metadata: {
      ...item.metadata,
      streamUrl:
        item.metadata.streamUrl === undefined
          ? undefined
          : toBandcampRelayUrl(item.metadata.streamUrl, relayBaseUrl),
      tracks: item.metadata.tracks?.map((track) => ({
        ...track,
        streamUrl: toBandcampRelayUrl(track.streamUrl, relayBaseUrl),
      })),
    },
    streamUrl: toBandcampRelayUrl(item.streamUrl, relayBaseUrl),
  };
}

function validateSoundCloudItem(item: PlatformItem): PlatformItem {
  if (item.metadata.platform !== "soundcloud") {
    return item;
  }

  const streamUrls = [
    item.streamUrl,
    ...(item.metadata.streamUrl === undefined ? [] : [item.metadata.streamUrl]),
    ...(item.metadata.tracks?.map((track) => track.streamUrl) ?? []),
  ];
  if (streamUrls.some((url) => !validateSoundCloudCdnUrl(url).ok)) {
    throw new Error("SoundCloud returned an unsafe media URL");
  }
  return item;
}

function validateRadioGardenItem(item: PlatformItem): PlatformItem {
  if (
    item.metadata.platform !== "radiogarden" ||
    !validatePublicHttpUrl(item.streamUrl).ok
  ) {
    throw new Error("Radio Garden returned an unsafe media URL");
  }
  return item;
}

export function preparePlatformItem(
  requestUrl: string,
  item: PlatformItem,
  bandcampRelayBaseUrl: BandcampRelayBaseUrl = BANDCAMP_RELAY_BASE_URLS[0]
): PlatformItem {
  const platform = detectPlayablePlatformFromUrl(requestUrl);
  if (
    (platform !== "bandcamp" &&
      platform !== "soundcloud" &&
      platform !== "radiogarden") ||
    item.metadata.platform !== platform
  ) {
    throw new Error("Platform returned mismatched metadata");
  }

  switch (platform) {
    case "bandcamp":
      return relayBandcampItem(item, bandcampRelayBaseUrl);
    case "soundcloud":
      return validateSoundCloudItem(item);
    case "radiogarden":
      return validateRadioGardenItem(item);
    default:
      throw new Error("Platform returned mismatched metadata");
  }
}

export async function resolvePlatformItem(
  url: string,
  signal?: AbortSignal
): Promise<PlatformItem> {
  signal?.throwIfAborted();
  const { loadPlatformItem } = await import("@/utils/platform.functions");
  signal?.throwIfAborted();
  const result = await awaitWithSignal(
    () => loadPlatformItem({ data: { url } }),
    signal
  );
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  const platform = detectPlayablePlatformFromUrl(url);
  const bandcampRelayBaseUrl =
    platform === "bandcamp" && result.data.metadata.platform === "bandcamp"
      ? await selectBandcampRelayBaseUrl(result.data.streamUrl, { signal })
      : undefined;
  return preparePlatformItem(url, result.data, bandcampRelayBaseUrl);
}

export async function searchBandcamp(
  query: string,
  filter: BandcampSearchFilter = ""
): Promise<BandcampSearchResult[]> {
  const { bandcampSearch } = await import("@/utils/search.functions");
  const result = await bandcampSearch({ data: { filter, query } });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data.results;
}

export async function searchRadioGarden(
  query: string
): Promise<RadioGardenSearchResult[]> {
  const { radioGardenSearch } = await import("@/utils/radio-garden.functions");
  const result = await radioGardenSearch({ data: { query } });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data.results;
}

export async function searchSoundCloud(
  query: string
): Promise<SoundCloudSearchResult[]> {
  const { soundcloudSearch } = await import("@/utils/search.functions");
  const result = await soundcloudSearch({ data: { query } });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data.results;
}
