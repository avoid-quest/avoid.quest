export type Platform = "bandcamp" | "soundcloud";

export type BandcampItemType = "album" | "track" | "artist" | "label";

export type SoundCloudItemType = "track" | "playlist" | "user";

export type BandcampTrackInfo = {
  name: string;
  streamUrl: string;
  duration?: number;
  trackNumber?: number;
};

export type SoundCloudTrackInfo = {
  name: string;
  streamUrl: string;
  duration?: number;
};

export type BandcampMetadata = {
  platform: "bandcamp";
  itemType: BandcampItemType;
  url: string;
  name?: string;
  artist?: string;
  artwork?: string;
  albumName?: string;
  trackNumber?: number;
  duration?: number;
  trackCount?: number;
  tracks?: BandcampTrackInfo[];
  streamUrl?: string;
};

export type SoundCloudMetadata = {
  platform: "soundcloud";
  itemType: SoundCloudItemType;
  url: string;
  name?: string;
  artist?: string;
  artwork?: string;
  albumName?: string;
  duration?: number;
  trackCount?: number;
  tracks?: SoundCloudTrackInfo[];
  streamUrl?: string;
};

export type PlatformMetadata = BandcampMetadata | SoundCloudMetadata;

export type PlatformTrack = BandcampTrackInfo | SoundCloudTrackInfo;

export type BandcampItemResult = {
  success: true;
  metadata: BandcampMetadata;
  streamUrl: string;
};

export type SoundCloudItemResult = {
  success: true;
  metadata: SoundCloudMetadata;
  streamUrl: string;
};

export type PlatformItemResult = BandcampItemResult | SoundCloudItemResult;

export type PlatformItemError = {
  success: false;
  error: string;
};

export type PlatformItemResponse = PlatformItemResult | PlatformItemError;

export type Radio = {
  id?: number;
  name: string;
  streamUrl: string;
  logoUrl?: string;
  description?: string;
  websiteUrl?: string;
  order?: number;
  enabled?: boolean;
  platformMetadata?: PlatformMetadata;
};

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
