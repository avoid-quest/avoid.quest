import type { AudioFormat } from "./types.js";

const PIPED_INSTANCES_URL = "https://piped-instances.kavin.rocks/";

// NOTE: Piped API instances (not frontends) — many are frequently down.
// The instance directory at piped-instances.kavin.rocks is merged in at runtime.
const FALLBACK_PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://piped-api.privacy.com.de",
  "https://pipedapi.nosebs.ru",
  "https://pipedapi.orangenet.cc",
];

let cachedInstances: string[] | null = null;
let instanceIndex = 0;

type PipedAudioStream = {
  url: string;
  format: string;
  quality: string;
  mimeType: string;
  codec: string;
  bitrate: number;
  contentLength: number;
};

type PipedVideoResponse = {
  title: string;
  uploader: string;
  uploaderUrl: string;
  duration: number;
  thumbnailUrl: string;
  audioStreams: PipedAudioStream[];
  error?: string;
};

type PipedPlaylistResponse = {
  name: string;
  uploader: string;
  thumbnailUrl: string;
  videos: number;
  relatedStreams: {
    url: string;
    title: string;
    thumbnail: string;
    uploaderName: string;
    duration: number;
  }[];
  error?: string;
};

export type PipedVideoData = {
  title: string;
  author: string;
  videoId: string;
  duration: number;
  thumbnail: string;
  audioFormats: AudioFormat[];
};

export type PipedPlaylistData = {
  title: string;
  author: string;
  thumbnail: string;
  videoCount: number;
  videos: {
    videoId: string;
    title: string;
    author: string;
    duration: number;
    thumbnail: string;
  }[];
};

async function fetchPipedInstances(): Promise<string[]> {
  if (cachedInstances) {
    return cachedInstances;
  }

  // Always start with fallback instances for reliability
  const allInstances = new Set(FALLBACK_PIPED_INSTANCES);

  try {
    const response = await fetch(PIPED_INSTANCES_URL, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      // biome-ignore lint/suspicious/noExplicitAny: Piped instances API response
      const data = (await response.json()) as any[];
      for (const instance of data) {
        if (instance.api_url?.startsWith("https://")) {
          allInstances.add(instance.api_url as string);
        }
      }
    }
  } catch {
    // Use fallbacks only
  }

  cachedInstances = [...allInstances];
  return cachedInstances;
}

function mapPipedAudioToFormat(stream: PipedAudioStream): AudioFormat {
  // Extract itag from URL query params if possible
  let itag = "0";
  try {
    const url = new URL(stream.url);
    itag = url.searchParams.get("itag") ?? "0";
  } catch {
    // ignore
  }

  return {
    type: stream.mimeType,
    url: stream.url,
    itag,
    bitrate: String(stream.bitrate),
  };
}

const VIDEO_ID_PATTERN = /[?&]v=([a-zA-Z0-9_-]{11})/;

function extractVideoIdFromUrl(url: string): string | null {
  const match = url.match(VIDEO_ID_PATTERN);
  return match?.[1] ?? null;
}

export async function getVideoDataFromPiped(
  videoId: string
): Promise<PipedVideoData> {
  const instances = await fetchPipedInstances();
  let lastError: Error | null = null;

  for (let i = 0; i < instances.length; i++) {
    const idx = (instanceIndex + i) % instances.length;
    const instance = instances[idx];
    if (!instance) {
      continue;
    }

    try {
      const response = await fetch(`${instance}/streams/${videoId}`, {
        signal: AbortSignal.timeout(10_000),
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("json")) {
        throw new Error("Non-JSON response");
      }

      const data = (await response.json()) as PipedVideoResponse;

      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.audioStreams?.length) {
        throw new Error("No audio streams");
      }

      instanceIndex = idx;
      return {
        title: data.title,
        author: data.uploader,
        videoId,
        duration: data.duration,
        thumbnail: data.thumbnailUrl,
        audioFormats: data.audioStreams.map(mapPipedAudioToFormat),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");
    }
  }

  throw lastError ?? new Error("All Piped instances failed");
}

export async function getPlaylistDataFromPiped(
  playlistId: string
): Promise<PipedPlaylistData> {
  const instances = await fetchPipedInstances();
  let lastError: Error | null = null;

  for (let i = 0; i < instances.length; i++) {
    const idx = (instanceIndex + i) % instances.length;
    const instance = instances[idx];
    if (!instance) {
      continue;
    }

    try {
      const response = await fetch(`${instance}/playlists/${playlistId}`, {
        signal: AbortSignal.timeout(10_000),
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("json")) {
        throw new Error("Non-JSON response");
      }

      const data = (await response.json()) as PipedPlaylistResponse;

      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.relatedStreams?.length) {
        throw new Error("No videos in playlist");
      }

      instanceIndex = idx;
      return {
        title: data.name,
        author: data.uploader,
        thumbnail: data.thumbnailUrl,
        videoCount: data.videos,
        videos: data.relatedStreams
          .map((s) => {
            const vid = extractVideoIdFromUrl(s.url);
            if (!vid) {
              return null;
            }
            return {
              videoId: vid,
              title: s.title,
              author: s.uploaderName,
              duration: s.duration,
              thumbnail: s.thumbnail,
            };
          })
          .filter(
            (
              v
            ): v is {
              videoId: string;
              title: string;
              author: string;
              duration: number;
              thumbnail: string;
            } => v !== null
          ),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");
    }
  }

  throw lastError ?? new Error("All Piped instances failed");
}
