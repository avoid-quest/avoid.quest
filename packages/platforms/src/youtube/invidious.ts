/**
 * Invidious API client for YouTube audio extraction.
 *
 * Invidious provides a privacy-friendly YouTube API with direct stream URLs.
 * Uses invidious-companion for poToken handling.
 *
 * Configuration:
 * - Pass instanceUrl parameter for self-hosted instance
 */

// ============================================
// Types
// ============================================

export type InvidiousOptions = {
  instanceUrl?: string;
  /** Basic auth credentials in format "username:password" */
  auth?: string;
};

export type InvidiousAdaptiveFormat = {
  url: string;
  bitrate: string;
  type: string;
  clen: string;
  container: string;
  encoding: string;
  audioQuality?: string;
  audioSampleRate?: number;
  audioChannels?: number;
};

export type InvidiousVideoThumbnail = {
  quality: string;
  url: string;
  width: number;
  height: number;
};

export type InvidiousVideoResponse = {
  type: string;
  title: string;
  videoId: string;
  author: string;
  authorId: string;
  lengthSeconds: number;
  videoThumbnails: InvidiousVideoThumbnail[];
  adaptiveFormats: InvidiousAdaptiveFormat[];
  liveNow: boolean;
};

export type InvidiousPlaylistVideo = {
  title: string;
  videoId: string;
  author: string;
  authorId: string;
  lengthSeconds: number;
  videoThumbnails: InvidiousVideoThumbnail[];
};

export type InvidiousPlaylistResponse = {
  type: string;
  title: string;
  playlistId: string;
  author: string;
  authorId: string;
  playlistThumbnail: string;
  videoCount: number;
  videos: InvidiousPlaylistVideo[];
};

export type InvidiousSearchResult = {
  type: string;
  title: string;
  videoId: string;
  author: string;
  authorId: string;
  lengthSeconds: number;
  viewCount: number;
  videoThumbnails: InvidiousVideoThumbnail[];
};

// ============================================
// Instance Management
// ============================================

const DEFAULT_INSTANCE = "https://yt.avoid.quest";

function getInstanceUrl(options?: InvidiousOptions): string {
  return options?.instanceUrl ?? DEFAULT_INSTANCE;
}

/**
 * Fetch from Invidious API
 */
async function fetchInvidious<T>(
  path: string,
  options?: InvidiousOptions
): Promise<T> {
  const instance = getInstanceUrl(options);
  const url = `${instance}${path}`;

  const headers: HeadersInit = {};
  if (options?.auth) {
    headers.Authorization = `Basic ${btoa(options.auth)}`;
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as T;
}

// ============================================
// API Functions
// ============================================

/**
 * Fetch video data (metadata + adaptive formats with stream URLs)
 * Uses local=true to get proxied URLs through Invidious (avoids IP-locked streams)
 */
export function fetchInvidiousVideo(
  videoId: string,
  options?: InvidiousOptions
): Promise<InvidiousVideoResponse> {
  return fetchInvidious<InvidiousVideoResponse>(
    `/api/v1/videos/${videoId}?local=true`,
    options
  );
}

/**
 * Fetch playlist data
 */
export function fetchInvidiousPlaylist(
  playlistId: string,
  options?: InvidiousOptions
): Promise<InvidiousPlaylistResponse> {
  return fetchInvidious<InvidiousPlaylistResponse>(
    `/api/v1/playlists/${playlistId}`,
    options
  );
}

/**
 * Search Invidious for videos
 */
export async function searchInvidious(
  query: string,
  options?: InvidiousOptions
): Promise<InvidiousSearchResult[]> {
  const encoded = encodeURIComponent(query);
  const results = await fetchInvidious<InvidiousSearchResult[]>(
    `/api/v1/search?q=${encoded}&type=video`,
    options
  );
  // Filter to only video results (search can return channels/playlists)
  return results.filter((r) => r.type === "video");
}

// ============================================
// Audio Stream Selection
// ============================================

/**
 * Select best audio stream from Invidious adaptiveFormats.
 * Prefers Opus codec for better quality at same bitrate.
 */
export function selectBestAudioStream(
  formats: InvidiousAdaptiveFormat[]
): InvidiousAdaptiveFormat | null {
  // Filter to audio-only formats
  const audioFormats = formats.filter((f) => f.type.startsWith("audio/"));

  if (audioFormats.length === 0) {
    return null;
  }

  // Prefer Opus (better quality at same bitrate)
  const opus = audioFormats.filter(
    (f) => f.encoding === "opus" || f.container === "webm"
  );
  if (opus.length > 0) {
    return opus.reduce((best, f) =>
      Number(f.bitrate) > Number(best.bitrate) ? f : best
    );
  }

  // Fallback to AAC
  const aac = audioFormats.filter(
    (f) => f.encoding === "aac" || f.container === "m4a"
  );
  if (aac.length > 0) {
    return aac.reduce((best, f) =>
      Number(f.bitrate) > Number(best.bitrate) ? f : best
    );
  }

  // Any audio
  return audioFormats[0] ?? null;
}

/**
 * Get the best thumbnail URL from video thumbnails.
 * Prefers medium/high quality as maxresdefault doesn't exist for all videos.
 */
export function getBestThumbnail(
  thumbnails: InvidiousVideoThumbnail[],
  instanceUrl?: string
): string {
  // Quality preference order: sddefault > high > medium > maxresdefault > any
  // maxresdefault often returns 404 for older/shorter videos
  const qualityOrder = ["sddefault", "high", "medium", "maxresdefault"];

  let thumbnail: InvidiousVideoThumbnail | undefined;
  for (const quality of qualityOrder) {
    thumbnail = thumbnails.find((t) => t.quality === quality);
    if (thumbnail) {
      break;
    }
  }

  // Fallback to first available
  thumbnail = thumbnail ?? thumbnails[0];

  if (!thumbnail) {
    return "";
  }

  // Thumbnail URLs are relative, prepend instance URL
  if (thumbnail.url.startsWith("/")) {
    const base = instanceUrl ?? DEFAULT_INSTANCE;
    return `${base}${thumbnail.url}`;
  }

  return thumbnail.url;
}
