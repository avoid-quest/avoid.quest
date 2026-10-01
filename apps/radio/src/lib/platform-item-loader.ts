import { detectPlayablePlatformFromUrl } from "@avoid.quest/platforms";
import type { YouTubeClient } from "@avoid.quest/platforms/youtube";
import type { Radio } from "@/lib/audio";
import { resolveClientStaticAudio } from "@/lib/audio/client-static-audio-resolver";
import { inferStreamFormat } from "@/lib/audio/playback/stream-format";
import {
  browserAudioRadio,
  detectBrowserAudioSource,
} from "@/lib/browser-audio-links";
import {
  type PlatformItem,
  resolvePlatformItem,
  resolveSpotifyItem,
} from "@/lib/platform-client";
import { resolvePlatformStation } from "@/lib/stations/external-station-workflow";
import { getYouTubeClient } from "@/lib/youtube";

type PlatformItemPayloadResult =
  | { data: PlatformItem; ok: true }
  | { error: { code: string; message: string }; ok: false };

type PlatformItemLoaderDependencies = {
  getYouTubeClient: () => Pick<YouTubeClient, "resolveItem">;
  resolvePlatformItem: (url: string) => Promise<PlatformItem>;
  /** Spotify metadata from the server, matched to YouTube in the browser. */
  resolveSpotifyItem: (url: string) => Promise<PlatformItem>;
  resolveStaticAudio: (url: string) => Promise<PlatformItem>;
};

export type LoadPlatformItemResult =
  | { radio: Radio; success: true }
  | { code: string; error: string; success: false };

async function resolveStaticAudioItem(
  url: string,
  resolver: PlatformItemLoaderDependencies["resolveStaticAudio"]
): Promise<PlatformItemPayloadResult> {
  try {
    return { data: await resolver(url), ok: true };
  } catch (error) {
    return {
      error: {
        code: "STATIC_AUDIO_CLIENT_RESOLUTION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Failed to resolve static audio in the browser",
      },
      ok: false,
    };
  }
}

async function resolveYouTube(
  url: string,
  getClient: PlatformItemLoaderDependencies["getYouTubeClient"]
): Promise<PlatformItemPayloadResult> {
  try {
    const result = await getClient().resolveItem(url);
    return {
      data: { metadata: result.metadata, streamUrl: result.streamUrl },
      ok: true,
    };
  } catch (error) {
    return {
      error: {
        code: "YOUTUBE_CLIENT_RESOLUTION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Failed to resolve YouTube item",
      },
      ok: false,
    };
  }
}

async function resolveExternalPlatform(
  url: string,
  resolver: PlatformItemLoaderDependencies["resolvePlatformItem"]
): Promise<PlatformItemPayloadResult> {
  try {
    const result = await resolver(url);
    const selectedTrack =
      "tracks" in result.metadata && result.metadata.tracks
        ? result.metadata.tracks.find(
            (track) => track.streamUrl === result.streamUrl
          )
        : undefined;
    const selectedTrackFormat =
      selectedTrack && "format" in selectedTrack
        ? selectedTrack.format
        : undefined;
    return {
      data: {
        format:
          result.format ??
          selectedTrackFormat ??
          inferStreamFormat(result.streamUrl),
        metadata: result.metadata,
        streamUrl: result.streamUrl,
      },
      ok: true,
    };
  } catch (error) {
    return {
      error: {
        code: "PLATFORM_CLIENT_RESOLUTION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Failed to resolve platform item",
      },
      ok: false,
    };
  }
}

function unsupportedPlatform(): PlatformItemPayloadResult {
  return {
    error: {
      code: "PLATFORM_UNSUPPORTED_URL",
      message: "Unsupported platform URL",
    },
    ok: false,
  };
}

export function createPlatformItemLoader({
  getYouTubeClient: getClient,
  resolvePlatformItem: resolveExternalItem,
  resolveSpotifyItem: resolveSpotify,
  resolveStaticAudio,
}: PlatformItemLoaderDependencies): (
  url: string
) => Promise<LoadPlatformItemResult> {
  return async (url) => {
    if (detectBrowserAudioSource(url)) {
      return { radio: browserAudioRadio(url), success: true };
    }
    const result = await resolvePlatformStation(url, async (normalizedUrl) => {
      const platform = detectPlayablePlatformFromUrl(normalizedUrl);
      if (platform === "static-audio") {
        return await resolveStaticAudioItem(normalizedUrl, resolveStaticAudio);
      }
      if (platform === "youtube") {
        return await resolveYouTube(normalizedUrl, getClient);
      }
      if (
        platform === "bandcamp" ||
        platform === "mixcloud" ||
        platform === "radiogarden" ||
        platform === "soundcloud"
      ) {
        return await resolveExternalPlatform(
          normalizedUrl,
          resolveExternalItem
        );
      }
      if (platform === "spotify") {
        return await resolveExternalPlatform(normalizedUrl, resolveSpotify);
      }
      return unsupportedPlatform();
    });
    if (!result.ok) {
      return {
        code: result.error.code,
        error: result.error.message,
        success: false,
      };
    }
    return { radio: result.data, success: true };
  };
}

export const loadPlatformItem = createPlatformItemLoader({
  getYouTubeClient,
  resolvePlatformItem,
  resolveSpotifyItem: (url) =>
    resolveSpotifyItem(url, { youtube: getYouTubeClient() }),
  resolveStaticAudio: async (url) => {
    const resolved = await resolveClientStaticAudio(url);
    return {
      format: resolved.format,
      metadata: resolved.metadata,
      streamUrl: resolved.streamUrl,
    };
  },
});
