import type { YouTubeSearchResult } from "../youtube/types.js";

export type SpotifyItemType = "track" | "album" | "playlist";

/** A YouTube upload chosen to stand in for a Spotify track. */
export type SpotifyYouTubeMatch = {
  videoId: string;
  title: string;
  author: string;
  /** YouTube duration in seconds. */
  duration?: number;
  /** Absolute difference from the Spotify duration, in seconds. */
  durationDelta?: number;
  /** Match confidence, 0 to 1. */
  score: number;
};

export type SpotifyTrackInfo = {
  name: string;
  /** Artist credit as Spotify shows it, e.g. "Justin Bieber, Nicki Minaj". */
  artist: string;
  album?: string;
  /** Spotify duration in seconds. */
  duration?: number;
  spotifyId: string;
  url: string;
  /**
   * `spotify:track:<id>` until the track is matched (see
   * `parseSpotifyTrackPlaceholder`), then the matched YouTube stream URL.
   */
  streamUrl: string;
  thumbnail?: string;
  /** Set once matched; re-resolve an expired stream from this id. */
  youtubeVideoId?: string;
  youtubeMatch?: SpotifyYouTubeMatch;
};

export type SpotifyMetadata = {
  platform: "spotify";
  itemType: SpotifyItemType;
  /** Canonical `https://open.spotify.com/<type>/<id>` URL. */
  url: string;
  spotifyId: string;
  name?: string;
  /** Track artists, album artist, or playlist owner. */
  artist?: string;
  artists?: string[];
  album?: string;
  artwork?: string;
  /** Seconds. A collection's duration is the sum of its listed tracks. */
  duration?: number;
  trackCount?: number;
  tracks?: SpotifyTrackInfo[];
  streamUrl?: string;
  /** Track links only, once matched. */
  youtubeVideoId?: string;
  youtubeMatch?: SpotifyYouTubeMatch;
};

export type SpotifyItemResult = {
  success: true;
  metadata: SpotifyMetadata;
  streamUrl: string;
};

export type SpotifyItemError = {
  success: false;
  error: string;
  /** The link is not a track, album or playlist: nothing failed. */
  unsupported?: true;
};

export type SpotifyItemResponse = SpotifyItemResult | SpotifyItemError;

export type SpotifyMetadataResponse =
  | { success: true; metadata: SpotifyMetadata }
  | SpotifyItemError;

/** What matching needs to know about a Spotify track. */
export type SpotifyMatchTrack = {
  name: string;
  /** Individual artist names, primary artist first. */
  artists: readonly string[];
  /**
   * The unsplit credit, when `artists` was split from one ("Tyler, The
   * Creator" reads as two artists but may be one).
   */
  artistCredit?: string;
  /** Seconds. */
  duration?: number;
};

export type SpotifyYouTubeCandidate = Pick<
  YouTubeSearchResult,
  "author" | "duration" | "title" | "videoId"
>;

/**
 * The YouTube operations the mirror needs. A `YouTubeClient` from
 * `createYouTubeClient` satisfies it as is.
 */
export type SpotifyYouTubeSource = {
  search: (
    query: string,
    filter?: "songs" | "videos",
    signal?: AbortSignal
  ) => Promise<readonly SpotifyYouTubeCandidate[]>;
  resolveStream: (videoId: string, signal?: AbortSignal) => Promise<string>;
};

export type SpotifyTrackStreamResponse =
  | { success: true; streamUrl: string; match: SpotifyYouTubeMatch }
  | SpotifyItemError;
