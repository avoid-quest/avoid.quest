import {
  resolveSpotifyTrackStream,
  toSpotifyMatchTrack,
} from "@avoid.quest/platforms/spotify/mirror";
import type { Radio } from "@/lib/audio";
import {
  inferStreamFormat,
  type StreamFormat,
} from "@/lib/audio/playback/stream-format";
import { resolvePlatformItem } from "@/lib/platform-client";
import { isSpotifyMetadata } from "@/lib/platform-types";
import { getYouTubeClient } from "@/lib/youtube";

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

/** A Spotify track of `radio`, matched to a YouTube upload. */
type SpotifyStreamResolutionInput = {
  platform: "spotify";
  reason: StreamResolutionReason;
  spotifyId: string;
  radio: Radio;
};

type CanonicalPlatformStreamResolutionInput = {
  canonicalUrl: string;
  platform: "bandcamp" | "mixcloud" | "soundcloud";
  reason: "stream-refresh";
  radio: Radio;
};

type PlatformStreamResolutionInput =
  | CanonicalPlatformStreamResolutionInput
  | SpotifyStreamResolutionInput
  | YouTubeStreamResolutionInput;

type PlatformStreamResolution = {
  streamFormat: StreamFormat;
  streamUrl: string;
  /** The upload a Spotify track was matched to, to renew it by. */
  youtubeVideoId?: string;
};

type SelectedCollectionStream = {
  format?: StreamFormat;
  streamUrl: string;
};

function selectRefreshedCollectionStream(
  radio: Radio,
  resolvedStreamUrl: string,
  resolvedMetadata: NonNullable<Radio["platformMetadata"]>
): SelectedCollectionStream {
  const currentMetadata = radio.platformMetadata;
  if (!(currentMetadata && "tracks" in currentMetadata)) {
    return { streamUrl: resolvedStreamUrl };
  }
  if (
    !(
      currentMetadata.tracks &&
      "tracks" in resolvedMetadata &&
      resolvedMetadata.tracks
    )
  ) {
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

async function resolveSpotifyStream(
  input: SpotifyStreamResolutionInput,
  getClient: typeof getYouTubeClient
): Promise<PlatformStreamResolution | null> {
  const metadata = input.radio.platformMetadata;
  if (!isSpotifyMetadata(metadata)) {
    return null;
  }
  const track =
    metadata.itemType === "track" && metadata.spotifyId === input.spotifyId
      ? metadata
      : metadata.tracks?.find((item) => item.spotifyId === input.spotifyId);
  if (!track) {
    return null;
  }
  try {
    const stream = await resolveSpotifyTrackStream(toSpotifyMatchTrack(track), {
      youtube: getClient(),
    });
    return stream.success
      ? {
          ...resolvedStream(stream.streamUrl),
          youtubeVideoId: stream.match.videoId,
        }
      : null;
  } catch {
    return null;
  }
}

export async function resolveDjPlatformStreamUrl(
  input: PlatformStreamResolutionInput,
  dependencies: {
    getYouTubeClient?: typeof getYouTubeClient;
    resolvePlatformItem?: typeof resolvePlatformItem;
  } = {}
): Promise<PlatformStreamResolution | null> {
  switch (input.platform) {
    case "youtube": {
      const streamUrl = await (
        dependencies.getYouTubeClient ?? getYouTubeClient
      )().resolveStream(input.videoId);
      return resolvedStream(streamUrl);
    }
    case "spotify":
      return await resolveSpotifyStream(
        input,
        dependencies.getYouTubeClient ?? getYouTubeClient
      );
    case "bandcamp":
    case "mixcloud":
    case "soundcloud": {
      try {
        const resolved = await (
          dependencies.resolvePlatformItem ?? resolvePlatformItem
        )(input.canonicalUrl);
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
  SpotifyStreamResolutionInput,
};
