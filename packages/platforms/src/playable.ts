import { getBandcampItem } from "./bandcamp/index.js";
import {
  detectPlatformFromUrl,
  needsResolution,
  normalizeBandcampUrl,
  normalizeSoundCloudUrl,
} from "./detect.js";
import { extractChannelId } from "./radiogarden/detect.js";
import { getRadioGardenItem } from "./radiogarden/index.js";
import { getSoundCloudItem, resolveShortLink } from "./soundcloud/index.js";
import { getFilenameFromUrl, isStaticAudioUrl } from "./static-audio.js";
import type { Platform, PlatformMetadata, PlatformTrack } from "./types.js";
import { getYouTubeItem, type InvidiousOptions } from "./youtube/index.js";

export type PlayablePlatform = Platform | "static-audio";

export type StaticAudioItemResolver<TMetadata> = (
  url: string
) => Promise<{ metadata: TMetadata; streamUrl: string }>;

export type PlayablePlatformItem<TStaticAudioMetadata = never> = {
  platform: PlayablePlatform;
  normalizedUrl: string;
  metadata: PlatformMetadata | TStaticAudioMetadata;
  streamUrl: string;
};

export type PlayablePlatformResolutionErrorCode =
  | "provider-resolution-failed"
  | "radiogarden-channel-id-missing"
  | "static-audio-resolution-failed"
  | "unsupported-url";

export type PlayablePlatformResolutionError = {
  code: PlayablePlatformResolutionErrorCode;
  message: string;
  platform?: PlayablePlatform;
};

export type PlayablePlatformResolutionResult<TStaticAudioMetadata = never> =
  | {
      item: PlayablePlatformItem<TStaticAudioMetadata>;
      success: true;
    }
  | {
      error: PlayablePlatformResolutionError;
      success: false;
    };

export type PlayableSource = {
  title: string;
  artist: string;
  url: string;
  streamUrl: string;
  duration?: number;
  platform: PlayablePlatform;
  thumbnail?: string;
  isLiveStream: boolean;
};

type NormalizePlayablePlatformUrlOptions = {
  resolveShortLink?: (url: string) => Promise<string>;
};

type PlayablePlatformResolverOptions<TStaticAudioMetadata> = {
  invidiousOptions?: InvidiousOptions | (() => InvidiousOptions);
  resolveStaticAudioItem?: StaticAudioItemResolver<TStaticAudioMetadata>;
};

function unsupportedUrlResult(): PlayablePlatformResolutionResult {
  return {
    error: {
      code: "unsupported-url",
      message: "Unsupported URL",
    },
    success: false,
  };
}

function resolveInvidiousOptions(
  options: InvidiousOptions | (() => InvidiousOptions) | undefined
): InvidiousOptions | undefined {
  return typeof options === "function" ? options() : options;
}

function providerError(
  platform: PlayablePlatform,
  message: string
): PlayablePlatformResolutionResult {
  return {
    error: {
      code: "provider-resolution-failed",
      message,
      platform,
    },
    success: false,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "safeMessage" in error &&
    typeof error.safeMessage === "string" &&
    error.safeMessage.trim()
  ) {
    return error.safeMessage;
  }

  return fallback;
}

async function resolveBandcampPlayableItem<TStaticAudioMetadata>(
  normalizedUrl: string
): Promise<PlayablePlatformResolutionResult<TStaticAudioMetadata>> {
  const result = await getBandcampItem(normalizedUrl);
  if (!result.success) {
    return providerError(
      "bandcamp",
      result.error || "Failed to resolve Bandcamp item"
    );
  }
  return itemResult<TStaticAudioMetadata>("bandcamp", normalizedUrl, result);
}

async function resolveSoundCloudPlayableItem<TStaticAudioMetadata>(
  normalizedUrl: string
): Promise<PlayablePlatformResolutionResult<TStaticAudioMetadata>> {
  const result = await getSoundCloudItem(normalizedUrl);
  if (!result.success) {
    return providerError(
      "soundcloud",
      result.error || "Failed to resolve SoundCloud item"
    );
  }
  return itemResult<TStaticAudioMetadata>("soundcloud", normalizedUrl, result);
}

async function resolveYouTubePlayableItem<TStaticAudioMetadata>(
  normalizedUrl: string,
  invidiousOptions: InvidiousOptions | undefined
): Promise<PlayablePlatformResolutionResult<TStaticAudioMetadata>> {
  const result = await getYouTubeItem(normalizedUrl, invidiousOptions);
  if (!result.success) {
    return providerError(
      "youtube",
      result.error || "Failed to resolve YouTube item"
    );
  }
  return itemResult<TStaticAudioMetadata>("youtube", normalizedUrl, result);
}

async function resolveRadioGardenPlayableItem<TStaticAudioMetadata>(
  normalizedUrl: string
): Promise<PlayablePlatformResolutionResult<TStaticAudioMetadata>> {
  const channelId = extractChannelId(normalizedUrl);
  if (!channelId) {
    return {
      error: {
        code: "radiogarden-channel-id-missing",
        message: "Could not extract Radio Garden channel ID from URL",
        platform: "radiogarden",
      },
      success: false,
    };
  }

  const result = await getRadioGardenItem(channelId);
  if (!result.success) {
    return providerError(
      "radiogarden",
      result.error || "Failed to resolve Radio Garden item"
    );
  }
  return itemResult<TStaticAudioMetadata>("radiogarden", normalizedUrl, result);
}

async function resolveStaticAudioPlayableItem<TStaticAudioMetadata>(
  normalizedUrl: string,
  resolveStaticAudioItem:
    | StaticAudioItemResolver<TStaticAudioMetadata>
    | undefined
): Promise<PlayablePlatformResolutionResult<TStaticAudioMetadata>> {
  if (!resolveStaticAudioItem) {
    return {
      error: {
        code: "static-audio-resolution-failed",
        message: "Failed to resolve static audio item",
        platform: "static-audio",
      },
      success: false,
    };
  }

  try {
    const result = await resolveStaticAudioItem(normalizedUrl);
    return itemResult<TStaticAudioMetadata>(
      "static-audio",
      normalizedUrl,
      result
    );
  } catch (error) {
    return {
      error: {
        code: "static-audio-resolution-failed",
        message: errorMessage(error, "Failed to resolve static audio item"),
        platform: "static-audio",
      },
      success: false,
    };
  }
}

function itemResult<TStaticAudioMetadata>(
  platform: PlayablePlatform,
  normalizedUrl: string,
  result: {
    metadata: PlatformMetadata | TStaticAudioMetadata;
    streamUrl: string;
  }
): PlayablePlatformResolutionResult<TStaticAudioMetadata> {
  return {
    item: {
      metadata: result.metadata,
      normalizedUrl,
      platform,
      streamUrl: result.streamUrl,
    },
    success: true,
  };
}

function getPlatformTrackThumbnail(
  platform: Platform,
  track: PlatformTrack,
  artwork?: string
): string | undefined {
  if (platform === "youtube" && "thumbnail" in track) {
    return track.thumbnail ?? artwork;
  }
  return artwork;
}

function hasTracks(
  metadata: PlatformMetadata
): metadata is PlatformMetadata & { tracks: PlatformTrack[] } {
  return "tracks" in metadata && Array.isArray(metadata.tracks);
}

function isCollectionMetadata(metadata: PlatformMetadata): boolean {
  if (metadata.platform === "radiogarden") {
    return false;
  }
  if (metadata.platform === "youtube") {
    return metadata.itemType === "playlist";
  }
  return metadata.itemType !== "track";
}

export async function normalizePlayablePlatformUrl(
  url: string,
  {
    resolveShortLink: resolve = resolveShortLink,
  }: NormalizePlayablePlatformUrlOptions = {}
): Promise<string> {
  let normalized = url.trim();

  if (needsResolution(normalized)) {
    normalized = await resolve(normalized);
  }

  normalized = normalizeSoundCloudUrl(normalized);
  return normalizeBandcampUrl(normalized);
}

export function detectPlayablePlatformFromUrl(
  url: string
): PlayablePlatform | null {
  const external = detectPlatformFromUrl(url);
  if (external) {
    return external;
  }

  if (url && isStaticAudioUrl(url)) {
    return "static-audio";
  }

  return null;
}

export function toPlayableSources(
  item: PlayablePlatformItem<unknown>
): PlayableSource[] {
  const { normalizedUrl, platform, streamUrl } = item;

  if (platform === "static-audio") {
    return [
      {
        artist: "Direct Link",
        isLiveStream: false,
        platform,
        streamUrl,
        title: getFilenameFromUrl(normalizedUrl) || "Unknown",
        url: normalizedUrl,
      },
    ];
  }

  const metadata = item.metadata as PlatformMetadata;

  if (metadata.platform === "radiogarden") {
    return [
      {
        artist:
          [metadata.placeTitle, metadata.countryTitle]
            .filter(Boolean)
            .join(", ") || "Radio Garden",
        isLiveStream: true,
        platform,
        streamUrl,
        title: metadata.name ?? "Radio Garden Station",
        url: normalizedUrl,
      },
    ];
  }

  if (isCollectionMetadata(metadata) && hasTracks(metadata)) {
    return metadata.tracks.map((track) => ({
      artist: metadata.artist ?? "Unknown",
      duration: track.duration,
      isLiveStream: false,
      platform,
      streamUrl: track.streamUrl,
      thumbnail: getPlatformTrackThumbnail(platform, track, metadata.artwork),
      title: track.name,
      url: normalizedUrl,
    }));
  }

  return [
    {
      artist: metadata.artist ?? "Unknown",
      duration: metadata.duration,
      isLiveStream: false,
      platform,
      streamUrl,
      thumbnail: "artwork" in metadata ? metadata.artwork : undefined,
      title: metadata.name ?? "Unknown",
      url: normalizedUrl,
    },
  ];
}

export function createPlayablePlatformResolver<TStaticAudioMetadata = never>({
  invidiousOptions,
  resolveStaticAudioItem,
}: PlayablePlatformResolverOptions<TStaticAudioMetadata> = {}) {
  async function resolveNormalizedItem(
    normalizedUrl: string
  ): Promise<PlayablePlatformResolutionResult<TStaticAudioMetadata>> {
    const platform = detectPlayablePlatformFromUrl(normalizedUrl);

    switch (platform) {
      case "bandcamp":
        return await resolveBandcampPlayableItem(normalizedUrl);
      case "soundcloud":
        return await resolveSoundCloudPlayableItem(normalizedUrl);
      case "youtube":
        return await resolveYouTubePlayableItem(
          normalizedUrl,
          resolveInvidiousOptions(invidiousOptions)
        );
      case "radiogarden":
        return await resolveRadioGardenPlayableItem(normalizedUrl);
      case "static-audio":
        return await resolveStaticAudioPlayableItem(
          normalizedUrl,
          resolveStaticAudioItem
        );
      case null:
        return unsupportedUrlResult();
      default:
        return unsupportedUrlResult();
    }
  }

  async function resolveItem(
    url: string
  ): Promise<PlayablePlatformResolutionResult<TStaticAudioMetadata>> {
    return resolveNormalizedItem(await normalizePlayablePlatformUrl(url));
  }

  return { resolveItem, resolveNormalizedItem };
}
