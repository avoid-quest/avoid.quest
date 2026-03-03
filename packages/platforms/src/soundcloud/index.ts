import { detectSoundCloudItemType } from "./detect.js";
import { fetchClientID } from "./fetch-client/index.js";
import type {
  SoundCloudItemError,
  SoundCloudItemResponse,
  SoundCloudItemResult,
  SoundCloudMetadata,
} from "./types.js";

// Structural types for SoundCloud API responses (only properties we access)

type SoundCloudTranscodingFormat = {
  protocol?: string;
  mime_type?: string;
};

type SoundCloudTranscoding = {
  url: string;
  format?: SoundCloudTranscodingFormat;
};

type SoundCloudApiTrack = {
  kind?: string;
  id?: number;
  user_id?: number;
  title?: string;
  duration?: number;
  user?: { username?: string };
  artwork_url?: string;
  media?: { transcodings?: SoundCloudTranscoding[] };
};

type SoundCloudApiPlaylist = {
  kind?: string;
  title?: string;
  duration?: number;
  track_count?: number;
  user?: { username?: string };
  artwork_url?: string;
  tracks?: SoundCloudApiTrack[];
};

type SoundCloudApiUser = {
  kind?: string;
  id?: number;
  username?: string;
  full_name?: string;
  avatar_url?: string;
  track_count?: number;
};

type SoundCloudResolveResponse = SoundCloudApiTrack &
  SoundCloudApiPlaylist &
  SoundCloudApiUser & {
    collection?: SoundCloudApiTrack[];
  };

export {
  detectSoundCloudItemType,
  isSoundCloudUrl,
  needsResolution,
  normalizeSoundCloudUrl,
} from "./detect.js";
export { fetchClientID } from "./fetch-client/index.js";
export type { SoundCloudSearchResult } from "./search.js";
export { searchSoundCloud } from "./search.js";
export type {
  SoundCloudItemError,
  SoundCloudItemResponse,
  SoundCloudItemResult,
  SoundCloudItemType,
  SoundCloudMetadata,
  SoundCloudTrackInfo,
} from "./types.js";

const SOUNDCLOUD_DOMAINS = [
  "sndcdn.com",
  "media.soundcloud.com",
  "soundcloud.com",
];

// HLS CDN allows CORS, so no proxy needed
const CORS_ALLOWED_DOMAINS = ["cf-hls-media.sndcdn.com"];

function isSoundCloudStreamUrl(url: string): boolean {
  return (
    !url.startsWith("/api/") &&
    SOUNDCLOUD_DOMAINS.some((domain) => url.includes(domain))
  );
}

function isCorsAllowed(url: string): boolean {
  return CORS_ALLOWED_DOMAINS.some((domain) => url.includes(domain));
}

/** Proxies SoundCloud stream URLs to avoid CORS issues (skips HLS which has CORS enabled) */
export function getProxiedSoundCloudUrl(url: string): string {
  // HLS CDN has CORS enabled, no proxy needed
  if (isCorsAllowed(url)) {
    return url;
  }
  if (isSoundCloudStreamUrl(url)) {
    return `/api/soundcloud-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function createErrorResponse(message: string): SoundCloudItemError {
  return {
    success: false,
    error: message,
  };
}

let clientIdCache: Promise<string> | null = null;

function getClientId(): Promise<string> {
  clientIdCache ??= fetchClientID().catch((error) => {
    clientIdCache = null;
    throw error;
  });
  return clientIdCache;
}

async function resolveSoundCloudUrl(
  url: string,
  clientId: string
): Promise<SoundCloudResolveResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  const resolveUrl = new URL("https://api-v2.soundcloud.com/resolve");
  resolveUrl.searchParams.set("url", url);
  resolveUrl.searchParams.set("client_id", clientId);

  const response = await fetch(resolveUrl.toString(), {
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`Failed to resolve URL: ${response.statusText}`);
  }
  return (await response.json()) as SoundCloudResolveResponse;
}

async function getStreamUrl(
  transcodingUrl: string,
  clientId: string
): Promise<string | null> {
  try {
    const url = new URL(transcodingUrl);
    url.searchParams.set("client_id", clientId);

    const response = await fetch(url.toString());
    if (!response.ok) {
      console.warn(
        `[SoundCloud] getStreamUrl HTTP ${response.status} for ${transcodingUrl}`
      );
      return null;
    }

    const data: { url: string } = await response.json();
    // Return raw stream URL - consumers apply proxying as needed
    return data.url;
  } catch (error) {
    console.warn("[SoundCloud] getStreamUrl failed:", error);
    return null;
  }
}

/**
 * Fetch user tracks via search API, filtering by user_id
 */
async function fetchUserTracks(
  userId: number,
  username: string,
  clientId: string
): Promise<{ collection: SoundCloudApiTrack[] }> {
  const searchUrl = new URL("https://api-v2.soundcloud.com/search/tracks");
  searchUrl.searchParams.set("q", username);
  searchUrl.searchParams.set("client_id", clientId);
  searchUrl.searchParams.set("limit", "50");

  const response = await fetch(searchUrl.toString(), {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    console.warn(
      `[SoundCloud] fetchUserTracks HTTP ${response.status} for ${username}`
    );
    return { collection: [] };
  }

  const data: { collection: SoundCloudApiTrack[] } = await response.json();

  // Filter to only include tracks by this user
  const userTracks = data.collection.filter(
    (item) =>
      item.kind === "track" &&
      item.user_id === userId &&
      (item.media?.transcodings?.length ?? 0) > 0
  );

  return { collection: userTracks };
}

/**
 * Resolve a SoundCloud short link (on.soundcloud.com) to full URL
 */
export async function resolveShortLink(shortUrl: string): Promise<string> {
  const response = await fetch(shortUrl, {
    method: "HEAD",
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to resolve short link: ${response.status} ${response.statusText}`
    );
  }
  return response.url;
}

export async function getSoundCloudItem(
  url: string
): Promise<SoundCloudItemResponse> {
  try {
    const itemType = detectSoundCloudItemType(url);
    const clientId = await getClientId();
    const data = await resolveSoundCloudUrl(url, clientId);

    if (itemType === "track" && data.kind === "track") {
      return await processTrack(data, url, clientId);
    }

    if (itemType === "playlist" && data.kind === "playlist") {
      return await processPlaylist(data, url, clientId);
    }

    if (itemType === "user" && data.kind === "user") {
      return await processUser(data, url, clientId);
    }

    return createErrorResponse("Unsupported SoundCloud item type or mismatch");
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return createErrorResponse(
      `Failed to get SoundCloud item: ${errorMessage}`
    );
  }
}

/**
 * Find the best available transcoding for a track.
 * Prefers progressive (direct download), falls back to HLS.
 */
function findBestTranscoding(
  transcodings: SoundCloudTranscoding[]
): SoundCloudTranscoding | null {
  // First try progressive (easiest to work with)
  const progressive = transcodings.find(
    (t) => t.format?.protocol === "progressive"
  );
  if (progressive) {
    return progressive;
  }

  // Fall back to HLS audio/mpeg (MP3 segments, widely compatible)
  const hlsMpeg = transcodings.find(
    (t) => t.format?.protocol === "hls" && t.format?.mime_type === "audio/mpeg"
  );
  if (hlsMpeg) {
    return hlsMpeg;
  }

  // Fall back to any HLS stream
  const hlsAny = transcodings.find((t) => t.format?.protocol === "hls");
  return hlsAny ?? null;
}

async function processTrack(
  data: SoundCloudApiTrack,
  url: string,
  clientId: string
): Promise<SoundCloudItemResult | SoundCloudItemError> {
  const transcoding = findBestTranscoding(data.media?.transcodings || []);

  if (!transcoding) {
    return createErrorResponse("No supported stream format found");
  }

  const streamUrl = await getStreamUrl(transcoding.url, clientId);

  if (!streamUrl) {
    return createErrorResponse("Failed to resolve stream URL");
  }

  const metadata: SoundCloudMetadata = {
    platform: "soundcloud",
    itemType: "track",
    url,
    name: data.title,
    artist: data.user?.username,
    artwork:
      data.artwork_url?.replace("-large", "-t500x500") || data.artwork_url,
    duration: Math.floor((data.duration ?? 0) / 1000),
    streamUrl,
  };

  return {
    success: true,
    metadata,
    streamUrl,
  };
}

async function processPlaylist(
  data: SoundCloudApiPlaylist,
  url: string,
  clientId: string
): Promise<SoundCloudItemResult | SoundCloudItemError> {
  if (!data.tracks || data.tracks.length === 0) {
    return createErrorResponse("No tracks found in playlist");
  }

  const processedTracks = await Promise.all(
    data.tracks.map(async (track) => {
      let fullTrack: SoundCloudApiTrack = track;

      // Fetch full track details if partial (missing transcodings)
      if (!track.media?.transcodings && track.id) {
        try {
          const trackApiUrl = `https://api.soundcloud.com/tracks/${track.id}`;
          fullTrack = await resolveSoundCloudUrl(trackApiUrl, clientId);
        } catch {
          return null;
        }
      }

      if (!fullTrack.media?.transcodings) {
        return null;
      }

      const transcoding = findBestTranscoding(fullTrack.media.transcodings);

      if (!transcoding) {
        return null;
      }

      const streamUrl = await getStreamUrl(transcoding.url, clientId);
      if (!streamUrl) {
        return null;
      }

      return {
        name: fullTrack.title ?? "",
        streamUrl,
        duration: Math.floor((fullTrack.duration ?? 0) / 1000),
      };
    })
  );

  const validTracks = processedTracks.filter(
    (t): t is { name: string; streamUrl: string; duration: number } =>
      t !== null
  );

  if (validTracks.length === 0) {
    return createErrorResponse("No playable tracks found in playlist");
  }

  // Safe: we checked validTracks.length > 0 above
  const firstTrack = validTracks[0];
  if (!firstTrack) {
    return createErrorResponse("No playable tracks found in playlist");
  }
  const metadata: SoundCloudMetadata = {
    platform: "soundcloud",
    itemType: "playlist",
    url,
    name: data.title,
    artist: data.user?.username,
    artwork:
      data.artwork_url?.replace("-large", "-t500x500") || data.artwork_url,
    duration: Math.floor((data.duration ?? 0) / 1000),
    trackCount: data.track_count,
    tracks: validTracks,
    streamUrl: firstTrack.streamUrl,
  };

  return {
    success: true,
    metadata,
    streamUrl: firstTrack.streamUrl,
  };
}

async function processUser(
  data: SoundCloudApiUser,
  url: string,
  clientId: string
): Promise<SoundCloudItemResult | SoundCloudItemError> {
  // Try to resolve the user's tracks URL through the API
  const tracksUrl = `${url}/tracks`;

  let tracksData: { collection: SoundCloudApiTrack[] };

  try {
    // Try resolving the tracks page URL - this sometimes returns a playlist-like response
    const resolved = await resolveSoundCloudUrl(tracksUrl, clientId);

    if (resolved.collection) {
      tracksData = { collection: resolved.collection };
    } else if (resolved.tracks) {
      tracksData = { collection: resolved.tracks };
    } else if (data.id && data.username) {
      // Fallback: search for user's tracks
      tracksData = await fetchUserTracks(data.id, data.username, clientId);
    } else {
      tracksData = { collection: [] };
    }
  } catch {
    if (data.id && data.username) {
      tracksData = await fetchUserTracks(data.id, data.username, clientId);
    } else {
      tracksData = { collection: [] };
    }
  }

  if (!tracksData.collection || tracksData.collection.length === 0) {
    return createErrorResponse("No tracks found for this user");
  }

  const processedTracks = await Promise.all(
    tracksData.collection.map(async (track) => {
      if (!track.media?.transcodings) {
        return null;
      }

      const transcoding = findBestTranscoding(track.media.transcodings);

      if (!transcoding) {
        return null;
      }

      const streamUrl = await getStreamUrl(transcoding.url, clientId);
      if (!streamUrl) {
        return null;
      }

      return {
        name: track.title ?? "",
        streamUrl,
        duration: Math.floor((track.duration ?? 0) / 1000),
      };
    })
  );

  const validTracks = processedTracks.filter(
    (t): t is { name: string; streamUrl: string; duration: number } =>
      t !== null
  );

  if (validTracks.length === 0) {
    return createErrorResponse("No playable tracks found for this user");
  }

  const firstTrack = validTracks[0];
  if (!firstTrack) {
    return createErrorResponse("No playable tracks found for this user");
  }

  // Get high-res avatar
  const artwork = data.avatar_url?.replace("-large", "-t500x500");

  const metadata: SoundCloudMetadata = {
    platform: "soundcloud",
    itemType: "user",
    url,
    name: data.full_name || data.username,
    artist: data.username,
    artwork,
    trackCount: data.track_count,
    tracks: validTracks,
    streamUrl: firstTrack.streamUrl,
  };

  return {
    success: true,
    metadata,
    streamUrl: firstTrack.streamUrl,
  };
}
