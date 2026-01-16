import { detectSoundCloudItemType } from "./detect.js";
import { fetchClientID } from "./fetch-client/index.js";
import type {
  SoundCloudItemError,
  SoundCloudItemResponse,
  SoundCloudItemResult,
  SoundCloudMetadata,
} from "./types.js";

export { detectSoundCloudItemType, isSoundCloudUrl } from "./detect.js";
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

function isSoundCloudStreamUrl(url: string): boolean {
  return (
    !url.startsWith("/api/") &&
    SOUNDCLOUD_DOMAINS.some((domain) => url.includes(domain))
  );
}

/** Proxies SoundCloud stream URLs to avoid CORS issues */
export function getProxiedSoundCloudUrl(url: string): string {
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
  clientIdCache ??= fetchClientID();
  return clientIdCache;
}

async function resolveSoundCloudUrl(url: string, clientId: string) {
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
  return await response.json();
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
      return null;
    }

    const data = (await response.json()) as { url: string };
    return `/api/soundcloud-proxy?url=${encodeURIComponent(data.url)}`;
  } catch {
    return null;
  }
}

export async function getSoundCloudItem(
  url: string
): Promise<SoundCloudItemResponse> {
  try {
    const itemType = detectSoundCloudItemType(url);
    const clientId = await getClientId();
    // biome-ignore lint/suspicious/noExplicitAny: External API response
    const data = (await resolveSoundCloudUrl(url, clientId)) as any;

    if (itemType === "track" && data.kind === "track") {
      return await processTrack(data, url, clientId);
    }

    if (itemType === "playlist" && data.kind === "playlist") {
      return await processPlaylist(data, url, clientId);
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

async function processTrack(
  // biome-ignore lint/suspicious/noExplicitAny: External API response
  data: any,
  url: string,
  clientId: string
): Promise<SoundCloudItemResult | SoundCloudItemError> {
  const transcoding = data.media?.transcodings?.find(
    // biome-ignore lint/suspicious/noExplicitAny: External API response
    (t: any) => t.format?.protocol === "progressive"
  );

  if (!transcoding) {
    return createErrorResponse("No progressive stream found");
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
    duration: Math.floor(data.duration / 1000),
    streamUrl,
  };

  return {
    success: true,
    metadata,
    streamUrl,
  };
}

async function processPlaylist(
  // biome-ignore lint/suspicious/noExplicitAny: External API response
  data: any,
  url: string,
  clientId: string
): Promise<SoundCloudItemResult | SoundCloudItemError> {
  if (!data.tracks || data.tracks.length === 0) {
    return createErrorResponse("No tracks found in playlist");
  }

  const processedTracks = await Promise.all(
    // biome-ignore lint/suspicious/noExplicitAny: External API response
    data.tracks.map(async (track: any) => {
      let fullTrack = track;

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

      const transcoding = fullTrack.media.transcodings.find(
        // biome-ignore lint/suspicious/noExplicitAny: External API response
        (t: any) => t.format?.protocol === "progressive"
      );

      if (!transcoding) {
        return null;
      }

      const streamUrl = await getStreamUrl(transcoding.url, clientId);
      if (!streamUrl) {
        return null;
      }

      return {
        name: fullTrack.title,
        streamUrl,
        duration: Math.floor(fullTrack.duration / 1000),
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
  const firstTrack = validTracks[0]!;
  const metadata: SoundCloudMetadata = {
    platform: "soundcloud",
    itemType: "playlist",
    url,
    name: data.title,
    artist: data.user?.username,
    artwork:
      data.artwork_url?.replace("-large", "-t500x500") || data.artwork_url,
    duration: Math.floor(data.duration / 1000),
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
