import type { RadioBrowserStation } from "@avoid.quest/platforms/radiobrowser";
import {
  type BrowserAudioFetch,
  DEFAULT_BROWSER_AUDIO_PROBE_TIMEOUT_MS,
  probeBrowserReadableAudio,
} from "@/lib/audio/playback/browser-audio-probe";
import {
  type AudioProbeScheduler,
  createGlobalAudioProbeScheduler,
} from "./audio-probe-scheduler.js";

export const RADIO_BROWSER_RESULT_LIMIT = 10;

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
    options.scheduleProbe ?? createGlobalAudioProbeScheduler(signal);
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
