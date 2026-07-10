import {
  detectYouTubeItemType,
  extractPlaylistId,
  extractVideoId,
} from "./detect.js";
import {
  createYouTubeProviderRequestContext,
  fetchProviderJson,
  fetchProviderText,
  invalidProviderInput,
  invalidProviderSchema,
  providerOperationError,
  providerUrl,
  resolveProviderUrl,
  verifyProviderMedia,
  type YouTubeProviderAdapter,
  type YouTubeProviderAdapterOptions,
  type YouTubeProviderRequestContext,
} from "./provider.js";
import type {
  YouTubeItemResult,
  YouTubeSearchResult,
  YouTubeTrackInfo,
} from "./types.js";

type JsonObject = Record<string, unknown>;

const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{10,80}$/;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

type PipedAudioStream = {
  bitrate: number;
  codec: string;
  mimeType: string;
  url: string;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requireVideoId(
  context: YouTubeProviderRequestContext,
  value: string | null
): string {
  if (!(value && VIDEO_ID_PATTERN.test(value))) {
    throw invalidProviderInput(context, "YouTube video ID is invalid");
  }
  return value;
}

function requirePlaylistId(
  context: YouTubeProviderRequestContext,
  value: string | null
): string {
  if (!(value && PLAYLIST_ID_PATTERN.test(value))) {
    throw invalidProviderInput(context, "YouTube playlist ID is invalid");
  }
  return value;
}

function videoIdFromPipedUrl(
  context: YouTubeProviderRequestContext,
  value: unknown
): string {
  if (typeof value !== "string") {
    throw invalidProviderSchema(context);
  }
  let videoId: string | null;
  try {
    videoId = new URL(value, "https://youtube.com").searchParams.get("v");
  } catch {
    throw invalidProviderSchema(context);
  }
  if (!(videoId && VIDEO_ID_PATTERN.test(videoId))) {
    throw invalidProviderSchema(context);
  }
  return videoId;
}

function formatViews(views: number): string {
  if (views >= 1_000_000_000) {
    return `${(views / 1_000_000_000).toFixed(1)}B views`;
  }
  if (views >= 1_000_000) {
    return `${(views / 1_000_000).toFixed(1)}M views`;
  }
  if (views >= 1000) {
    return `${(views / 1000).toFixed(1)}K views`;
  }
  return `${views} views`;
}

function parseAudioStreams(
  context: YouTubeProviderRequestContext,
  value: unknown
): PipedAudioStream[] {
  if (!Array.isArray(value)) {
    throw invalidProviderSchema(context);
  }
  return value.map((stream) => {
    if (
      !isObject(stream) ||
      typeof stream.url !== "string" ||
      typeof stream.mimeType !== "string" ||
      typeof stream.codec !== "string" ||
      !isNumber(stream.bitrate)
    ) {
      throw invalidProviderSchema(context);
    }
    return {
      bitrate: stream.bitrate,
      codec: stream.codec,
      mimeType: stream.mimeType,
      url: stream.url,
    };
  });
}

function selectPipedAudioStream(
  streams: readonly PipedAudioStream[]
): PipedAudioStream | null {
  const audio = streams.filter((stream) =>
    stream.mimeType.startsWith("audio/")
  );
  const opus = audio.filter((stream) =>
    stream.codec.toLowerCase().includes("opus")
  );
  const aac = audio.filter(
    (stream) =>
      stream.codec.toLowerCase().includes("mp4a") ||
      stream.codec.toLowerCase().includes("aac")
  );
  let candidates = audio;
  if (aac.length > 0) {
    candidates = aac;
  }
  if (opus.length > 0) {
    candidates = opus;
  }
  return (
    candidates.reduce<PipedAudioStream | null>(
      (best, stream) =>
        !best || stream.bitrate > best.bitrate ? stream : best,
      null
    ) ?? null
  );
}

async function fetchVideo(
  context: YouTubeProviderRequestContext,
  videoId: string,
  signal?: AbortSignal
) {
  const value = await fetchProviderJson(
    context,
    providerUrl(context, `streams/${encodeURIComponent(videoId)}`),
    signal
  );
  if (
    !isObject(value) ||
    typeof value.title !== "string" ||
    typeof value.uploader !== "string" ||
    !isNumber(value.duration) ||
    typeof value.livestream !== "boolean" ||
    typeof value.thumbnailUrl !== "string"
  ) {
    throw invalidProviderSchema(context);
  }
  return {
    audioStreams: parseAudioStreams(context, value.audioStreams),
    duration: value.duration,
    livestream: value.livestream,
    thumbnailUrl: resolveProviderUrl(context, value.thumbnailUrl),
    title: value.title,
    uploader: value.uploader,
  };
}

async function resolveVideoStream(
  context: YouTubeProviderRequestContext,
  videoId: string,
  signal?: AbortSignal
) {
  const video = await fetchVideo(context, videoId, signal);
  if (video.livestream) {
    throw providerOperationError(
      context,
      "unsupported-live-stream",
      "YouTube live streams are not supported"
    );
  }
  const stream = selectPipedAudioStream(video.audioStreams);
  if (!stream) {
    throw providerOperationError(
      context,
      "no-audio",
      "No YouTube audio stream found"
    );
  }
  const streamUrl = resolveProviderUrl(context, stream.url);
  await verifyProviderMedia(context, streamUrl, signal);
  return { streamUrl, video };
}

async function resolveVideoItem(
  context: YouTubeProviderRequestContext,
  url: string,
  signal?: AbortSignal
): Promise<YouTubeItemResult> {
  const videoId = requireVideoId(context, extractVideoId(url));
  const { streamUrl, video } = await resolveVideoStream(
    context,
    videoId,
    signal
  );
  return {
    metadata: {
      artist: video.uploader,
      artwork: video.thumbnailUrl,
      duration: video.duration,
      itemType: "video",
      name: video.title,
      platform: "youtube",
      streamUrl,
      url,
      videoId,
    },
    streamUrl,
    success: true,
  };
}

function parsePlaylistTrack(
  context: YouTubeProviderRequestContext,
  value: unknown
): YouTubeTrackInfo {
  if (
    !isObject(value) ||
    typeof value.title !== "string" ||
    !isNumber(value.duration) ||
    typeof value.thumbnail !== "string"
  ) {
    throw invalidProviderSchema(context);
  }
  const videoId = videoIdFromPipedUrl(context, value.url);
  return {
    duration: value.duration,
    name: value.title,
    streamUrl: `yt:${videoId}`,
    thumbnail: resolveProviderUrl(context, value.thumbnail),
    videoId,
  };
}

async function resolvePlaylistItem(
  context: YouTubeProviderRequestContext,
  url: string,
  signal?: AbortSignal
): Promise<YouTubeItemResult> {
  const playlistId = requirePlaylistId(context, extractPlaylistId(url));
  const value = await fetchProviderJson(
    context,
    providerUrl(context, `playlists/${encodeURIComponent(playlistId)}`),
    signal
  );
  if (
    !isObject(value) ||
    typeof value.name !== "string" ||
    typeof value.uploader !== "string" ||
    typeof value.thumbnailUrl !== "string" ||
    !isNumber(value.videos) ||
    !Array.isArray(value.relatedStreams)
  ) {
    throw invalidProviderSchema(context);
  }
  const tracks = value.relatedStreams.map((track) =>
    parsePlaylistTrack(context, track)
  );
  if (!tracks[0]) {
    throw providerOperationError(
      context,
      "no-audio",
      "YouTube playlist is empty"
    );
  }
  return {
    metadata: {
      artist: value.uploader,
      artwork:
        resolveProviderUrl(context, value.thumbnailUrl) ||
        tracks[0].thumbnail ||
        "",
      itemType: "playlist",
      name: value.name,
      platform: "youtube",
      playlistId,
      trackCount: value.videos,
      tracks,
      url,
    },
    streamUrl: tracks[0].streamUrl,
    success: true,
  };
}

export function createPipedAdapter(
  options: YouTubeProviderAdapterOptions
): YouTubeProviderAdapter {
  const context = createYouTubeProviderRequestContext("piped", options);
  return {
    id: context.providerId,
    kind: context.kind,
    probe: async (signal) => {
      const value = await fetchProviderText(
        context,
        providerUrl(context, "healthcheck"),
        signal
      );
      if (value.trim() !== "OK") {
        throw invalidProviderSchema(context, "Endpoint is not a Piped API");
      }
      return {
        kind: context.kind,
        providerId: context.providerId,
        status: "ready",
      };
    },
    resolveItem: async (url, signal) =>
      detectYouTubeItemType(url) === "playlist"
        ? await resolvePlaylistItem(context, url, signal)
        : await resolveVideoItem(context, url, signal),
    resolveStream: async (videoId, signal) =>
      (
        await resolveVideoStream(
          context,
          requireVideoId(context, videoId),
          signal
        )
      ).streamUrl,
    search: async (query, filter, signal) => {
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        throw invalidProviderInput(context, "YouTube search query is required");
      }
      const url = providerUrl(context, "search");
      url.searchParams.set("q", trimmedQuery);
      url.searchParams.set(
        "filter",
        (filter ?? "songs") === "songs" ? "music_songs" : "videos"
      );
      const value = await fetchProviderJson(context, url, signal);
      if (!(isObject(value) && Array.isArray(value.items))) {
        throw invalidProviderSchema(context);
      }
      return value.items.flatMap((item): YouTubeSearchResult[] => {
        if (!isObject(item) || item.type !== "stream") {
          return [];
        }
        if (
          typeof item.title !== "string" ||
          typeof item.uploaderName !== "string" ||
          typeof item.thumbnail !== "string" ||
          !isNumber(item.duration) ||
          !isNumber(item.views)
        ) {
          throw invalidProviderSchema(context);
        }
        return [
          {
            author: item.uploaderName,
            duration: item.duration,
            thumbnail: resolveProviderUrl(context, item.thumbnail),
            title: item.title,
            videoId: videoIdFromPipedUrl(context, item.url),
            views: formatViews(item.views),
          },
        ];
      });
    },
  };
}
