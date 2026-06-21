import type { Radio } from "@/lib/audio";
import { getFilenameFromUrl } from "@/lib/audio/remote-url";
import { createPlatformRadio } from "@/lib/external-url/utils";
import type { Platform, StaticAudioMetadata } from "@/lib/platform-types";

export const AUDIO_INPUT_PLATFORM_ID = -3;
export const STATIC_AUDIO_PLATFORM_ID = -4;
export const SEARCH_ALL_PLATFORM_ID = -6;
export const RADIO_GARDEN_PLATFORM_ID = -7;
export const BANDCAMP_PLATFORM_ID = -8;
export const SOUNDCLOUD_PLATFORM_ID = -9;
export const YOUTUBE_PLATFORM_ID = -10;

export type DeckSourceLoadIntent =
  | { type: "device-input"; deviceId: string; deviceLabel: string }
  | { type: "file"; file: File }
  | { type: "radio"; radio: Radio | null }
  | { type: "static-audio-url"; url: string }
  | { type: "track"; radio: Radio | null; autoPlay?: boolean }
  | {
      type: "track-url";
      radio: Radio;
      streamUrl: string;
      autoPlay?: boolean;
    };

export type DeckSourceLoadResult = { type: "loaded" };

export type DeckLibrarySourceIntent =
  | { type: "load"; source: DeckSourceLoadIntent }
  | { type: "pending-platform"; platform: Platform };

type PlatformSourceIcon =
  | "audio-input"
  | "bandcamp"
  | "radio-garden"
  | "search"
  | "soundcloud"
  | "static-audio"
  | "youtube";

type PlatformSourceDefinition = {
  id: number;
  pendingPlatform: Platform;
  color: string;
  icon: PlatformSourceIcon;
  radio: Radio;
};

export const PLATFORM_SOURCE_DEFINITIONS = [
  {
    id: SEARCH_ALL_PLATFORM_ID,
    pendingPlatform: "external",
    color: "#3b82f6",
    icon: "search",
    radio: {
      id: SEARCH_ALL_PLATFORM_ID,
      name: "Search All",
      streamUrl: "",
      description: "Search across all platforms",
      enabled: true,
      platformMetadata: {
        platform: "bandcamp",
        itemType: "track",
        url: "",
      },
    },
  },
  {
    id: RADIO_GARDEN_PLATFORM_ID,
    pendingPlatform: "radiogarden",
    color: "#00d084",
    icon: "radio-garden",
    radio: {
      id: RADIO_GARDEN_PLATFORM_ID,
      name: "Radio Garden",
      streamUrl: "",
      description: "Search worldwide radio stations",
      enabled: true,
      platformMetadata: {
        platform: "radiogarden",
        itemType: "channel",
        url: "",
        channelId: "",
      },
    },
  },
  {
    id: BANDCAMP_PLATFORM_ID,
    pendingPlatform: "bandcamp",
    color: "#629aa0",
    icon: "bandcamp",
    radio: {
      id: BANDCAMP_PLATFORM_ID,
      name: "Bandcamp",
      streamUrl: "",
      description: "Tracks & albums from independent artists",
      enabled: true,
      platformMetadata: {
        platform: "bandcamp",
        itemType: "track",
        url: "",
      },
    },
  },
  {
    id: SOUNDCLOUD_PLATFORM_ID,
    pendingPlatform: "soundcloud",
    color: "#ff7700",
    icon: "soundcloud",
    radio: {
      id: SOUNDCLOUD_PLATFORM_ID,
      name: "SoundCloud",
      streamUrl: "",
      description: "Tracks, mixes & DJ sets",
      enabled: true,
      platformMetadata: {
        platform: "soundcloud",
        itemType: "track",
        url: "",
      },
    },
  },
  {
    id: YOUTUBE_PLATFORM_ID,
    pendingPlatform: "youtube",
    color: "#ff0000",
    icon: "youtube",
    radio: {
      id: YOUTUBE_PLATFORM_ID,
      name: "YouTube",
      streamUrl: "",
      description: "Music videos & audio",
      enabled: true,
      platformMetadata: {
        platform: "youtube",
        itemType: "video",
        url: "",
      },
    },
  },
  {
    id: STATIC_AUDIO_PLATFORM_ID,
    pendingPlatform: "static-audio",
    color: "#8b5cf6",
    icon: "static-audio",
    radio: {
      id: STATIC_AUDIO_PLATFORM_ID,
      name: "Audio File",
      streamUrl: "",
      description: "Load from file or URL (MP3, M3U, etc.)",
      enabled: true,
      platformMetadata: {
        platform: "static-audio",
        itemType: "track",
        url: "",
        fileName: "",
        displayName: "",
        duration: 0,
        fileSize: 0,
        mimeType: "",
        streamUrl: "",
        isLocal: true,
        requiresProxy: false,
      },
    },
  },
  {
    id: AUDIO_INPUT_PLATFORM_ID,
    pendingPlatform: "device-input",
    color: "#10b981",
    icon: "audio-input",
    radio: {
      id: AUDIO_INPUT_PLATFORM_ID,
      name: "Audio Input",
      streamUrl: "",
      description: "Route mic/line-in from your audio interface",
      enabled: true,
      platformMetadata: {
        platform: "device-input",
        itemType: "track",
        url: "",
        deviceId: "",
        deviceLabel: "",
        channelSelection: { left: 0, right: 1 },
        channelCount: 2,
      },
    },
  },
] as const satisfies readonly PlatformSourceDefinition[];

export const PLATFORM_ITEMS: Radio[] = PLATFORM_SOURCE_DEFINITIONS.map(
  ({ radio }) => radio
);

export function getPlatformSourceDefinition(
  radio: Radio
): PlatformSourceDefinition | null {
  return PLATFORM_SOURCE_DEFINITIONS.find(({ id }) => id === radio.id) ?? null;
}

export function isPlatformPlaceholderItem(radio: Radio): boolean {
  return getPlatformSourceDefinition(radio) !== null;
}

export function getPlatformFromPlaceholderItem(radio: Radio): Platform | null {
  return (
    getPlatformSourceDefinition(radio)?.pendingPlatform ??
    radio.platformMetadata?.platform ??
    null
  );
}

export function getPlatformSourceColor(platform: Platform | null): string {
  return (
    PLATFORM_SOURCE_DEFINITIONS.find(
      ({ pendingPlatform }) => pendingPlatform === platform
    )?.color ?? "#ff7700"
  );
}

export function getDeckLibrarySourceIntent(
  radio: Radio
): DeckLibrarySourceIntent {
  const definition = getPlatformSourceDefinition(radio);
  if (!definition) {
    return { type: "load", source: { type: "radio", radio } };
  }
  return { type: "pending-platform", platform: definition.pendingPlatform };
}

export function createStaticAudioRadio(url: string): Radio {
  const displayName = getFilenameFromUrl(url);
  const metadata: StaticAudioMetadata = {
    platform: "static-audio",
    itemType: "track",
    url,
    fileName: displayName,
    displayName,
    duration: 0,
    fileSize: 0,
    mimeType: "audio/mpeg",
    streamUrl: url,
    isLocal: false,
    requiresProxy: false,
  };
  return createPlatformRadio(url, metadata);
}
