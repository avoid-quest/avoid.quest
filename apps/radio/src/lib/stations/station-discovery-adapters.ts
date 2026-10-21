import { fromProblemError } from "@avoid.quest/error";
import type { RadioBrowserStation } from "@avoid.quest/platforms/radiobrowser";
import { probeBrowserReadableAudio } from "@/lib/audio/playback/browser-audio-probe";
import {
  prepareRadioGardenSearchCandidate,
  type RadioGardenSearchCandidate,
} from "@/lib/platform-client";
import { stationIntake } from "./external-station-workflow";
import {
  createStationDiscovery,
  type StationDiscoveryAdapters,
  type StationDiscoveryCandidate,
} from "./station-discovery";

async function toRadioBrowserCandidate(
  station: RadioBrowserStation
): Promise<StationDiscoveryCandidate | null> {
  const prepared = await stationIntake.prepare({
    origin: "radio-browser",
    station,
  });
  if (!prepared.ok) {
    return null;
  }
  const { radio } = prepared.data;
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

async function toRadioGardenCandidate(
  result: RadioGardenSearchCandidate
): Promise<StationDiscoveryCandidate | null> {
  const prepared = await stationIntake.prepare({
    origin: "radio-garden",
    resolved: { streamUrl: result.streamUrl },
    result,
  });
  if (!prepared.ok) {
    return null;
  }
  const { radio } = prepared.data;
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

const productionStationDiscoveryAdapters: StationDiscoveryAdapters = {
  radioBrowser: {
    search: async (query, { limit, signal }) => {
      signal.throwIfAborted();
      const { radioBrowserSearch } = await import(
        "@/utils/radio-browser.functions"
      );
      signal.throwIfAborted();
      const result = await radioBrowserSearch({
        data: { limit, query },
        signal,
      });
      signal.throwIfAborted();
      if (!result.ok) {
        throw fromProblemError(result.error);
      }
      const candidates = await Promise.all(
        result.data.results.map(toRadioBrowserCandidate)
      );
      return candidates.filter(
        (candidate): candidate is StationDiscoveryCandidate =>
          candidate !== null
      );
    },
  },
  radioGarden: {
    search: async (query, { limit, signal }) => {
      signal.throwIfAborted();
      const { radioGardenSearch } = await import(
        "@/utils/radio-garden.functions"
      );
      signal.throwIfAborted();
      const result = await radioGardenSearch({ data: { query }, signal });
      signal.throwIfAborted();
      if (!result.ok) {
        throw fromProblemError(result.error);
      }
      const candidates = await Promise.all(
        result.data.results.slice(0, limit).map(toRadioGardenCandidate)
      );
      return candidates.filter(
        (candidate): candidate is StationDiscoveryCandidate =>
          candidate !== null
      );
    },
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
        const station = await stationIntake.prepare({
          origin: "radio-garden",
          resolved: {
            ...(prepared.format ? { format: prepared.format } : {}),
            streamUrl: prepared.streamUrl,
          },
          result: searchCandidate,
        });
        if (!station.ok) {
          return null;
        }
        return {
          ...candidate,
          radio: station.data.radio,
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

export function createProductionStationDiscovery(
  options: { radioBrowser?: boolean; radioGarden?: boolean } = {}
) {
  const emptyDirectory = { search: async () => [] };
  return createStationDiscovery({
    ...productionStationDiscoveryAdapters,
    radioBrowser:
      options.radioBrowser === false
        ? emptyDirectory
        : productionStationDiscoveryAdapters.radioBrowser,
    radioGarden:
      options.radioGarden === false
        ? emptyDirectory
        : productionStationDiscoveryAdapters.radioGarden,
  });
}
