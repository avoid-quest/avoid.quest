import type { BandcampSearchResult } from "./bandcamp/search.js";
import type { RadioGardenSearchResult } from "./radiogarden/types.js";
import type { SoundCloudSearchResult } from "./soundcloud/search.js";
import type { YouTubeSearchResult } from "./youtube/types.js";

export type SearchPlatform =
  | "all"
  | "bandcamp"
  | "radiogarden"
  | "soundcloud"
  | "youtube";

export type SearchResultType =
  | "track"
  | "album"
  | "video"
  | "playlist"
  | "artist"
  | "station";

export type UnifiedSearchResult = {
  id: string;
  platform: "bandcamp" | "radiogarden" | "soundcloud" | "youtube";
  type: SearchResultType;
  title: string;
  artist: string;
  thumbnail?: string;
  duration?: number;
  url: string;
  albumTitle?: string;
};

export type UnifiedSearchResponse =
  | { success: true; results: UnifiedSearchResult[] }
  | { success: false; error: string };

export function transformBandcampResults(
  results: BandcampSearchResult[]
): UnifiedSearchResult[] {
  return results.map((r) => ({
    id: `bc-${r.id}`,
    platform: "bandcamp" as const,
    type: r.type,
    title: r.title,
    artist: r.artist,
    thumbnail: r.thumbnail,
    url: r.url,
    albumTitle: r.albumTitle,
  }));
}

export function transformSoundCloudResults(
  results: SoundCloudSearchResult[]
): UnifiedSearchResult[] {
  return results.map((r) => ({
    id: `sc-${r.id}`,
    platform: "soundcloud" as const,
    type: "track" as const,
    title: r.title,
    artist: r.artist,
    thumbnail: r.thumbnail,
    duration: r.duration,
    url: r.url,
  }));
}

export function transformYouTubeResults(
  results: YouTubeSearchResult[]
): UnifiedSearchResult[] {
  return results.map((r) => ({
    id: `yt-${r.videoId}`,
    platform: "youtube" as const,
    type: "video" as const,
    title: r.title,
    artist: r.author,
    thumbnail: r.thumbnail,
    duration: r.duration,
    url: `https://youtube.com/watch?v=${r.videoId}`,
  }));
}

export function transformRadioGardenResults(
  results: RadioGardenSearchResult[]
): UnifiedSearchResult[] {
  return results.map((r) => ({
    id: `rg-${r.channelId}`,
    platform: "radiogarden" as const,
    type: "station" as const,
    title: r.title,
    artist: `${r.placeTitle}, ${r.countryTitle}`,
    url: r.url,
  }));
}
