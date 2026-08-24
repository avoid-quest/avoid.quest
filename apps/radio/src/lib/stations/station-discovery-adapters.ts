import {
  type RadioBrowserStation,
  searchRadioBrowser,
} from "@avoid.quest/platforms/radiobrowser";
import { probeBrowserReadableAudio } from "@/lib/audio/playback/browser-audio-probe";
import {
  prepareRadioGardenSearchCandidate,
  type RadioGardenSearchCandidate,
  searchRadioGarden,
} from "@/lib/platform-client";
import {
  createRadioBrowserRadio,
  createRadioGardenRadio,
} from "./external-station-workflow";
import {
  createStationDiscovery,
  type StationDiscoveryAdapters,
  type StationDiscoveryCandidate,
} from "./station-discovery";

function stopWaitingOnAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
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

function toRadioBrowserCandidate(
  station: RadioBrowserStation
): StationDiscoveryCandidate {
  const radio = createRadioBrowserRadio(station);
  return {
    country: station.country || undefined,
    description: station.tags.slice(0, 3).join(", ") || undefined,
    key: `radio-browser:${station.stationUuid}`,
    location: radio.placeTitle,
    logoUrl: station.favicon || undefined,
    radio,
    source: "radio-browser",
  };
}

function toRadioGardenCandidate(
  result: RadioGardenSearchCandidate
): StationDiscoveryCandidate {
  const radio = createRadioGardenRadio(result, result.streamUrl);
  return {
    country: radio.countryTitle,
    description: radio.description,
    key: `radio-garden:${radio.id ?? radio.streamUrl}`,
    location: radio.placeTitle,
    logoUrl: radio.logoUrl,
    radio,
    source: "radio-garden",
  };
}

function radioGardenSearchCandidate(
  candidate: StationDiscoveryCandidate
): RadioGardenSearchCandidate | null {
  const metadata = candidate.radio.platformMetadata;
  if (metadata?.platform !== "radiogarden") {
    return null;
  }
  return {
    channelId: metadata.channelId,
    countryTitle: candidate.radio.countryTitle ?? "",
    placeTitle: candidate.radio.placeTitle ?? "",
    streamUrl: candidate.radio.streamUrl,
    subtitle: candidate.radio.description ?? "",
    title: candidate.radio.name,
    url: metadata.url,
    website: candidate.radio.websiteUrl,
  };
}

export const productionStationDiscoveryAdapters: StationDiscoveryAdapters = {
  radioBrowser: {
    search: async (query, { limit, signal }) =>
      (
        await searchRadioBrowser(query, {
          limit,
          signal,
        })
      ).map(toRadioBrowserCandidate),
  },
  radioGarden: {
    search: async (query, { limit, signal }) =>
      (await stopWaitingOnAbort(searchRadioGarden(query), signal))
        .slice(0, limit)
        .map(toRadioGardenCandidate),
  },
  streamProbe: {
    prepare: async (candidate, signal) => {
      if (candidate.source === "radio-garden") {
        const searchCandidate = radioGardenSearchCandidate(candidate);
        if (!searchCandidate) {
          return null;
        }
        const prepared = await prepareRadioGardenSearchCandidate(
          searchCandidate,
          signal
        );
        return {
          ...candidate,
          radio: {
            ...candidate.radio,
            ...(prepared.format ? { streamFormat: prepared.format } : {}),
            streamUrl: prepared.streamUrl,
          },
        };
      }

      const metadata = candidate.radio.platformMetadata;
      const playable = await probeBrowserReadableAudio(
        candidate.radio.streamUrl,
        {
          accept:
            metadata?.platform === "radio-browser" && metadata.hls
              ? "application/vnd.apple.mpegurl, application/x-mpegurl, audio/mpegurl, audio/*;q=0.9"
              : "audio/*, application/octet-stream;q=0.8",
          signal,
        }
      );
      return playable ? candidate : null;
    },
  },
};

export function createProductionStationDiscovery() {
  return createStationDiscovery(productionStationDiscoveryAdapters);
}
