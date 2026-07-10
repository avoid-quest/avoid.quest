import type { PlatformStreamFormat } from "../stream-format.js";

export type SoundCloudItemType = "track" | "playlist" | "user";

export type SoundCloudTrackInfo = {
  format?: PlatformStreamFormat;
  name: string;
  streamUrl: string;
  duration?: number;
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

export type SoundCloudItemResult = {
  format?: PlatformStreamFormat;
  success: true;
  metadata: SoundCloudMetadata;
  streamUrl: string;
};

export type SoundCloudItemError = {
  success: false;
  error: string;
};

export type SoundCloudItemResponse = SoundCloudItemResult | SoundCloudItemError;
