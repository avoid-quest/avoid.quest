import type { ResolverBroker } from "@avoid.quest/platforms/resolver";
import type { Radio } from "@/lib/audio";
import {
  inferStreamFormat,
  type StreamFormat,
} from "@/lib/audio/playback/stream-format";
import { createConfiguredResolverBroker } from "@/lib/resolver";
import { getConfiguredYouTubeClient } from "@/lib/youtube";

type StreamResolutionReason =
  | "initial-load"
  | "playlist-next"
  | "stream-refresh";

type YouTubeStreamResolutionInput = {
  platform: "youtube";
  reason: StreamResolutionReason;
  videoId: string;
  radio: Radio;
};

type CanonicalPlatformStreamResolutionInput = {
  canonicalUrl: string;
  platform: "bandcamp" | "soundcloud";
  reason: "stream-refresh";
  radio: Radio;
};

type PlatformStreamResolutionInput =
  | CanonicalPlatformStreamResolutionInput
  | YouTubeStreamResolutionInput;

type PlatformStreamResolution = {
  streamFormat: StreamFormat;
  streamUrl: string;
};

type TrackCollection = {
  tracks?: { format?: StreamFormat; streamUrl: string }[];
};

type SelectedCollectionStream = {
  format?: StreamFormat;
  streamUrl: string;
};

function selectRefreshedCollectionStream(
  radio: Radio,
  resolvedStreamUrl: string,
  resolvedMetadata: TrackCollection
): SelectedCollectionStream {
  const currentMetadata = radio.platformMetadata;
  if (!(currentMetadata && "tracks" in currentMetadata)) {
    return { streamUrl: resolvedStreamUrl };
  }
  if (!(currentMetadata.tracks && resolvedMetadata.tracks)) {
    return { streamUrl: resolvedStreamUrl };
  }
  const currentIndex = currentMetadata.tracks.findIndex(
    (track) => track.streamUrl === radio.streamUrl
  );
  return (
    resolvedMetadata.tracks[currentIndex] ?? { streamUrl: resolvedStreamUrl }
  );
}

function resolvedStream(
  streamUrl: string,
  streamFormat = inferStreamFormat(streamUrl)
): PlatformStreamResolution {
  return { streamFormat, streamUrl };
}

export async function resolveDjPlatformStreamUrl(
  input: PlatformStreamResolutionInput,
  dependencies: {
    getResolverBroker?: () => Pick<ResolverBroker, "resolve">;
    getYouTubeClient?: typeof getConfiguredYouTubeClient;
    resolveCanonicalStream?: (
      input: CanonicalPlatformStreamResolutionInput
    ) => Promise<PlatformStreamResolution | null>;
  } = {}
): Promise<PlatformStreamResolution | null> {
  switch (input.platform) {
    case "youtube": {
      try {
        const streamUrl = await (
          dependencies.getYouTubeClient ?? getConfiguredYouTubeClient
        )().resolveStream(input.videoId);
        return resolvedStream(streamUrl);
      } catch {
        return null;
      }
    }
    case "bandcamp":
    case "soundcloud": {
      try {
        if (dependencies.resolveCanonicalStream) {
          return (await dependencies.resolveCanonicalStream(input)) ?? null;
        }
        const resolved = await (
          dependencies.getResolverBroker ?? createConfiguredResolverBroker
        )().resolve({
          provider: input.platform,
          url: input.canonicalUrl,
        });
        const selected = selectRefreshedCollectionStream(
          input.radio,
          resolved.streamUrl,
          resolved.metadata
        );
        return resolvedStream(
          selected.streamUrl,
          selected.format ??
            (selected.streamUrl === resolved.streamUrl
              ? (resolved.format ?? inferStreamFormat(selected.streamUrl))
              : inferStreamFormat(selected.streamUrl))
        );
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

export type {
  CanonicalPlatformStreamResolutionInput,
  PlatformStreamResolution,
  PlatformStreamResolutionInput,
};
