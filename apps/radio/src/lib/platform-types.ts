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

// Local file metadata
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
  | "local-file";
export type PlatformMetadata =
  | BandcampMetadata
  | SoundCloudMetadata
  | YouTubeMetadata
  | DeviceInputMetadata
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
