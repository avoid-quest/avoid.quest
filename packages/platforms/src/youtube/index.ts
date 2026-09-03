import {
  detectYouTubeItemType,
  extractPlaylistId,
  extractVideoId,
} from "./detect.js";
import {
  fetchInvidiousPlaylist,
  fetchInvidiousVideo,
  getBestThumbnail,
  type InvidiousOptions,
  selectBestAudioStream,
} from "./invidious.js";
import type {
  YouTubeItemError,
  YouTubeItemResponse,
  YouTubeItemResult,
  YouTubeTrackInfo,
} from "./types.js";

export type { YouTubeClient } from "./client.js";
export { createYouTubeClient } from "./client.js";
export {
  detectYouTubeItemType,
  extractVideoId,
  isYouTubeUrl,
} from "./detect.js";
// Re-export Invidious types for consumers that need them
export type {
  InvidiousAdaptiveFormat,
  InvidiousOptions,
  InvidiousPlaylistResponse,
  InvidiousSearchResult,
  InvidiousVideoResponse,
} from "./invidious.js";
export { createBrowserInvidiousAdapter } from "./invidious-browser.js";
export { createPipedAdapter } from "./piped.js";
export type {
  YouTubeProviderAdapter,
  YouTubeProviderAdapterOptions,
  YouTubeProviderErrorCode,
  YouTubeProviderKind,
  YouTubeProviderProbe,
  YouTubeProviderSearchFilter,
} from "./provider.js";
export {
  YouTubeProviderAggregateError,
  YouTubeProviderError,
} from "./provider.js";
export { searchYouTubeMusic } from "./search.js";
export type {
  YouTubeItemError,
  YouTubeItemResponse,
  YouTubeItemResult,
  YouTubeItemType,
  YouTubeMetadata,
  YouTubeSearchResponse,
  YouTubeSearchResult,
  YouTubeTrackInfo,
} from "./types.js";

// ============================================
// URL Handling
// ============================================

const DEFAULT_INSTANCE = "https://yt.avoid.quest";

/**
 * Get full stream URL.
 * With local=true, Invidious returns relative URLs that proxy through itself.
 * We just need to prepend the instance URL.
 */
export function getFullStreamUrl(url: string, instanceUrl?: string): string {
  // If URL is relative (starts with /), prepend instance URL
  if (url.startsWith("/")) {
    return `${instanceUrl ?? DEFAULT_INSTANCE}${url}`;
  }
  return url;
}

// ============================================
// Core Functions
// ============================================

function createError(message: string): YouTubeItemError {
  return { error: message, success: false };
}

/**
 * Get YouTube item (video or playlist) metadata and stream URL.
 * Uses Invidious API.
 *
 * @param url - YouTube video or playlist URL
 * @param options - Optional Invidious instance configuration
 */
export function getYouTubeItem(
  url: string,
  options?: InvidiousOptions
): Promise<YouTubeItemResponse> {
  const itemType = detectYouTubeItemType(url);
  if (itemType === "playlist") {
    return processPlaylist(url, options);
  }
  return processVideo(url, options);
}

/**
 * Resolve a stream URL for a video ID.
 * Returns proxied URL ready for playback.
 *
 * @param videoId - YouTube video ID
 * @param options - Optional Invidious instance configuration
 */
export async function resolveStreamUrl(
  videoId: string,
  options?: InvidiousOptions
): Promise<string | null> {
  const data = await fetchInvidiousVideo(videoId, options);
  const stream = selectBestAudioStream(data.adaptiveFormats);
  if (stream) {
    return getFullStreamUrl(stream.url, options?.instanceUrl);
  }
  return null;
}

// ============================================
// Video Processing
// ============================================

async function processVideo(
  url: string,
  options?: InvidiousOptions
): Promise<YouTubeItemResult | YouTubeItemError> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    return createError("Could not extract video ID from URL");
  }

  try {
    const data = await fetchInvidiousVideo(videoId, options);

    if (data.liveNow) {
      return createError("Live streams are not supported");
    }

    const stream = selectBestAudioStream(data.adaptiveFormats);
    if (!stream) {
      return createError("No audio stream found");
    }

    const streamUrl = getFullStreamUrl(stream.url, options?.instanceUrl);
    const artwork = getBestThumbnail(
      data.videoThumbnails,
      options?.instanceUrl
    );

    return {
      metadata: {
        artist: data.author,
        artwork,
        duration: data.lengthSeconds,
        itemType: "video",
        name: data.title,
        platform: "youtube",
        streamUrl,
        url,
        videoId,
      },
      streamUrl,
      success: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return createError(msg);
  }
}

// ============================================
// Playlist Processing
// ============================================

async function processPlaylist(
  url: string,
  options?: InvidiousOptions
): Promise<YouTubeItemResult | YouTubeItemError> {
  const playlistId = extractPlaylistId(url);
  if (!playlistId) {
    return createError("Could not extract playlist ID from URL");
  }

  try {
    const data = await fetchInvidiousPlaylist(playlistId, options);

    // Convert Invidious tracks to our format
    // Note: streamUrl uses yt:{videoId} convention - resolved on play
    const tracks: YouTubeTrackInfo[] = data.videos.map((video) => ({
      duration: video.lengthSeconds,
      name: video.title,
      streamUrl: `yt:${video.videoId}`,
      thumbnail: getBestThumbnail(video.videoThumbnails, options?.instanceUrl),
      videoId: video.videoId,
    }));

    // Use playlist thumbnail or first track's thumbnail
    const artwork = data.playlistThumbnail || tracks[0]?.thumbnail || "";

    return {
      metadata: {
        artist: data.author,
        artwork,
        itemType: "playlist",
        name: data.title,
        platform: "youtube",
        playlistId,
        trackCount: data.videoCount,
        tracks,
        url,
      },
      streamUrl: tracks[0]?.streamUrl ?? "",
      success: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return createError(msg);
  }
}
