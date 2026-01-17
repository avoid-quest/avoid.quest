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

// Unified platform types
export type Platform = "bandcamp" | "soundcloud";
export type PlatformMetadata = BandcampMetadata | SoundCloudMetadata;
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
