import type { Radio } from "@/lib/audio";
import type { Platform } from "@/lib/platform-types";

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
    color: "#3b82f6",
    icon: "search",
    id: SEARCH_ALL_PLATFORM_ID,
    pendingPlatform: "external",
    radio: {
      description: "Search across all platforms",
      enabled: true,
      id: SEARCH_ALL_PLATFORM_ID,
      name: "Search All",
      platformMetadata: {
        itemType: "track",
        platform: "bandcamp",
        url: "",
      },
      streamUrl: "",
    },
  },
  {
    color: "#00d084",
    icon: "radio-garden",
    id: RADIO_GARDEN_PLATFORM_ID,
    pendingPlatform: "radiogarden",
    radio: {
      description: "Search worldwide radio stations",
      enabled: true,
      id: RADIO_GARDEN_PLATFORM_ID,
      name: "Radio Garden",
      platformMetadata: {
        channelId: "",
        itemType: "channel",
        platform: "radiogarden",
        url: "",
      },
      streamUrl: "",
    },
  },
  {
    color: "#629aa0",
    icon: "bandcamp",
    id: BANDCAMP_PLATFORM_ID,
    pendingPlatform: "bandcamp",
    radio: {
      description: "Tracks & albums from independent artists",
      enabled: true,
      id: BANDCAMP_PLATFORM_ID,
      name: "Bandcamp",
      platformMetadata: {
        itemType: "track",
        platform: "bandcamp",
        url: "",
      },
      streamUrl: "",
    },
  },
  {
    color: "#ff7700",
    icon: "soundcloud",
    id: SOUNDCLOUD_PLATFORM_ID,
    pendingPlatform: "soundcloud",
    radio: {
      description: "Tracks, mixes & DJ sets",
      enabled: true,
      id: SOUNDCLOUD_PLATFORM_ID,
      name: "SoundCloud",
      platformMetadata: {
        itemType: "track",
        platform: "soundcloud",
        url: "",
      },
      streamUrl: "",
    },
  },
  {
    color: "#ff0000",
    icon: "youtube",
    id: YOUTUBE_PLATFORM_ID,
    pendingPlatform: "youtube",
    radio: {
      description: "Music videos & audio",
      enabled: true,
      id: YOUTUBE_PLATFORM_ID,
      name: "YouTube",
      platformMetadata: {
        itemType: "video",
        platform: "youtube",
        url: "",
      },
      streamUrl: "",
    },
  },
  {
    color: "#8b5cf6",
    icon: "static-audio",
    id: STATIC_AUDIO_PLATFORM_ID,
    pendingPlatform: "static-audio",
    radio: {
      description: "Load from file or URL (MP3, M3U, etc.)",
      enabled: true,
      id: STATIC_AUDIO_PLATFORM_ID,
      name: "Audio File",
      platformMetadata: {
        displayName: "",
        duration: 0,
        fileName: "",
        fileSize: 0,
        isLocal: true,
        itemType: "track",
        mimeType: "",
        platform: "static-audio",
        streamUrl: "",
        url: "",
      },
      streamUrl: "",
    },
  },
  {
    color: "#10b981",
    icon: "audio-input",
    id: AUDIO_INPUT_PLATFORM_ID,
    pendingPlatform: "device-input",
    radio: {
      description: "Route mic/line-in from your audio interface",
      enabled: true,
      id: AUDIO_INPUT_PLATFORM_ID,
      name: "Audio Input",
      platformMetadata: {
        channelCount: 2,
        channelSelection: { left: 0, right: 1 },
        deviceId: "",
        deviceLabel: "",
        itemType: "track",
        platform: "device-input",
        url: "",
      },
      streamUrl: "",
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
    return { source: { radio, type: "radio" }, type: "load" };
  }
  return { platform: definition.pendingPlatform, type: "pending-platform" };
}
