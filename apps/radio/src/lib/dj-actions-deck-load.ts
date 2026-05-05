import type { AudioManager, Radio } from "@/lib/audio";
import { revokeFileObjectUrl } from "@/lib/audio/file-metadata";
import {
  type DeckId,
  type DeckSide,
  deckConfig,
  getDeckRadio,
} from "@/lib/dj-actions-decks.js";
import {
  createDjDeckContinuationWorkflow,
  type PlatformStreamResolutionInput,
} from "@/lib/dj-deck-continuation-workflow.js";
import {
  type DeckRecord,
  resetDeck as resetDeckDb,
} from "@/lib/hooks/use-dj-state";
import { isFileMetadata, isYouTubeMetadata } from "@/lib/platform-types";
import type { PlaybackActionChannelFacade } from "./playback-action-context.js";
import {
  createPlaybackActionError,
  type PlaybackActionError,
} from "./playback-action-errors.js";

type ReportDjError = (
  message: string,
  code: string,
  error?: unknown,
  radio?: Radio | null
) => void;

type DeckLoadDependencies = {
  activateChannel: PlaybackActionChannelFacade["activate"];
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
  deactivateChannel: PlaybackActionChannelFacade["deactivate"];
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
  reportPlaybackError?: (error: PlaybackActionError) => void;
  resolvePlatformStreamUrl: (
    input: PlatformStreamResolutionInput
  ) => Promise<string | null>;
};

type DjDeckLoadWorkflow = {
  loadDeckRadio: (deckId: DeckId, radio: Radio | null) => Promise<void>;
  resetDeck: (deckId: DeckId) => Promise<void>;
};

function cleanupFailedDeckLoad(
  deckId: DeckId,
  config: (typeof deckConfig)["deck-a"],
  soundId: string,
  dependencies: DeckLoadDependencies
): boolean {
  const currentRuntime = config.getRuntime();
  if (currentRuntime.soundId !== soundId) {
    return false;
  }

  dependencies.deactivateChannel(deckId);
  return true;
}

function getLocalFileObjectUrl(radio: Radio | null): string | null {
  const metadata = radio?.platformMetadata;
  if (!isFileMetadata(metadata)) {
    return null;
  }
  return metadata.objectUrl;
}

function releaseReplacedLocalFileUrl(
  previousRadio: Radio | null,
  nextRadio: Radio | null
): void {
  const previousObjectUrl = getLocalFileObjectUrl(previousRadio);
  const nextObjectUrl = getLocalFileObjectUrl(nextRadio);
  if (!previousObjectUrl || previousObjectUrl === nextObjectUrl) {
    return;
  }
  revokeFileObjectUrl(previousObjectUrl);
}

async function loadDeckRadio(
  deckId: DeckId,
  radio: Radio | null,
  dependencies: DeckLoadDependencies
): Promise<void> {
  const config = deckConfig[deckId];
  const deck = config.getDeck();
  const runtime = config.getRuntime();
  const continuationWorkflow = createDjDeckContinuationWorkflow(dependencies);

  if (!deck) {
    return;
  }

  const wasPlaying = runtime.isPlaying;
  const previousRadio = getDeckRadio(deck);

  dependencies.deactivateChannel(deckId);

  if (!radio) {
    resetDeckDb(deckId);
    releaseReplacedLocalFileUrl(previousRadio, null);
    return;
  }

  const soundId = dependencies.getSoundId(radio, config.side);

  try {
    dependencies.clearDjError();

    let hasAppliedChannelStrip = false;
    dependencies.activateChannel("dj", deckId, radio, {
      persistRadio: true,
      soundId,
      onAudioState: (audioState) => {
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
          continuationWorkflow
            .handleStreamInterrupted({
              currentRadio: currentDeck.radio,
              position: audioState.error.position ?? 0,
              soundId: currentRuntime.soundId,
            })
            .catch((error) => {
              console.error(
                "[dj-actions] Failed to refresh interrupted stream:",
                error
              );
            });
          return;
        }

        if (audioState.error?.message) {
          const playbackError = createPlaybackActionError({
            mode: "dj",
            code: audioState.error.code,
            cause: new Error(audioState.error.message),
            channelId: deckId,
            radio: currentDeck?.radio ?? undefined,
            fallbackMessage: audioState.error.message,
          });
          dependencies.reportPlaybackError?.(playbackError);
          dependencies.reportDjError(
            playbackError.userMessage,
            `DJ_${audioState.error.code}`,
            playbackError.cause,
            currentDeck?.radio
          );
        }

        if (trackEnded && currentDeck?.radio && currentRuntime.soundId) {
          continuationWorkflow
            .handleTrackEnded({
              deckId,
              deckSide: config.side,
              currentDeck,
              soundId: currentRuntime.soundId,
              resetChannelStripFlag: () => {
                hasAppliedChannelStrip = false;
              },
            })
            .catch((error) => {
              console.error(
                "[dj-actions] Failed to handle ended track:",
                error
              );
            });
        }
      },
    });
    releaseReplacedLocalFileUrl(previousRadio, radio);

    if (wasPlaying) {
      await dependencies.getAudioManager().playSound(soundId, deck.volume);
      dependencies.applyCrossfade();
    }
  } catch (error) {
    const channelWasActivated = cleanupFailedDeckLoad(
      deckId,
      config,
      soundId,
      dependencies
    );
    if (!channelWasActivated) {
      config.updateDeck((draft) => {
        draft.radio = previousRadio;
      });
    }
    const playbackError = createPlaybackActionError({
      mode: "dj",
      code: "PLAY_ERROR",
      cause: error,
      channelId: deckId,
      radio: radio ?? undefined,
      fallbackMessage: `Failed to load ${deckId}`,
    });
    dependencies.reportPlaybackError?.(playbackError);
    dependencies.reportDjError(
      playbackError.userMessage,
      "DJ_LOAD_DECK_FAILED",
      error,
      radio
    );
  }
}

async function resetDeck(
  deckId: DeckId,
  dependencies: DeckLoadDependencies
): Promise<void> {
  const config = deckConfig[deckId];
  const deck = config.getDeck();
  if (!deck?.radio) {
    return;
  }

  config.updateDeck((draft) => {
    draft.volume = 1;
    draft.muted = false;
    draft.pan = 0;
    draft.speed = 1.0;
    draft.channelFilter = 0;
    draft.effectsDryWet = 1.0;
    draft.effects = [];
    draft.filter = {
      type: "lowpass",
      frequency: 1000,
      Q: 1,
      gain: 0,
      enabled: false,
    };
  });

  await loadDeckRadio(deckId, getDeckRadio(deck), dependencies);
}

export function createDjDeckLoadWorkflow(
  dependencies: DeckLoadDependencies
): DjDeckLoadWorkflow {
  return {
    loadDeckRadio: (deckId, radio) =>
      loadDeckRadio(deckId, radio, dependencies),
    resetDeck: (deckId) => resetDeck(deckId, dependencies),
  };
}

export async function setDeckRadioSource(
  deckId: DeckId,
  radio: Radio | null,
  dependencies: DeckLoadDependencies
): Promise<void> {
  await loadDeckRadio(deckId, radio, dependencies);
}

export type { DeckLoadDependencies, DjDeckLoadWorkflow };
