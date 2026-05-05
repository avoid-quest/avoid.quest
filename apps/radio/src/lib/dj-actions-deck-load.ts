import type {
  AudioManager,
  EffectConfig,
  EffectType,
  FilterConfig,
  Radio,
} from "@/lib/audio";
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
  pauseDeckSound: (soundId: string) => void;
  playDeckSound: (soundId: string, volume: number) => Promise<void>;
  reportDjError: ReportDjError;
  reportPlaybackError?: (error: PlaybackActionError) => void;
  resolvePlatformStreamUrl: (
    input: PlatformStreamResolutionInput
  ) => Promise<string | null>;
  seekDeckSound: (soundId: string, position: number) => void;
  addDeckEffect: (deckId: DeckId, type: EffectType, effectId: string) => void;
  createEffectId: () => string;
  removeDeckEffect: (deckId: DeckId, effectId: string) => void;
  reorderDeckEffects: (deckId: DeckId, effectIds: string[]) => void;
  setDeckChannelFilter: (deckId: DeckId, value: number) => void;
  setDeckEffectsDryWet: (deckId: DeckId, value: number) => void;
  setDeckMute: (deckId: DeckId, muted: boolean) => void;
  setDeckPan: (deckId: DeckId, pan: number) => void;
  setDeckSpeed: (deckId: DeckId, speed: number) => void;
  setDeckVolume: (deckId: DeckId, volume: number) => void;
  updateDeckEffect: (
    deckId: DeckId,
    effectId: string,
    effectConfig: Partial<EffectConfig>
  ) => void;
  updateDeckFilter: (deckId: DeckId, filter: FilterConfig) => void;
};

type DjDeckLoadWorkflow = {
  addDeckEffect: (deckId: DeckId, type: EffectType) => void;
  loadDeckRadio: (deckId: DeckId, radio: Radio | null) => Promise<void>;
  pauseDeck: (deckId: DeckId) => void;
  playDeck: (deckId: DeckId) => Promise<void>;
  removeDeckEffect: (deckId: DeckId, effectId: string) => void;
  resetDeck: (deckId: DeckId) => Promise<void>;
  reorderDeckEffects: (deckId: DeckId, effectIds: string[]) => void;
  seekDeck: (deckId: DeckId, position: number) => void;
  setDeckChannelFilter: (deckId: DeckId, value: number) => void;
  setDeckEffectsDryWet: (deckId: DeckId, value: number) => void;
  setDeckMute: (deckId: DeckId, muted: boolean) => void;
  setDeckPan: (deckId: DeckId, pan: number) => void;
  setDeckSpeed: (deckId: DeckId, speed: number) => void;
  setDeckVolume: (deckId: DeckId, volume: number) => void;
  updateDeckEffect: (
    deckId: DeckId,
    effectId: string,
    effectConfig: Partial<EffectConfig>
  ) => void;
  updateDeckFilter: (deckId: DeckId, filter: FilterConfig) => void;
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
      await dependencies.playDeckSound(soundId, deck.volume);
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

async function playDeck(
  deckId: DeckId,
  dependencies: DeckLoadDependencies
): Promise<void> {
  const config = deckConfig[deckId];
  const deck = config.getDeck();
  const runtime = config.getRuntime();

  if (!(runtime.soundId && deck?.radio) || runtime.isPlaying) {
    return;
  }

  try {
    await dependencies.playDeckSound(runtime.soundId, deck.volume);
    dependencies.applyCrossfade();
  } catch (error) {
    const playbackError = createPlaybackActionError({
      mode: "dj",
      code: "PLAY_ERROR",
      cause: error,
      channelId: deckId,
      radio: deck.radio,
      fallbackMessage: `Failed to play ${deckId}`,
    });
    dependencies.reportPlaybackError?.(playbackError);
    dependencies.reportDjError(
      playbackError.userMessage,
      "DJ_PLAY_DECK_FAILED",
      error,
      deck.radio
    );
  }
}

function pauseDeck(deckId: DeckId, dependencies: DeckLoadDependencies): void {
  const runtime = deckConfig[deckId].getRuntime();
  if (runtime.soundId) {
    dependencies.pauseDeckSound(runtime.soundId);
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

function seekDeck(
  deckId: DeckId,
  position: number,
  dependencies: DeckLoadDependencies
): void {
  const runtime = deckConfig[deckId].getRuntime();
  if (runtime.soundId) {
    dependencies.seekDeckSound(runtime.soundId, position);
  }
}

function setDeckVolume(
  deckId: DeckId,
  volume: number,
  dependencies: DeckLoadDependencies
): void {
  dependencies.setDeckVolume(deckId, volume);
  dependencies.applyCrossfade();
}

function setDeckMute(
  deckId: DeckId,
  muted: boolean,
  dependencies: DeckLoadDependencies
): void {
  dependencies.setDeckMute(deckId, muted);
}

function setDeckPan(
  deckId: DeckId,
  pan: number,
  dependencies: DeckLoadDependencies
): void {
  dependencies.setDeckPan(deckId, pan);
}

function setDeckSpeed(
  deckId: DeckId,
  speed: number,
  dependencies: DeckLoadDependencies
): void {
  dependencies.setDeckSpeed(deckId, speed);
}

function setDeckChannelFilter(
  deckId: DeckId,
  value: number,
  dependencies: DeckLoadDependencies
): void {
  dependencies.setDeckChannelFilter(deckId, value);
}

function setDeckEffectsDryWet(
  deckId: DeckId,
  value: number,
  dependencies: DeckLoadDependencies
): void {
  dependencies.setDeckEffectsDryWet(deckId, value);
}

function updateDeckFilter(
  deckId: DeckId,
  filter: FilterConfig,
  dependencies: DeckLoadDependencies
): void {
  dependencies.updateDeckFilter(deckId, filter);
}

function addDeckEffect(
  deckId: DeckId,
  type: EffectType,
  dependencies: DeckLoadDependencies
): void {
  dependencies.addDeckEffect(deckId, type, dependencies.createEffectId());
}

function updateDeckEffect(
  deckId: DeckId,
  effectId: string,
  effectConfig: Partial<EffectConfig>,
  dependencies: DeckLoadDependencies
): void {
  dependencies.updateDeckEffect(deckId, effectId, effectConfig);
}

function removeDeckEffect(
  deckId: DeckId,
  effectId: string,
  dependencies: DeckLoadDependencies
): void {
  dependencies.removeDeckEffect(deckId, effectId);
}

function reorderDeckEffects(
  deckId: DeckId,
  effectIds: string[],
  dependencies: DeckLoadDependencies
): void {
  dependencies.reorderDeckEffects(deckId, effectIds);
}

export function createDjDeckLoadWorkflow(
  dependencies: DeckLoadDependencies
): DjDeckLoadWorkflow {
  return {
    addDeckEffect: (deckId, type) => addDeckEffect(deckId, type, dependencies),
    loadDeckRadio: (deckId, radio) =>
      loadDeckRadio(deckId, radio, dependencies),
    pauseDeck: (deckId) => pauseDeck(deckId, dependencies),
    playDeck: (deckId) => playDeck(deckId, dependencies),
    removeDeckEffect: (deckId, effectId) =>
      removeDeckEffect(deckId, effectId, dependencies),
    resetDeck: (deckId) => resetDeck(deckId, dependencies),
    reorderDeckEffects: (deckId, effectIds) =>
      reorderDeckEffects(deckId, effectIds, dependencies),
    seekDeck: (deckId, position) => seekDeck(deckId, position, dependencies),
    setDeckChannelFilter: (deckId, value) =>
      setDeckChannelFilter(deckId, value, dependencies),
    setDeckEffectsDryWet: (deckId, value) =>
      setDeckEffectsDryWet(deckId, value, dependencies),
    setDeckMute: (deckId, muted) => setDeckMute(deckId, muted, dependencies),
    setDeckPan: (deckId, pan) => setDeckPan(deckId, pan, dependencies),
    setDeckSpeed: (deckId, speed) => setDeckSpeed(deckId, speed, dependencies),
    setDeckVolume: (deckId, volume) =>
      setDeckVolume(deckId, volume, dependencies),
    updateDeckEffect: (deckId, effectId, effectConfig) =>
      updateDeckEffect(deckId, effectId, effectConfig, dependencies),
    updateDeckFilter: (deckId, filter) =>
      updateDeckFilter(deckId, filter, dependencies),
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
