/**
 * Unified search types for external platform search.
 */

export type SearchPlatform = "all" | "bandcamp" | "soundcloud" | "youtube";

export type SearchResultType =
  | "track"
  | "album"
  | "video"
  | "playlist"
  | "artist";

export type UnifiedSearchResult = {
  id: string;
  platform: "bandcamp" | "soundcloud" | "youtube";
  type: SearchResultType;
  title: string;
  artist: string;
  thumbnail?: string;
  duration?: number; // seconds
  url: string; // Full URL for loading via loadPlatformItem
  albumTitle?: string; // For tracks that belong to albums
};

export type UnifiedSearchResponse =
  | { success: true; results: UnifiedSearchResult[] }
  | { success: false; error: string };
