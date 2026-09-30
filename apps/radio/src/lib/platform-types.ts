import type {
  BandcampItemError,
  BandcampItemResult,
  BandcampMetadata,
  BandcampTrackInfo,
  RadioGardenItemError,
  RadioGardenItemResult,
  RadioGardenMetadata,
  SoundCloudItemError,
  SoundCloudItemResult,
  SoundCloudMetadata,
  SoundCloudTrackInfo,
  YouTubeItemError,
  YouTubeItemResult,
  YouTubeMetadata,
  YouTubeTrackInfo,
} from "@avoid.quest/platforms";

// Re-export platform types from @avoid.quest/platforms
export type {
  BandcampItemError,
  BandcampItemResponse,
  BandcampItemResult,
  BandcampItemType,
  BandcampMetadata,
  BandcampTrackInfo,
  RadioGardenItemError,
  RadioGardenItemResponse,
  RadioGardenItemResult,
  RadioGardenMetadata,
  RadioGardenSearchResult,
  SoundCloudItemError,
  SoundCloudItemResponse,
  SoundCloudItemResult,
  SoundCloudItemType,
  SoundCloudMetadata,
  SoundCloudTrackInfo,
  YouTubeItemError,
  YouTubeItemResponse,
  YouTubeItemResult,
  YouTubeItemType,
  YouTubeMetadata,
  YouTubeSearchResponse,
  YouTubeSearchResult,
  YouTubeTrackInfo,
} from "@avoid.quest/platforms";

import type { ChannelSelection } from "@/lib/audio";

// Device input metadata
export type DeviceInputMetadata = {
  capture?: "display";
  sourceUrl?: string;
  platform: "device-input";
  itemType: "track";
  url: "";
  deviceId: string;
  deviceLabel: string;
  channelSelection: ChannelSelection;
  channelCount: number;
  channelMode?: string; // deprecated, backward compat
};

export function isDeviceInputMetadata(
  metadata: PlatformMetadata | undefined | null
): metadata is DeviceInputMetadata {
  return metadata?.platform === "device-input";
}

// Static audio track (for playlists)
export type StaticAudioTrack = {
  format?: "hls" | "progressive";
  title: string;
  streamUrl: string;
  duration?: number;
};

// Static audio metadata (local files and remote URLs)
export type StaticAudioMetadata = {
  platform: "static-audio";
  itemType: "track" | "playlist";
  url: string; // Original URL (empty for local files)

  // Track info
  fileName: string;
  displayName: string;
  duration: number;
  fileSize: number;
  mimeType: string;

  // Stream handling
  streamUrl: string; // Blob URL (local) or HTTP URL (remote)
  isLocal: boolean;

  // Playlist only
  tracks?: StaticAudioTrack[];
  playlistName?: string;
  playlistFormat?: "m3u" | "pls";
};

export function isStaticAudioMetadata(
  metadata: PlatformMetadata | undefined | null
): metadata is StaticAudioMetadata {
  return metadata?.platform === "static-audio";
}

// Legacy alias for backward compatibility
/** @deprecated Use StaticAudioMetadata instead */
export type FileMetadata = {
  platform: "local-file";
  itemType: "track";
  url: "";
  fileName: string;
  displayName: string;
  duration: number;
  fileSize: number;
  mimeType: string;
  objectUrl: string;
};

/** @deprecated Use isStaticAudioMetadata instead */
export function isFileMetadata(
  metadata: PlatformMetadata | undefined | null
): metadata is FileMetadata {
  return metadata?.platform === "local-file";
}

export function isRadioGardenMetadata(
  metadata: PlatformMetadata | undefined | null
): metadata is RadioGardenMetadata {
  return metadata?.platform === "radiogarden";
}

export type RadioBrowserMetadata = {
  platform: "radio-browser";
  itemType: "station";
  url: string;
  stationUuid: string;
  hls: boolean;
  /** As Radio Browser listed it at discovery, e.g. "MP3"; the media element can't tell. */
  codec?: string;
  /** kbps, as Radio Browser listed it at discovery. */
  bitrate?: number;
};

export function isRadioBrowserMetadata(
  metadata: PlatformMetadata | undefined | null
): metadata is RadioBrowserMetadata {
  return metadata?.platform === "radio-browser";
}

export function isYouTubeMetadata(
  metadata: PlatformMetadata | undefined | null
): metadata is YouTubeMetadata {
  return metadata?.platform === "youtube";
}

// Re-export for convenience
export type { FileAudioMetadata } from "@/lib/audio/file-metadata";

// Unified platform types (app-level, includes device-input/static-audio/local-file)
export type Platform =
  | "bandcamp"
  | "radio-browser"
  | "radiogarden"
  | "soundcloud"
  | "youtube"
  | "device-input"
  | "static-audio"
  | "browser-audio"
  | "spotify"
  | "mixcloud"
  | "radio-shows"
  | "external"
  | "local-file"; // deprecated, use "static-audio"
export type PlatformMetadata =
  | BandcampMetadata
  | RadioBrowserMetadata
  | RadioGardenMetadata
  | SoundCloudMetadata
  | YouTubeMetadata
  | DeviceInputMetadata
  | StaticAudioMetadata
  | FileMetadata;
export type PlatformTrack =
  | BandcampTrackInfo
  | SoundCloudTrackInfo
  | YouTubeTrackInfo
  | StaticAudioTrack;
export type StaticAudioItemResult = {
  success: true;
  metadata: StaticAudioMetadata;
  streamUrl: string;
};
export type StaticAudioItemError = {
  success: false;
  error: string;
};
export type StaticAudioItemResponse =
  | StaticAudioItemResult
  | StaticAudioItemError;
export type PlatformItemResult =
  | BandcampItemResult
  | RadioGardenItemResult
  | SoundCloudItemResult
  | YouTubeItemResult
  | StaticAudioItemResult;
export type PlatformItemError =
  | BandcampItemError
  | RadioGardenItemError
  | SoundCloudItemError
  | YouTubeItemError
  | StaticAudioItemError;
export type PlatformItemResponse = PlatformItemResult | PlatformItemError;

export type ScrapedOption = {
  value: string;
  label: string;
  confidence: number;
  preview?: string;
};

export type RadioMetadata = {
  name?: ScrapedOption[];
  streamUrl?: ScrapedOption[];
  logoUrl?: ScrapedOption[];
  description?: ScrapedOption[];
  websiteUrl?: string;
  foundFields: string[];
  missingFields: string[];
};
