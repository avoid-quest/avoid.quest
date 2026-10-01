/**
 * Platform Stream Refresh
 *
 * YouTube, SoundCloud, Bandcamp, Mixcloud and Spotify (a YouTube mirror)
 * stream URLs expire. When one stops with
 * `STREAM_INTERRUPTED`, the platform is asked for a fresh URL and the sound
 * resumes on it at the position it stopped. DJ decks and Node lanes share
 * this; each reports the outcome its own way.
 *
 * A YouTube track in a playlist is stored as `yt:<videoId>`, and a Spotify
 * album or playlist track as `spotify:track:<id>`, until it plays, so the
 * next track, or a first pick, resolves through the same port.
 */

import { parseSpotifyTrackPlaceholder } from "@avoid.quest/platforms/spotify/detect";

import type { Radio } from "@/lib/audio";
import {
  inferStreamFormat,
  type StreamFormat,
} from "@/lib/audio/playback/stream-format";
import { validatePlaybackStreamUrl } from "@/lib/audio/playback/url-validation";
import type {
  PlatformStreamResolution,
  PlatformStreamResolutionInput,
} from "@/lib/dj-platform-stream-port";
import {
  isSpotifyMetadata,
  isYouTubeMetadata,
  type SpotifyMetadata,
} from "@/lib/platform-types";

export type StreamRefreshRequest = {
  failureCode: string;
  failureMessage: string;
  resolution: PlatformStreamResolutionInput;
};

export type ResolvePlatformStream = (
  input: PlatformStreamResolutionInput
) => Promise<PlatformStreamResolution | null>;

/**
 * A Spotify radio's playing track renews from the YouTube upload it was
 * matched to, without matching again; one not matched yet is matched.
 */
function getSpotifyRefreshRequest(
  radio: Radio,
  metadata: SpotifyMetadata
): StreamRefreshRequest | null {
  const track =
    metadata.itemType === "track"
      ? metadata
      : metadata.tracks?.find((item) => item.streamUrl === radio.streamUrl);
  if (!track) {
    return null;
  }
  const failure = {
    failureCode: "DJ_SPOTIFY_REFRESH_FAILED",
    failureMessage: "Failed to refresh Spotify stream - please reload",
  };
  return track.youtubeVideoId
    ? {
        ...failure,
        resolution: {
          platform: "youtube",
          radio,
          reason: "stream-refresh",
          videoId: track.youtubeVideoId,
        },
      }
    : {
        ...failure,
        resolution: {
          platform: "spotify",
          radio,
          reason: "stream-refresh",
          spotifyId: track.spotifyId,
        },
      };
}

const CANONICAL_PROVIDER_NAMES = {
  bandcamp: "Bandcamp",
  mixcloud: "Mixcloud",
  soundcloud: "SoundCloud",
} as const;

/** The platform request that renews `radio`'s stream, if it has one. */
export function getRefreshRequest(radio: Radio): StreamRefreshRequest | null {
  const metadata = radio.platformMetadata;
  if (isSpotifyMetadata(metadata)) {
    return getSpotifyRefreshRequest(radio, metadata);
  }
  const videoId = isYouTubeMetadata(metadata)
    ? (metadata.videoId ??
      metadata.tracks?.find((track) => track.streamUrl === radio.streamUrl)
        ?.videoId)
    : undefined;
  if (videoId) {
    return {
      failureCode: "DJ_YOUTUBE_REFRESH_FAILED",
      failureMessage: "Failed to refresh YouTube stream - please reload",
      resolution: {
        platform: "youtube",
        radio,
        reason: "stream-refresh",
        videoId,
      },
    };
  }
  if (
    metadata?.platform !== "bandcamp" &&
    metadata?.platform !== "mixcloud" &&
    metadata?.platform !== "soundcloud"
  ) {
    return null;
  }
  const canonicalUrl = metadata.url.trim();
  if (!canonicalUrl) {
    return null;
  }
  const providerName = CANONICAL_PROVIDER_NAMES[metadata.platform];
  return {
    failureCode: `DJ_${metadata.platform.toUpperCase()}_REFRESH_FAILED`,
    failureMessage: `Failed to refresh ${providerName} stream - please reload`,
    resolution: {
      canonicalUrl,
      platform: metadata.platform,
      radio,
      reason: "stream-refresh",
    },
  };
}

/** What resolves a lazy track, short of the radio and the reason. */
export type LazyTrackRequest =
  | { platform: "spotify"; spotifyId: string }
  | { platform: "youtube"; videoId: string };

/** The request for a lazy `yt:` or `spotify:track:` URL; null for any other. */
export function lazyTrackRequest(streamUrl: string): LazyTrackRequest | null {
  const spotifyId = parseSpotifyTrackPlaceholder(streamUrl);
  if (spotifyId) {
    return { platform: "spotify", spotifyId };
  }
  return streamUrl.startsWith("yt:")
    ? { platform: "youtube", videoId: streamUrl.slice(3) }
    : null;
}

export type PlatformStreamRefreshOptions = {
  resolveStream: ResolvePlatformStream;
  refresh: (
    soundId: string,
    streamUrl: string,
    position: number,
    streamFormat: StreamFormat
  ) => Promise<void>;
  /** Whether the sound is still the one that stopped. */
  isCurrent: () => boolean;
  /** The sound plays again on its new URL. */
  onRefreshed: () => void;
  /** The platform gave no new URL. */
  onUnresolved: (request: StreamRefreshRequest) => void;
  /** Resolving or refreshing threw, or the new URL is not playable. */
  onFailed: (request: StreamRefreshRequest, error: unknown) => void;
};

/**
 * Renews an interrupted platform stream and resumes it at `position`. A
 * radio with no refresh request (a live stream, a file) is left alone, and
 * a sound replaced meanwhile hears nothing back.
 */
export async function refreshPlatformStream(
  radio: Radio,
  soundId: string,
  position: number,
  options: PlatformStreamRefreshOptions
): Promise<void> {
  const request = getRefreshRequest(radio);
  if (!request) {
    return;
  }
  try {
    const resolved = await options.resolveStream(request.resolution);
    if (!options.isCurrent()) {
      return;
    }
    if (!resolved) {
      options.onUnresolved(request);
      return;
    }
    const validation = validatePlaybackStreamUrl(resolved.streamUrl);
    if (!validation.ok) {
      throw new Error("Invalid refreshed stream URL");
    }
    await options.refresh(
      soundId,
      validation.normalizedUrl,
      position,
      resolved.streamFormat
    );
    if (options.isCurrent()) {
      options.onRefreshed();
    }
  } catch (error) {
    if (options.isCurrent()) {
      options.onFailed(request, error);
    }
  }
}

/**
 * `radio` set to play `streamUrl`, one of its tracks: a `yt:` or
 * `spotify:track:` track is resolved first and its URL (and a Spotify
 * track's match) kept on the track, so the next track after it is found and
 * an expired stream renews. Null when it can't be resolved or played.
 */
export async function radioOnTrack(
  radio: Radio,
  streamUrl: string,
  resolveStream: ResolvePlatformStream,
  reason: "initial-load" | "playlist-next" = "playlist-next"
): Promise<Radio | null> {
  let resolved: PlatformStreamResolution | null = {
    streamFormat: inferStreamFormat(streamUrl),
    streamUrl,
  };
  const metadata = radio.platformMetadata;
  const spotifyId = parseSpotifyTrackPlaceholder(streamUrl);
  if (spotifyId) {
    const matched = await resolveStream({
      platform: "spotify",
      radio,
      reason,
      spotifyId,
    });
    if (!(matched && isSpotifyMetadata(metadata) && metadata.tracks)) {
      return null;
    }
    return withStream(
      {
        ...radio,
        platformMetadata: {
          ...metadata,
          tracks: metadata.tracks.map((track) =>
            track.spotifyId === spotifyId
              ? {
                  ...track,
                  streamUrl: matched.streamUrl,
                  youtubeVideoId:
                    matched.youtubeVideoId ?? track.youtubeVideoId,
                }
              : track
          ),
        },
      },
      matched
    );
  }
  if (streamUrl.startsWith("yt:")) {
    const videoId = streamUrl.slice(3);
    resolved = await resolveStream({
      platform: "youtube",
      radio,
      reason,
      videoId,
    });
    if (!resolved) {
      return null;
    }
    if (isYouTubeMetadata(metadata) && metadata.tracks) {
      const played = resolved.streamUrl;
      return withStream(
        {
          ...radio,
          platformMetadata: {
            ...metadata,
            tracks: metadata.tracks.map((track) =>
              track.videoId === videoId
                ? { ...track, streamUrl: played }
                : track
            ),
          },
        },
        resolved
      );
    }
  } else if (metadata && "tracks" in metadata && metadata.tracks) {
    const track = metadata.tracks.find((item) => item.streamUrl === streamUrl);
    if (track && "format" in track && track.format) {
      resolved = { streamFormat: track.format, streamUrl };
    }
  }
  return withStream(radio, resolved);
}

function withStream(
  radio: Radio,
  resolved: PlatformStreamResolution
): Radio | null {
  const validation = validatePlaybackStreamUrl(resolved.streamUrl);
  return validation.ok
    ? {
        ...radio,
        streamFormat: resolved.streamFormat,
        streamUrl: validation.normalizedUrl,
      }
    : null;
}
