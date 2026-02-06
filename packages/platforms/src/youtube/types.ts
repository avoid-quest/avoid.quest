export type AudioFormat = {
  type: string;
  url: string;
  itag: string;
  bitrate: string;
};

export type YouTubeItemType = "video" | "playlist";

export type YouTubeTrackInfo = {
  name: string;
  streamUrl: string;
  duration?: number;
  videoId: string;
  thumbnail?: string;
};

export type YouTubeMetadata = {
  platform: "youtube";
  itemType: YouTubeItemType;
  url: string;
  name?: string;
  artist?: string;
  artwork?: string;
  videoId?: string;
  playlistId?: string;
  duration?: number;
  trackCount?: number;
  tracks?: YouTubeTrackInfo[];
  streamUrl?: string;
};

export type YouTubeItemResult = {
  success: true;
  metadata: YouTubeMetadata;
  streamUrl: string;
};

export type YouTubeItemError = {
  success: false;
  error: string;
};

export type YouTubeItemResponse = YouTubeItemResult | YouTubeItemError;

export type YouTubeSearchResult = {
  videoId: string;
  title: string;
  author: string;
  duration?: number;
  thumbnail?: string;
  views?: string;
};

export type YouTubeSearchResponse =
  | { success: true; results: YouTubeSearchResult[] }
  | { success: false; error: string };
