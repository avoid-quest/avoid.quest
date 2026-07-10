import type { PlatformStreamFormat } from "../stream-format.js";

export type BandcampItemType =
  | "album"
  | "track"
  | "artist"
  | "label"
  | "collection";

export type BandcampTrackInfo = {
  format?: PlatformStreamFormat;
  name: string;
  streamUrl: string;
  duration?: number;
  trackNumber?: number;
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

export type BandcampItemResult = {
  format?: PlatformStreamFormat;
  success: true;
  metadata: BandcampMetadata;
  streamUrl: string;
};

export type BandcampItemError = {
  success: false;
  error: string;
};

export type BandcampItemResponse = BandcampItemResult | BandcampItemError;
