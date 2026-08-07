import type { RadioBrowserStation } from "@avoid.quest/platforms/radiobrowser";
import {
  type BrowserAudioFetch,
  DEFAULT_BROWSER_AUDIO_PROBE_TIMEOUT_MS,
  probeBrowserReadableAudio,
} from "@/lib/audio/playback/browser-audio-probe";

export const RADIO_BROWSER_RESULT_LIMIT = 10;
export const MAX_CONCURRENT_AUDIO_PROBES = 2;

export type AudioProbeScheduler = <T>(probe: () => Promise<T>) => Promise<T>;

type QueuedProbe = {
  reject: (reason: unknown) => void;
  resolve: (value: unknown) => void;
  run: () => Promise<unknown>;
};

type RadioBrowserPlayabilityOptions = {
  fetchImpl?: BrowserAudioFetch;
  limit?: number;
  scheduleProbe?: AudioProbeScheduler;
  signal?: AbortSignal;
  timeoutMs?: number;
};

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Request aborted", "AbortError");
}

/**
 * Share one scheduler between discovery providers so they cannot independently
 * consume the connection pool while an audio element is streaming.
 */
export function createAudioProbeScheduler(
  maxConcurrency = MAX_CONCURRENT_AUDIO_PROBES,
  signal?: AbortSignal
): AudioProbeScheduler {
  const concurrency = Math.max(1, Math.trunc(maxConcurrency));
  const queue: QueuedProbe[] = [];
  let activeCount = 0;

  const pump = () => {
    while (activeCount < concurrency && queue.length > 0) {
      const queued = queue.shift();
      if (!queued) {
        return;
      }
      if (signal?.aborted) {
        queued.reject(abortReason(signal));
        continue;
      }
      activeCount += 1;
      Promise.resolve()
        .then(queued.run)
        .then(queued.resolve, queued.reject)
        .finally(() => {
          activeCount -= 1;
          pump();
        });
    }
  };

  signal?.addEventListener(
    "abort",
    () => {
      const reason = abortReason(signal);
      for (const queued of queue.splice(0)) {
        queued.reject(reason);
      }
    },
    { once: true }
  );

  return <T>(probe: () => Promise<T>) => {
    if (signal?.aborted) {
      return Promise.reject(abortReason(signal));
    }
    return new Promise<T>((resolve, reject) => {
      queue.push({
        reject,
        resolve: (value) => resolve(value as T),
        run: probe,
      });
      pump();
    });
  };
}

function streamUrl(station: RadioBrowserStation): string | null {
  try {
    const url = new URL(station.urlResolved || station.url);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function probeStation(
  station: RadioBrowserStation,
  url: string,
  fetchImpl: BrowserAudioFetch,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number
): Promise<boolean> {
  return probeBrowserReadableAudio(url, {
    accept: station.hls
      ? "application/vnd.apple.mpegurl, application/x-mpegurl, audio/mpegurl, audio/*;q=0.9"
      : "audio/*, application/octet-stream;q=0.8",
    fetchImpl,
    signal: parentSignal,
    timeoutMs,
  });
}

export async function filterPlayableRadioBrowserStations(
  stations: readonly RadioBrowserStation[],
  options: RadioBrowserPlayabilityOptions = {}
): Promise<RadioBrowserStation[]> {
  const {
    fetchImpl = fetch,
    limit = RADIO_BROWSER_RESULT_LIMIT,
    signal,
    timeoutMs = DEFAULT_BROWSER_AUDIO_PROBE_TIMEOUT_MS,
  } = options;
  const scheduleProbe =
    options.scheduleProbe ??
    createAudioProbeScheduler(MAX_CONCURRENT_AUDIO_PROBES, signal);
  const candidates = stations.slice(0, Math.max(0, Math.trunc(limit)));
  const results = await Promise.all(
    candidates.map(async (station) => {
      const url = streamUrl(station);
      return url &&
        (await scheduleProbe(() =>
          probeStation(station, url, fetchImpl, signal, timeoutMs)
        ))
        ? station
        : null;
    })
  );
  if (signal?.aborted) {
    throw abortReason(signal);
  }
  return results.filter(
    (station): station is RadioBrowserStation => station !== null
  );
}
