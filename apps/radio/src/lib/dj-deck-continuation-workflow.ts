import type { AudioManager, Radio } from "@/lib/audio";
import type { DeckId, DeckSide } from "@/lib/dj-actions-decks.js";
import { findNextTrack as findNextTrackInPlaylist } from "@/lib/dj-actions-playlist.js";
import type {
  PlatformStreamResolution,
  PlatformStreamResolutionInput,
} from "@/lib/dj-platform-stream-port.js";
import type { DeckRecord } from "@/lib/hooks/use-dj-state";
import { isYouTubeMetadata } from "@/lib/platform-types";
import {
  createPlaybackActionError,
  type PlaybackActionError,
} from "./playback-action-errors.js";

type ReportDjError = (
  message: string,
  code: string,
  error?: unknown,
  radio?: Radio | null,
  channelId?: DeckId | null
) => void;

type DjDeckContinuationDependencies = {
  applyCrossfade: () => void;
  clearDjError: (deckId?: DeckId) => void;
  getAudioManager: () => AudioManager;
  loadTrack: (
    deckSide: DeckSide,
    radio: Radio | null,
    autoPlay?: boolean
  ) => Promise<void>;
  playDeckSound: (soundId: string, volume: number) => Promise<void>;
  reportDjError: ReportDjError;
  reportPlaybackError?: (error: PlaybackActionError) => void;
  resolvePlatformStreamUrl: (
    input: PlatformStreamResolutionInput
  ) => Promise<PlatformStreamResolution | null>;
  seekDeckSound: (soundId: string, position: number) => void;
};

type TrackEndedInput = {
  deckId: DeckId;
  deckSide: DeckSide;
  currentDeck: DeckRecord;
  soundId: string;
  resetChannelStripFlag: () => void;
};

type StreamInterruptedInput = {
  deckId: DeckId;
  currentRadio: Radio;
  position: number;
  soundId: string;
};

type StreamInterruptedResult = "refreshed" | "not-refreshable" | "failed";

type StreamRefreshRequest = {
  failureCode: string;
  failureMessage: string;
  resolution: PlatformStreamResolutionInput;
};

function getStreamRefreshRequest(
  currentRadio: Radio
): StreamRefreshRequest | null {
  const metadata = currentRadio.platformMetadata;
  if (isYouTubeMetadata(metadata) && metadata.videoId) {
    return {
      failureCode: "DJ_YOUTUBE_REFRESH_FAILED",
      failureMessage: "Failed to refresh YouTube stream - please reload",
      resolution: {
        platform: "youtube",
        reason: "stream-refresh",
        videoId: metadata.videoId,
        radio: currentRadio,
      },
    };
  }

  if (
    metadata?.platform !== "bandcamp" &&
    metadata?.platform !== "soundcloud"
  ) {
    return null;
  }
  const canonicalUrl = metadata.url.trim();
  if (!canonicalUrl) {
    return null;
  }
  const providerName =
    metadata.platform === "bandcamp" ? "Bandcamp" : "SoundCloud";
  return {
    failureCode: `DJ_${metadata.platform.toUpperCase()}_REFRESH_FAILED`,
    failureMessage: `Failed to refresh ${providerName} stream - please reload`,
    resolution: {
      canonicalUrl,
      platform: metadata.platform,
      reason: "stream-refresh",
      radio: currentRadio,
    },
  };
}

type DjDeckContinuationWorkflow = {
  handleTrackEnded: (input: TrackEndedInput) => Promise<void>;
  handleStreamInterrupted: (
    input: StreamInterruptedInput
  ) => Promise<StreamInterruptedResult>;
};

function reportContinuationFailure(
  dependencies: DjDeckContinuationDependencies,
  input: {
    code: string;
    deckId?: DeckId;
    error: unknown;
    fallbackMessage: string;
    radio?: Radio | null;
  }
) {
  const playbackError = createPlaybackActionError({
    mode: "dj",
    code: "PLAY_ERROR",
    cause: input.error,
    channelId: input.deckId,
    radio: input.radio ?? undefined,
    fallbackMessage: input.fallbackMessage,
  });
  dependencies.reportPlaybackError?.(playbackError);
  dependencies.reportDjError(
    playbackError.userMessage,
    input.code,
    playbackError.cause,
    input.radio,
    input.deckId
  );
}

async function resolveAndLoadYouTubeTrack(
  deckId: DeckId,
  deckSide: DeckSide,
  deckRadio: Radio,
  videoId: string,
  dependencies: DjDeckContinuationDependencies
): Promise<void> {
  const resolved = await dependencies.resolvePlatformStreamUrl({
    platform: "youtube",
    reason: "playlist-next",
    videoId,
    radio: deckRadio,
  });
  if (!resolved) {
    dependencies.reportDjError(
      "Failed to resolve next track: no stream URL found",
      "DJ_NEXT_TRACK_RESOLVE_FAILED",
      undefined,
      deckRadio,
      deckId
    );
    return;
  }

  if (
    isYouTubeMetadata(deckRadio.platformMetadata) &&
    deckRadio.platformMetadata.tracks
  ) {
    const track = deckRadio.platformMetadata.tracks.find(
      (item) => "videoId" in item && item.videoId === videoId
    );
    if (track) {
      track.streamUrl = resolved.streamUrl;
    }
  }

  await dependencies.loadTrack(
    deckSide,
    {
      ...deckRadio,
      streamFormat: resolved.streamFormat,
      streamUrl: resolved.streamUrl,
    },
    true
  );
}

async function handleTrackEnded(
  input: TrackEndedInput,
  dependencies: DjDeckContinuationDependencies
): Promise<void> {
  const { currentDeck, deckId, deckSide, resetChannelStripFlag, soundId } =
    input;

  if (currentDeck.repeat) {
    resetChannelStripFlag();
    dependencies.seekDeckSound(soundId, 0);
    try {
      await dependencies.playDeckSound(soundId, currentDeck.volume);
      dependencies.applyCrossfade();
    } catch (error) {
      reportContinuationFailure(dependencies, {
        code: "DJ_REPEAT_TRACK_FAILED",
        deckId,
        error,
        fallbackMessage: "Failed to repeat track",
        radio: currentDeck.radio,
      });
    }
    return;
  }

  if (!currentDeck.autoplay) {
    return;
  }

  const deckRadio = currentDeck.radio;
  if (!deckRadio) {
    return;
  }

  const nextTrack = findNextTrackInPlaylist(deckRadio);
  if (!nextTrack) {
    return;
  }

  try {
    const { streamFormat, streamUrl } = nextTrack;
    if (streamUrl.startsWith("yt:")) {
      await resolveAndLoadYouTubeTrack(
        deckId,
        deckSide,
        deckRadio,
        streamUrl.slice(3),
        dependencies
      );
      return;
    }

    await dependencies.loadTrack(
      deckSide,
      {
        ...deckRadio,
        streamFormat,
        streamUrl,
      },
      true
    );
  } catch (error) {
    reportContinuationFailure(dependencies, {
      code: "DJ_LOAD_NEXT_TRACK_FAILED",
      deckId,
      error,
      fallbackMessage: "Failed to load next track",
      radio: currentDeck.radio,
    });
  }
}

async function handleStreamInterrupted(
  input: StreamInterruptedInput,
  dependencies: DjDeckContinuationDependencies
): Promise<StreamInterruptedResult> {
  const { currentRadio, deckId, position, soundId } = input;
  const refreshRequest = getStreamRefreshRequest(currentRadio);
  if (!refreshRequest) {
    return "not-refreshable";
  }

  try {
    const resolved = await dependencies.resolvePlatformStreamUrl(
      refreshRequest.resolution
    );
    if (resolved) {
      const audioManager = dependencies.getAudioManager();
      await audioManager.refreshStreamUrl(
        soundId,
        resolved.streamUrl,
        position,
        resolved.streamFormat
      );
      dependencies.clearDjError(deckId);
      dependencies.applyCrossfade();
      return "refreshed";
    }

    dependencies.reportDjError(
      refreshRequest.failureMessage,
      refreshRequest.failureCode,
      undefined,
      currentRadio,
      deckId
    );
    return "failed";
  } catch (error) {
    reportContinuationFailure(dependencies, {
      code: "DJ_STREAM_REFRESH_FAILED",
      deckId,
      error,
      fallbackMessage: refreshRequest.failureMessage,
      radio: currentRadio,
    });
    return "failed";
  }
}

export function createDjDeckContinuationWorkflow(
  dependencies: DjDeckContinuationDependencies
): DjDeckContinuationWorkflow {
  return {
    handleStreamInterrupted: (input) =>
      handleStreamInterrupted(input, dependencies),
    handleTrackEnded: (input) => handleTrackEnded(input, dependencies),
  };
}

export type { PlatformStreamResolutionInput } from "@/lib/dj-platform-stream-port.js";
export type {
  DjDeckContinuationDependencies,
  DjDeckContinuationWorkflow,
  StreamInterruptedResult,
};
