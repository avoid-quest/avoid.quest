import type {
  BandcampItemError,
  BandcampItemResult,
  BandcampMetadata,
  BandcampTrackInfo,
} from "@avoid.quest/bandcamp";
import type {
  SoundCloudItemError,
  SoundCloudItemResult,
  SoundCloudMetadata,
  SoundCloudTrackInfo,
} from "@avoid.quest/soundcloud";
import type {
  YouTubeItemError,
  YouTubeItemResult,
  YouTubeMetadata,
  YouTubeTrackInfo,
} from "@avoid.quest/youtube";

// Re-export individual platform types for external use
export type {
  BandcampItemError,
  BandcampItemResponse,
  BandcampItemResult,
  BandcampItemType,
  BandcampMetadata,
  BandcampTrackInfo,
} from "@avoid.quest/bandcamp";

export type {
  SoundCloudItemError,
  SoundCloudItemResponse,
  SoundCloudItemResult,
  SoundCloudItemType,
  SoundCloudMetadata,
  SoundCloudTrackInfo,
} from "@avoid.quest/soundcloud";

export type {
  YouTubeItemError,
  YouTubeItemResponse,
  YouTubeItemResult,
  YouTubeItemType,
  YouTubeMetadata,
  YouTubeSearchResponse,
  YouTubeSearchResult,
  YouTubeTrackInfo,
} from "@avoid.quest/youtube";

import type { ChannelSelection } from "@/lib/audio";

// Device input metadata
export type DeviceInputMetadata = {
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
  title: string;
  streamUrl: string;
  duration?: number;
  requiresProxy: boolean;
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
  requiresProxy: boolean;

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

export function isYouTubeMetadata(
  metadata: PlatformMetadata | undefined | null
): metadata is YouTubeMetadata {
  return metadata?.platform === "youtube";
}

// Re-export for convenience
export type { FileAudioMetadata } from "@/lib/audio/file-metadata";

// Unified platform types
export type Platform =
  | "bandcamp"
  | "soundcloud"
  | "youtube"
  | "device-input"
  | "static-audio"
  | "local-file"; // deprecated, use "static-audio"
export type PlatformMetadata =
  | BandcampMetadata
  | SoundCloudMetadata
  | YouTubeMetadata
  | DeviceInputMetadata
  | StaticAudioMetadata
  | FileMetadata;
export type PlatformTrack =
  | BandcampTrackInfo
  | SoundCloudTrackInfo
  | YouTubeTrackInfo;
export type PlatformItemResult =
  | BandcampItemResult
  | SoundCloudItemResult
  | YouTubeItemResult;
export type PlatformItemError =
  | BandcampItemError
  | SoundCloudItemError
  | YouTubeItemError;
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
