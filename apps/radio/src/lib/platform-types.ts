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

// Unified platform types
export type Platform = "bandcamp" | "soundcloud" | "device-input";
export type PlatformMetadata =
  | BandcampMetadata
  | SoundCloudMetadata
  | DeviceInputMetadata;
export type PlatformTrack = BandcampTrackInfo | SoundCloudTrackInfo;
export type PlatformItemResult = BandcampItemResult | SoundCloudItemResult;
export type PlatformItemError = BandcampItemError | SoundCloudItemError;
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
