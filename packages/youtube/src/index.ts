import {
  detectYouTubeItemType,
  extractPlaylistId,
  extractVideoId,
} from "./detect.js";
import { getVideoDataIOS } from "./innertube.js";
import {
  getBestThumbnail,
  getPlaylistData,
  getVideoData,
  selectBestAudioStream,
} from "./invidious.js";
import { getPlaylistDataFromPiped, getVideoDataFromPiped } from "./piped.js";
import type {
  YouTubeItemError,
  YouTubeItemResponse,
  YouTubeItemResult,
  YouTubeMetadata,
  YouTubeTrackInfo,
} from "./types.js";
import {
  getVideoDataFromYoutubei,
  resolveStreamUrlFromYoutubei,
} from "./yt-client.js";

export {
  detectYouTubeItemType,
  extractVideoId,
  isYouTubeUrl,
} from "./detect.js";
export { searchYouTubeMusic } from "./search.js";
export type {
  AudioFormat,
  YouTubeItemError,
  YouTubeItemResponse,
  YouTubeItemResult,
  YouTubeItemType,
  YouTubeMetadata,
  YouTubeSearchResponse,
  YouTubeSearchResult,
  YouTubeTrackInfo,
} from "./types.js";

/** Check if a URL is a raw googlevideo.com stream that needs proxying */
function isGoogleVideoUrl(url: string): boolean {
  if (url.startsWith("/api/")) {
    return false;
  }
  try {
    return new URL(url).hostname.endsWith(".googlevideo.com");
  } catch {
    return false;
  }
}

/** Proxies raw googlevideo.com stream URLs through our proxy for CORS */
export function getProxiedYouTubeUrl(url: string): string {
  if (isGoogleVideoUrl(url)) {
    return `/api/youtube-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function proxyIfNeeded(streamUrl: string): string {
  if (isGoogleVideoUrl(streamUrl)) {
    return `/api/youtube-proxy?url=${encodeURIComponent(streamUrl)}`;
  }
  // Piped URLs are already proxied with CORS — use directly
  return streamUrl;
}

function createErrorResponse(message: string): YouTubeItemError {
  return {
    success: false,
    error: message,
  };
}

export async function getYouTubeItem(
  url: string
): Promise<YouTubeItemResponse> {
  try {
    const itemType = detectYouTubeItemType(url);

    if (itemType === "playlist") {
      return await processPlaylist(url);
    }
    return await processVideo(url);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return createErrorResponse(`Failed to get YouTube item: ${errorMessage}`);
  }
}

export async function resolveStreamUrl(
  videoId: string
): Promise<string | null> {
  // 1. youtubei.js
  try {
    const url = await resolveStreamUrlFromYoutubei(videoId);
    return proxyIfNeeded(url);
  } catch {
    // Fall through
  }

  // 2. IOS (no range restrictions)
  try {
    const data = await getVideoDataIOS(videoId);
    const stream = selectBestAudioStream(data.audioFormats);
    if (stream) {
      return proxyIfNeeded(stream.url);
    }
  } catch {
    // Fall through
  }

  // 3. Piped
  try {
    const data = await getVideoDataFromPiped(videoId);
    const stream = selectBestAudioStream(data.audioFormats);
    if (stream) {
      return proxyIfNeeded(stream.url);
    }
  } catch {
    // Fall through
  }

  // 4. Invidious
  try {
    const data = await getVideoData(videoId);
    const stream = selectBestAudioStream(data.adaptiveFormats);
    if (stream) {
      return proxyIfNeeded(stream.url);
    }
  } catch {
    // Fall through
  }

  return null;
}

async function processVideo(
  url: string
): Promise<YouTubeItemResult | YouTubeItemError> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    return createErrorResponse("Could not extract video ID from URL");
  }

  // 1. youtubei.js (direct URLs from TV/embedded clients)
  try {
    const data = await getVideoDataFromYoutubei(videoId);
    const streamUrl = proxyIfNeeded(data.streamUrl);

    const metadata: YouTubeMetadata = {
      platform: "youtube",
      itemType: "video",
      url,
      name: data.title,
      artist: data.author,
      artwork: data.thumbnail,
      videoId: data.videoId,
      duration: data.lengthSeconds,
      streamUrl,
    };

    return { success: true, metadata, streamUrl };
  } catch {
    // Fall through
  }

  // 2. Custom InnerTube IOS — stream URLs have no range restrictions
  try {
    const data = await getVideoDataIOS(videoId);
    const stream = selectBestAudioStream(data.audioFormats);
    if (stream) {
      const streamUrl = proxyIfNeeded(stream.url);

      const metadata: YouTubeMetadata = {
        platform: "youtube",
        itemType: "video",
        url,
        name: data.title,
        artist: data.author,
        artwork: getBestThumbnail(data.thumbnails),
        videoId: data.videoId,
        duration: data.lengthSeconds,
        streamUrl,
      };

      return { success: true, metadata, streamUrl };
    }
  } catch {
    // Fall through
  }

  // 3. Piped (pre-proxied URLs, no range restrictions)
  try {
    const data = await getVideoDataFromPiped(videoId);
    const stream = selectBestAudioStream(data.audioFormats);
    if (stream) {
      const streamUrl = proxyIfNeeded(stream.url);

      const metadata: YouTubeMetadata = {
        platform: "youtube",
        itemType: "video",
        url,
        name: data.title,
        artist: data.author,
        artwork: data.thumbnail,
        videoId: data.videoId,
        duration: data.duration,
        streamUrl,
      };

      return { success: true, metadata, streamUrl };
    }
  } catch {
    // Fall through
  }

  // 4. Invidious
  try {
    const data = await getVideoData(videoId);
    const stream = selectBestAudioStream(data.adaptiveFormats);

    if (stream) {
      const streamUrl = proxyIfNeeded(stream.url);
      const artwork = getBestThumbnail(data.videoThumbnails);

      const metadata: YouTubeMetadata = {
        platform: "youtube",
        itemType: "video",
        url,
        name: data.title,
        artist: data.author,
        artwork,
        videoId: data.videoId,
        duration: data.lengthSeconds,
        streamUrl,
      };

      return { success: true, metadata, streamUrl };
    }
  } catch {
    // Fall through
  }

  return createErrorResponse(
    "This video is not available for streaming right now"
  );
}

async function processPlaylist(
  url: string
): Promise<YouTubeItemResult | YouTubeItemError> {
  const playlistId = extractPlaylistId(url);
  if (!playlistId) {
    return createErrorResponse("Could not extract playlist ID from URL");
  }

  // Try Piped first for playlist metadata
  try {
    const data = await getPlaylistDataFromPiped(playlistId);

    if (data.videos.length === 0) {
      return createErrorResponse("No videos found in playlist");
    }

    const firstVideo = data.videos[0];
    if (!firstVideo) {
      return createErrorResponse("No videos found in playlist");
    }

    const firstStreamUrl = await resolveStreamUrl(firstVideo.videoId);
    if (!firstStreamUrl) {
      return createErrorResponse("Failed to resolve first video stream");
    }

    const tracks: YouTubeTrackInfo[] = data.videos.map((video, index) => ({
      name: video.title,
      streamUrl: index === 0 ? firstStreamUrl : "",
      duration: video.duration,
      videoId: video.videoId,
      thumbnail: video.thumbnail,
    }));

    const metadata: YouTubeMetadata = {
      platform: "youtube",
      itemType: "playlist",
      url,
      name: data.title,
      artist: data.author,
      artwork: data.thumbnail || tracks[0]?.thumbnail,
      playlistId,
      trackCount: data.videoCount,
      tracks,
      streamUrl: firstStreamUrl,
    };

    return { success: true, metadata, streamUrl: firstStreamUrl };
  } catch {
    // Fall through to Invidious
  }

  // Fallback to Invidious for playlist
  const data = await getPlaylistData(playlistId);

  if (!data.videos || data.videos.length === 0) {
    return createErrorResponse("No videos found in playlist");
  }

  const firstVideo = data.videos[0];
  if (!firstVideo) {
    return createErrorResponse("No videos found in playlist");
  }

  const firstStreamUrl = await resolveStreamUrl(firstVideo.videoId);
  if (!firstStreamUrl) {
    return createErrorResponse("Failed to resolve first video stream");
  }

  const tracks: YouTubeTrackInfo[] = data.videos.map((video, index) => ({
    name: video.title,
    streamUrl: index === 0 ? firstStreamUrl : "",
    duration: video.lengthSeconds,
    videoId: video.videoId,
    thumbnail: getBestThumbnail(video.videoThumbnails),
  }));

  const artwork = data.playlistThumbnail || tracks[0]?.thumbnail;

  const metadata: YouTubeMetadata = {
    platform: "youtube",
    itemType: "playlist",
    url,
    name: data.title,
    artist: data.author,
    artwork,
    playlistId: data.playlistId,
    trackCount: data.videoCount,
    tracks,
    streamUrl: firstStreamUrl,
  };

  return {
    success: true,
    metadata,
    streamUrl: firstStreamUrl,
  };
}
