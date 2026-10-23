import { radios } from "@/lib/const";
import { findPublicRadio, getPublicKodiStations } from "@/lib/kodi-playlist";
import { renderXmltv } from "@/lib/xmltv";
import { cacheMetadata, type MetadataCache } from "./cache";
import { normalizeProgrammes, type RadioProgramme } from "./programmes";
import {
  type ExternalRadioMetadataConfig,
  retrieveExternalResult,
} from "./retrieval";
import type { RadioMetadataConfig } from "./types";
import { createMetadataUpstreamFetch } from "./upstream-fetch";

const GUIDE_TTL_SECONDS = 300;
const GUIDE_TIMEOUT_MS = 10_000;
const PROVIDER_TIMEOUT_MS = 4000;
const CONCURRENCY = 3;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PROVIDER_BYTES = 4 * MAX_RESPONSE_BYTES;
const MAX_PROVIDER_REQUESTS = 12;

/** Buffer only a bounded metadata body, including responses without Content-Length. */
async function boundedResponse(
  response: Response,
  signal: AbortSignal,
  limit: number
): Promise<{ response: Response; bytes: number }> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { response, bytes: 0 };
  }
  const cancel = () => {
    reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (Number(response.headers.get("content-length")) > limit) {
      throw new Error("Guide upstream payload limit exceeded");
    }
    while (!signal.aborted) {
      signal.throwIfAborted();
      // biome-ignore lint/performance/noAwaitInLoops: Read sequentially to enforce the byte limit before buffering another chunk.
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      length += value.byteLength;
      if (length > limit) {
        throw new Error("Guide upstream payload limit exceeded");
      }
      chunks.push(value);
    }
    signal.throwIfAborted();
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const buffered = new Response(body, {
      headers: response.headers,
      status: response.status,
    });
    // Providers use response.url for provenance, never for playback.
    Object.defineProperty(buffered, "url", { value: response.url });
    return { response: buffered, bytes: length };
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

type GuideDependencies = {
  cache?: MetadataCache;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Shorter budgets let tests exercise cancellation without waiting seconds. */
  timeoutMs?: number;
  providerTimeoutMs?: number;
};

type GuideSnapshot = { xml: string; expiresAt: number };

function supportsProgrammes(
  config: RadioMetadataConfig | undefined
): config is ExternalRadioMetadataConfig {
  return (
    !!config &&
    [
      "airtime-live-info",
      "nts-live-api",
      "hkcr-schedule",
      "lyl-api",
      "resonance-extra-api",
    ].includes(config.kind)
  );
}

async function untilAborted(
  task: Promise<unknown>,
  signal: AbortSignal
): Promise<void> {
  let stop: (() => void) | undefined;
  try {
    await Promise.race([
      task,
      new Promise<void>((resolve) => {
        stop = () => resolve();
        if (signal.aborted) {
          resolve();
        } else {
          signal.addEventListener("abort", stop, { once: true });
        }
      }),
    ]);
  } finally {
    if (stop) {
      signal.removeEventListener("abort", stop);
    }
  }
}

/** A fixed catalog export: request parameters cannot select a provider or URL. */
export function createRadioGuide({
  cache,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = GUIDE_TIMEOUT_MS,
  providerTimeoutMs = PROVIDER_TIMEOUT_MS,
}: GuideDependencies = {}) {
  const stations = getPublicKodiStations(radios);
  let cached: GuideSnapshot | undefined;
  let inFlight: Promise<GuideSnapshot> | undefined;

  async function channelProgrammes(
    stationId: string,
    sampledAt: number,
    deadline: AbortSignal
  ): Promise<RadioProgramme[]> {
    const radio = findPublicRadio(radios, stationId);
    if (!(radio && supportsProgrammes(radio.metadataConfig))) {
      return [];
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([deadline, controller.signal]);
    const timer = setTimeout(() => controller.abort(), providerTimeoutMs);
    let requests = 0;
    let bytes = 0;
    const upstream = createMetadataUpstreamFetch(
      async (url, init) => {
        signal.throwIfAborted();
        requests += 1;
        if (requests > MAX_PROVIDER_REQUESTS) {
          throw new Error("Guide request limit exceeded");
        }
        const buffered = await boundedResponse(
          await fetchImpl(url, init),
          signal,
          Math.min(MAX_RESPONSE_BYTES, MAX_PROVIDER_BYTES - bytes)
        );
        bytes += buffered.bytes;
        return buffered.response;
      },
      fetchImpl === globalThis.fetch ? undefined : false
    );
    const entries: RadioProgramme[] = [];
    try {
      await untilAborted(
        retrieveExternalResult(
          {
            cache,
            expiresAt: sampledAt + GUIDE_TTL_SECONDS * 1000,
            fetchImpl: (url, init = {}) => upstream(url, init, signal),
            now,
            onProgrammes: (items) => {
              if (!signal.aborted) {
                entries.push(...items);
              }
            },
            sampledAt,
            streamUrl: radio.streamUrl,
          },
          radio.metadataConfig
        ),
        signal
      );
    } catch {
      // A source failure leaves its channel and any already parsed slots intact.
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    return normalizeProgrammes(entries, sampledAt);
  }

  async function retrieve(): Promise<GuideSnapshot> {
    const sampledAt = now();
    const schedules = new Map<string, RadioProgramme[]>();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < stations.length && !controller.signal.aborted) {
        const station = stations[cursor];
        cursor += 1;
        if (station) {
          // biome-ignore lint/performance/noAwaitInLoops: Each of three workers handles one provider at a time to bound upstream concurrency.
          const programmes = await channelProgrammes(
            station.id,
            sampledAt,
            controller.signal
          );
          schedules.set(station.id, programmes);
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
      return {
        expiresAt: sampledAt + GUIDE_TTL_SECONDS * 1000,
        xml: renderXmltv(stations, schedules, sampledAt),
      };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  function getSnapshot(): Promise<GuideSnapshot> {
    if (cached && cached.expiresAt > now()) {
      return Promise.resolve(cached);
    }
    if (inFlight) {
      return inFlight;
    }
    inFlight = cacheMetadata({
      cache,
      expiresAt: (snapshot) => snapshot.expiresAt,
      key: ["xmltv-v1", stations, radios.map((radio) => radio.metadataConfig)],
      now,
      retrieve,
      ttl: GUIDE_TTL_SECONDS,
    })
      .then((snapshot) => {
        cached = snapshot;
        return snapshot;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }

  return {
    async handle(): Promise<Response> {
      const snapshot = await getSnapshot();
      return new Response(snapshot.xml, {
        headers: {
          "Cache-Control": `public, max-age=${Math.max(0, Math.floor((snapshot.expiresAt - now()) / 1000))}`,
          "Content-Type": "application/xml; charset=utf-8",
        },
      });
    },
  };
}
