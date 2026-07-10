import {
  detectYouTubeItemType,
  extractPlaylistId,
  extractVideoId,
} from "./detect.js";
import {
  getBestThumbnail,
  type InvidiousAdaptiveFormat,
  selectBestAudioStream,
} from "./invidious.js";
import {
  createYouTubeProviderOperationContext,
  createYouTubeProviderRequestContext,
  fetchProviderJson,
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

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function thumbnails(
  context: YouTubeProviderRequestContext,
  value: unknown,
  signal?: AbortSignal
) {
  if (!Array.isArray(value)) {
    throw invalidProviderSchema(context);
  }
  return await Promise.all(
    value.map(async (thumbnail) => {
      if (
        !isObject(thumbnail) ||
        typeof thumbnail.quality !== "string" ||
        typeof thumbnail.url !== "string" ||
        !isNumber(thumbnail.width) ||
        !isNumber(thumbnail.height)
      ) {
        throw invalidProviderSchema(context);
      }
      return {
        height: thumbnail.height,
        quality: thumbnail.quality,
        url: await resolveProviderUrl(context, thumbnail.url, signal),
        width: thumbnail.width,
      };
    })
  );
}

function adaptiveFormats(
  context: YouTubeProviderRequestContext,
  value: unknown
): InvidiousAdaptiveFormat[] {
  if (!Array.isArray(value)) {
    throw invalidProviderSchema(context);
  }
  return value.map((format) => {
    if (
      !isObject(format) ||
      typeof format.url !== "string" ||
      typeof format.type !== "string" ||
      !(typeof format.bitrate === "string" || isNumber(format.bitrate))
    ) {
      throw invalidProviderSchema(context);
    }
    return {
      bitrate: String(format.bitrate),
      clen:
        typeof format.clen === "string" || isNumber(format.clen)
          ? String(format.clen)
          : "",
      container: typeof format.container === "string" ? format.container : "",
      encoding: typeof format.encoding === "string" ? format.encoding : "",
      type: format.type,
      url: format.url,
    };
  });
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

async function fetchVideo(
  context: YouTubeProviderRequestContext,
  videoId: string,
  signal?: AbortSignal
) {
  const url = providerUrl(
    context,
    `api/v1/videos/${encodeURIComponent(videoId)}?local=true`
  );
  const value = await fetchProviderJson(context, url, signal);
  if (
    !isObject(value) ||
    typeof value.title !== "string" ||
    typeof value.videoId !== "string" ||
    typeof value.author !== "string" ||
    !isNumber(value.lengthSeconds) ||
    typeof value.liveNow !== "boolean"
  ) {
    throw invalidProviderSchema(context);
  }
  return {
    adaptiveFormats: adaptiveFormats(context, value.adaptiveFormats),
    author: value.author,
    lengthSeconds: value.lengthSeconds,
    liveNow: value.liveNow,
    title: value.title,
    videoId: value.videoId,
    videoThumbnails: await thumbnails(context, value.videoThumbnails, signal),
  };
}

async function resolveVideoStream(
  context: YouTubeProviderRequestContext,
  videoId: string,
  signal?: AbortSignal
) {
  const video = await fetchVideo(context, videoId, signal);
  if (video.liveNow) {
    throw providerOperationError(
      context,
      "unsupported-live-stream",
      "YouTube live streams are not supported"
    );
  }
  const stream = selectBestAudioStream(video.adaptiveFormats);
  if (!stream) {
    throw providerOperationError(
      context,
      "no-audio",
      "No YouTube audio stream found"
    );
  }
  const streamUrl = await resolveProviderUrl(context, stream.url, signal);
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
      artist: video.author,
      artwork: getBestThumbnail(video.videoThumbnails, context.baseUrl),
      duration: video.lengthSeconds,
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

async function resolvePlaylistItem(
  context: YouTubeProviderRequestContext,
  url: string,
  signal?: AbortSignal
): Promise<YouTubeItemResult> {
  const playlistId = requirePlaylistId(context, extractPlaylistId(url));
  const value = await fetchProviderJson(
    context,
    providerUrl(context, `api/v1/playlists/${encodeURIComponent(playlistId)}`),
    signal
  );
  if (
    !isObject(value) ||
    typeof value.title !== "string" ||
    typeof value.author !== "string" ||
    typeof value.playlistThumbnail !== "string" ||
    !isNumber(value.videoCount) ||
    !Array.isArray(value.videos)
  ) {
    throw invalidProviderSchema(context);
  }

  const tracks: YouTubeTrackInfo[] = await Promise.all(
    value.videos.map(async (video) => {
      if (
        !isObject(video) ||
        typeof video.title !== "string" ||
        typeof video.videoId !== "string" ||
        !isNumber(video.lengthSeconds)
      ) {
        throw invalidProviderSchema(context);
      }
      const videoId = requireVideoId(context, video.videoId);
      return {
        duration: video.lengthSeconds,
        name: video.title,
        streamUrl: `yt:${videoId}`,
        thumbnail: getBestThumbnail(
          await thumbnails(context, video.videoThumbnails, signal),
          context.baseUrl
        ),
        videoId,
      };
    })
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
      artist: value.author,
      artwork:
        (await resolveProviderUrl(context, value.playlistThumbnail, signal)) ||
        tracks[0].thumbnail ||
        "",
      itemType: "playlist",
      name: value.title,
      platform: "youtube",
      playlistId,
      trackCount: value.videoCount,
      tracks,
      url,
    },
    streamUrl: tracks[0].streamUrl,
    success: true,
  };
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

export function createBrowserInvidiousAdapter(
  options: YouTubeProviderAdapterOptions
): YouTubeProviderAdapter {
  const context = createYouTubeProviderRequestContext("invidious", options);
  return {
    id: context.providerId,
    kind: context.kind,
    probe: async (signal) => {
      const value = await fetchProviderJson(
        context,
        providerUrl(context, "api/v1/stats"),
        signal
      );
      if (
        !(isObject(value) && isObject(value.software)) ||
        value.software.name !== "invidious"
      ) {
        throw invalidProviderSchema(
          context,
          "Endpoint is not an Invidious API"
        );
      }
      return {
        kind: context.kind,
        providerId: context.providerId,
        status: "ready",
      };
    },
    resolveItem: async (url, signal) => {
      const operationContext = createYouTubeProviderOperationContext(context);
      return detectYouTubeItemType(url) === "playlist"
        ? await resolvePlaylistItem(operationContext, url, signal)
        : await resolveVideoItem(operationContext, url, signal);
    },
    resolveStream: async (videoId, signal) => {
      const operationContext = createYouTubeProviderOperationContext(context);
      return (
        await resolveVideoStream(
          operationContext,
          requireVideoId(operationContext, videoId),
          signal
        )
      ).streamUrl;
    },
    search: async (query, _filter, signal) => {
      const operationContext = createYouTubeProviderOperationContext(context);
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        throw invalidProviderInput(context, "YouTube search query is required");
      }
      const url = providerUrl(context, "api/v1/search");
      url.searchParams.set("q", trimmedQuery);
      url.searchParams.set("type", "video");
      const value = await fetchProviderJson(context, url, signal);
      if (!Array.isArray(value)) {
        throw invalidProviderSchema(context);
      }
      const results = await Promise.all(
        value.map(async (item): Promise<YouTubeSearchResult | null> => {
          if (!isObject(item) || item.type !== "video") {
            return null;
          }
          if (
            typeof item.videoId !== "string" ||
            typeof item.title !== "string" ||
            typeof item.author !== "string" ||
            !isNumber(item.lengthSeconds) ||
            !isNumber(item.viewCount)
          ) {
            throw invalidProviderSchema(context);
          }
          const image = getBestThumbnail(
            await thumbnails(operationContext, item.videoThumbnails, signal),
            context.baseUrl
          );
          return {
            author: item.author,
            duration: item.lengthSeconds,
            thumbnail: image,
            title: item.title,
            videoId: requireVideoId(context, item.videoId),
            views: formatViews(item.viewCount),
          };
        })
      );
      return results.filter(
        (result): result is YouTubeSearchResult => result !== null
      );
    },
  };
}
