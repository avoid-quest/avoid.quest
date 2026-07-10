import { detectPlayablePlatformFromUrl } from "@avoid.quest/platforms";
import type { ResolverBroker } from "@avoid.quest/platforms/resolver";
import type { YouTubeClient } from "@avoid.quest/platforms/youtube";
import type { Radio } from "@/lib/audio";
import { resolveClientStaticAudio } from "@/lib/audio/client-static-audio-resolver";
import { STREAM_PROXY_ROUTE } from "@/lib/audio/playback/playback-source-shared";
import { inferStreamFormat } from "@/lib/audio/playback/stream-format";
import type { PlatformMetadata } from "@/lib/platform-types";
import { createConfiguredResolverBroker } from "@/lib/resolver";
import { resolvePlatformStation } from "@/lib/stations/external-station-workflow";
import { getConfiguredYouTubeClient } from "@/lib/youtube";

type PlatformItemPayload = {
  format?: "hls" | "progressive";
  metadata: PlatformMetadata;
  streamUrl: string;
};

type PlatformItemPayloadResult =
  | { data: PlatformItemPayload; ok: true }
  | { error: { code: string; message: string }; ok: false };

type PlatformItemLoaderDependencies = {
  getResolverBroker: () => Pick<ResolverBroker, "resolve">;
  getYouTubeClient: () => Pick<YouTubeClient, "resolveItem">;
  resolveStaticAudio: (url: string) => Promise<PlatformItemPayload>;
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
  platform: "bandcamp" | "radiogarden" | "soundcloud",
  url: string,
  getBroker: PlatformItemLoaderDependencies["getResolverBroker"]
): Promise<PlatformItemPayloadResult> {
  try {
    const result = await getBroker().resolve({ provider: platform, url });
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
  getResolverBroker,
  getYouTubeClient,
  resolveStaticAudio,
}: PlatformItemLoaderDependencies): (
  url: string
) => Promise<LoadPlatformItemResult> {
  return async (url) => {
    const result = await resolvePlatformStation(url, async (normalizedUrl) => {
      const platform = detectPlayablePlatformFromUrl(normalizedUrl);
      if (platform === "static-audio") {
        return await resolveStaticAudioItem(normalizedUrl, resolveStaticAudio);
      }
      if (platform === "youtube") {
        return await resolveYouTube(normalizedUrl, getYouTubeClient);
      }
      if (
        platform === "bandcamp" ||
        platform === "radiogarden" ||
        platform === "soundcloud"
      ) {
        return await resolveExternalPlatform(
          platform,
          normalizedUrl,
          getResolverBroker
        );
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

export const loadConfiguredPlatformItem = createPlatformItemLoader({
  getResolverBroker: createConfiguredResolverBroker,
  getYouTubeClient: getConfiguredYouTubeClient,
  resolveStaticAudio: async (url) => {
    const resolved = await resolveClientStaticAudio(url, {
      appServerFallback: async (upstreamUrl, init) =>
        await fetch(STREAM_PROXY_ROUTE + encodeURIComponent(upstreamUrl), init),
    });
    return {
      format: resolved.format,
      metadata: resolved.metadata,
      streamUrl: resolved.streamUrl,
    };
  },
});
