export type Platform = "bandcamp" | "soundcloud";

export type BandcampItemType = "album" | "track" | "artist" | "label";

export type SoundCloudItemType = "track" | "playlist" | "user";

export type BandcampAction = "playAlbum" | "playTrack" | "playArtist";

export type SoundCloudAction = "playTrack" | "playPlaylist" | "playUser";

export type PlatformAction = BandcampAction | SoundCloudAction;

export type BandcampMetadata = {
  platform: "bandcamp";
  itemType: BandcampItemType;
  url: string;
  name?: string;
  artist?: string;
  artwork?: string;
  albumName?: string;
  trackNumber?: number;
  tracks?: Array<{
    name: string;
    streamUrl: string;
    duration?: number;
    trackNumber?: number;
  }>;
  streamUrl?: string;
};

export type SoundCloudMetadata = {
  platform: "soundcloud";
  itemType: SoundCloudItemType;
  url: string;
  name?: string;
  artist?: string;
  artwork?: string;
  duration?: number;
  trackCount?: number;
  tracks?: Array<{
    name: string;
    streamUrl: string;
    duration?: number;
  }>;
  streamUrl?: string;
};

export type PlatformMetadata = BandcampMetadata | SoundCloudMetadata;

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
