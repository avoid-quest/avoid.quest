export type SoundCloudItemType = "track" | "playlist" | "user";

export type SoundCloudTrackInfo = {
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
  success: true;
  metadata: SoundCloudMetadata;
  streamUrl: string;
};

export type SoundCloudItemError = {
  success: false;
  error: string;
};

export type SoundCloudItemResponse = SoundCloudItemResult | SoundCloudItemError;
