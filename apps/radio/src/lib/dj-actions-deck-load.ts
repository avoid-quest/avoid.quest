import type { AudioManager, Radio } from "@/lib/audio";
import { revokeFileObjectUrl } from "@/lib/audio/file-metadata";
import {
  type DeckId,
  type DeckSide,
  deckConfig,
  getDeckRadio,
} from "@/lib/dj-actions-decks.js";
import { findNextTrack as findNextTrackInPlaylist } from "@/lib/dj-actions-playlist.js";
import {
  type DeckRecord,
  resetDeck as resetDeckDb,
} from "@/lib/hooks/use-dj-state";
import { isFileMetadata, isYouTubeMetadata } from "@/lib/platform-types";

type ReportDjError = (
  message: string,
  code: string,
  error?: unknown,
  radio?: Radio | null
) => void;

type DeckLoadDependencies = {
  applyCrossfade: () => void;
  applyStoredChannelStrip: (
    audioManager: AudioManager,
    soundId: string,
    muted: boolean,
    pan: number,
    speed: number,
    channelFilter: number,
    effectsDryWet: number
  ) => void;
  applyStoredEffectsAndFilters: (
    audioManager: AudioManager,
    soundId: string,
    effects: DeckRecord["effects"],
    filter: DeckRecord["filter"]
  ) => Promise<void>;
  clearDjError: () => void;
  connectDeckCueBus: (
    deckId: DeckId,
    soundId: string,
    getAudioManager: () => AudioManager
  ) => void;
  getAudioManager: () => AudioManager;
  getSoundId: (radio: Radio, side: DeckSide) => string;
  initializeAudioDevices: (
    getAudioManager: () => AudioManager,
    reportDjError: ReportDjError
  ) => Promise<void>;
  loadTrack: (
    deckSide: DeckSide,
    radio: Radio | null,
    autoPlay?: boolean
  ) => Promise<void>;
  reportDjError: ReportDjError;
  resolveStreamUrl: (videoId: string) => Promise<string | null>;
};

async function resolveAndLoadYouTubeTrack(
  side: DeckSide,
  deckRadio: Radio,
  videoId: string,
  dependencies: DeckLoadDependencies
): Promise<void> {
  const resolvedUrl = await dependencies.resolveStreamUrl(videoId);
  if (!resolvedUrl) {
    dependencies.reportDjError(
      "Failed to resolve next track: no stream URL found",
      "DJ_NEXT_TRACK_RESOLVE_FAILED",
      undefined,
      deckRadio
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
      track.streamUrl = resolvedUrl;
    }
  }

  await dependencies.loadTrack(
    side,
    { ...deckRadio, streamUrl: resolvedUrl },
    true
  );
}

async function handleTrackEnded(
  config: (typeof deckConfig)["deck-a"],
  currentDeck: DeckRecord,
  soundId: string,
  resetChannelStripFlag: () => void,
  dependencies: DeckLoadDependencies
): Promise<void> {
  if (currentDeck.repeat) {
    resetChannelStripFlag();
    dependencies.getAudioManager().seekSound(soundId, 0);
    try {
      await dependencies
        .getAudioManager()
        .playSound(soundId, currentDeck.volume);
      dependencies.applyCrossfade();
    } catch (error) {
      dependencies.reportDjError(
        `Failed to repeat track: ${error instanceof Error ? error.message : "Unknown error"}`,
        "DJ_REPEAT_TRACK_FAILED",
        error,
        currentDeck.radio
      );
    }
    return;
  }

  if (!currentDeck.autoplay) {
    return;
  }

  const deckRadio = getDeckRadio(currentDeck);
  const nextTrack = findNextTrackInPlaylist(deckRadio);
  if (!(nextTrack && deckRadio)) {
    return;
  }

  const { streamUrl } = nextTrack;
  if (streamUrl.startsWith("yt:")) {
    try {
      await resolveAndLoadYouTubeTrack(
        config.side,
        deckRadio,
        streamUrl.slice(3),
        dependencies
      );
    } catch (error) {
      dependencies.reportDjError(
        `Failed to load next track: ${error instanceof Error ? error.message : "Unknown error"}`,
        "DJ_LOAD_NEXT_TRACK_FAILED",
        error,
        currentDeck.radio
      );
    }
    return;
  }

  await dependencies.loadTrack(config.side, { ...deckRadio, streamUrl }, true);
}

async function handleYouTubeStreamInterrupted(
  soundId: string,
  videoId: string,
  position: number,
  dependencies: DeckLoadDependencies
): Promise<void> {
  try {
    const newUrl = await dependencies.resolveStreamUrl(videoId);
    if (newUrl) {
      await dependencies
        .getAudioManager()
        .refreshStreamUrl(soundId, newUrl, position);
      dependencies.clearDjError();
      dependencies.applyCrossfade();
      return;
    }

    dependencies.reportDjError(
      "Failed to refresh YouTube stream - please reload",
      "DJ_YOUTUBE_REFRESH_FAILED"
    );
  } catch (error) {
    dependencies.reportDjError(
      `Stream refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "DJ_STREAM_REFRESH_FAILED",
      error
    );
  }
}

async function cleanupFailedDeckLoad(
  config: (typeof deckConfig)["deck-a"],
  soundId: string,
  audioManager: AudioManager
): Promise<void> {
  const currentRuntime = config.getRuntime();
  if (currentRuntime.soundId !== soundId) {
    return;
  }

  const existingCleanup = config.getSubscriptionCleanup();
  if (existingCleanup) {
    config.setSubscriptionCleanup(null);
  }

  try {
    await audioManager.cleanupSound(soundId);
  } catch {
    // Cleanup failure during error recovery - nothing more to do.
  }

  config.resetRuntime();
}

export async function setDeckRadioSource(
  deckId: DeckId,
  radio: Radio | null,
  dependencies: DeckLoadDependencies
): Promise<void> {
  const config = deckConfig[deckId];
  const deck = config.getDeck();
  const runtime = config.getRuntime();

  if (!deck) {
    return;
  }

  const wasPlaying = runtime.isPlaying;
  const previousCleanup = config.getSubscriptionCleanup();
  if (previousCleanup) {
    config.setSubscriptionCleanup(null);
  }

  const previousRadio = getDeckRadio(deck);
  if (previousRadio && isFileMetadata(previousRadio.platformMetadata)) {
    revokeFileObjectUrl(previousRadio.platformMetadata.objectUrl);
  }

  if (runtime.soundId) {
    await dependencies.getAudioManager().cleanupSound(runtime.soundId);
  }

  if (!radio) {
    resetDeckDb(deckId);
    config.resetRuntime();
    return;
  }

  const soundId = dependencies.getSoundId(radio, config.side);

  try {
    dependencies.clearDjError();
    dependencies.getAudioManager().createSound(radio, soundId);

    config.updateDeck((draft) => {
      draft.radio = radio;
    });
    config.setSoundId(soundId);

    let hasAppliedChannelStrip = false;
    const cleanup = dependencies
      .getAudioManager()
      .subscribe(soundId, (audioState) => {
        const currentDeck = config.getDeck();
        const currentRuntime = config.getRuntime();

        if (
          audioState.isPlaying &&
          !audioState.isLoading &&
          !hasAppliedChannelStrip &&
          currentDeck
        ) {
          hasAppliedChannelStrip = true;
          dependencies.applyStoredEffectsAndFilters(
            dependencies.getAudioManager(),
            soundId,
            currentDeck.effects,
            currentDeck.filter
          );
          dependencies.applyStoredChannelStrip(
            dependencies.getAudioManager(),
            soundId,
            currentDeck.muted,
            currentDeck.pan,
            currentDeck.speed,
            currentDeck.channelFilter,
            currentDeck.effectsDryWet
          );
          dependencies.connectDeckCueBus(
            deckId,
            soundId,
            dependencies.getAudioManager
          );
          dependencies
            .initializeAudioDevices(
              dependencies.getAudioManager,
              dependencies.reportDjError
            )
            .catch((error) => {
              console.warn(
                "[dj-actions] Failed to initialize audio devices:",
                error
              );
            });
        }

        const trackEnded = audioState.hasEnded;

        if (
          currentRuntime.isPlaying !== audioState.isPlaying ||
          currentRuntime.isLoading !== audioState.isLoading ||
          currentRuntime.isBuffering !== audioState.isBuffering
        ) {
          config.setRuntimeState(() => ({
            isPlaying: audioState.isPlaying,
            isLoading: audioState.isLoading,
            isBuffering: audioState.isBuffering,
          }));
        }

        if (
          audioState.error?.code === "STREAM_INTERRUPTED" &&
          currentDeck?.radio &&
          isYouTubeMetadata(currentDeck.radio.platformMetadata) &&
          currentDeck.radio.platformMetadata.videoId &&
          currentRuntime.soundId
        ) {
          handleYouTubeStreamInterrupted(
            currentRuntime.soundId,
            currentDeck.radio.platformMetadata.videoId,
            audioState.error.position ?? 0,
            dependencies
          ).catch((error) => {
            console.error(
              "[dj-actions] Failed to refresh interrupted stream:",
              error
            );
          });
          return;
        }

        if (audioState.error?.message) {
          dependencies.reportDjError(
            audioState.error.message,
            `DJ_${audioState.error.code}`,
            new Error(audioState.error.message),
            currentDeck?.radio
          );
        }

        if (trackEnded && currentDeck?.radio && currentRuntime.soundId) {
          handleTrackEnded(
            config,
            currentDeck,
            currentRuntime.soundId,
            () => {
              hasAppliedChannelStrip = false;
            },
            dependencies
          ).catch((error) => {
            console.error("[dj-actions] Failed to handle ended track:", error);
          });
        }
      });

    config.setSubscriptionCleanup(cleanup);

    if (wasPlaying) {
      await dependencies.getAudioManager().playSound(soundId, deck.volume);
      dependencies.applyCrossfade();
    }
  } catch (error) {
    await cleanupFailedDeckLoad(
      config,
      soundId,
      dependencies.getAudioManager()
    );
    const message =
      error instanceof Error ? error.message : `Failed to load ${deckId}`;
    dependencies.reportDjError(message, "DJ_LOAD_DECK_FAILED", error, radio);
  }
}
