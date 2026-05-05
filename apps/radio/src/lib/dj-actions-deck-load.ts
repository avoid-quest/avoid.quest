import type {
  AudioManager,
  ChannelSelection,
  EffectConfig,
  EffectType,
  FilterConfig,
  Radio,
} from "@/lib/audio";
import {
  extractFileMetadata,
  revokeFileObjectUrl,
} from "@/lib/audio/file-metadata";
import {
  type DeckId,
  type DeckSide,
  deckConfig,
  getDeckRadio,
} from "@/lib/dj-actions-decks.js";
import { createDjDeckContinuationWorkflow } from "@/lib/dj-deck-continuation-workflow.js";
import type { PlatformStreamResolutionInput } from "@/lib/dj-platform-stream-port.js";
import {
  type DeckRecord,
  resetDeck as resetDeckDb,
} from "@/lib/hooks/use-dj-state";
import {
  type DeviceInputMetadata,
  isDeviceInputMetadata,
  isFileMetadata,
} from "@/lib/platform-types";
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
  getDeviceChannelCount: (soundId: string) => number | null;
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
  playDeviceSound: (soundId: string, deviceId: string) => Promise<void>;
  reportDjError: ReportDjError;
  reportPlaybackError?: (error: PlaybackActionError) => void;
  resolvePlatformStreamUrl: (
    input: PlatformStreamResolutionInput
  ) => Promise<string | null>;
  seekDeckSound: (soundId: string, position: number) => void;
  setDeviceChannelSelection: (
    soundId: string,
    selection: ChannelSelection
  ) => void;
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
  loadDeckDeviceInput: (
    deckId: DeckId,
    deviceId: string,
    deviceLabel: string
  ) => Promise<void>;
  loadDeckFile: (deckId: DeckId, file: File) => Promise<void>;
  loadDeckRadio: (deckId: DeckId, radio: Radio | null) => Promise<void>;
  pauseDeck: (deckId: DeckId) => void;
  playDeck: (deckId: DeckId) => Promise<void>;
  removeDeckEffect: (deckId: DeckId, effectId: string) => void;
  resetDeck: (deckId: DeckId) => Promise<void>;
  reorderDeckEffects: (deckId: DeckId, effectIds: string[]) => void;
  seekDeck: (deckId: DeckId, position: number) => void;
  setDeckDeviceChannelSelection: (
    deckId: DeckId,
    selection: ChannelSelection
  ) => void;
  setDeckChannelFilter: (deckId: DeckId, value: number) => void;
  setDeckEffectsDryWet: (deckId: DeckId, value: number) => void;
  setDeckMute: (deckId: DeckId, muted: boolean) => void;
  setDeckPan: (deckId: DeckId, pan: number) => void;
  setDeckAutoplay: (deckId: DeckId, enabled: boolean) => void;
  setDeckRepeat: (deckId: DeckId, enabled: boolean) => void;
  setDeckSpeed: (deckId: DeckId, speed: number) => void;
  setDeckVolume: (deckId: DeckId, volume: number) => void;
  updateDeckEffect: (
    deckId: DeckId,
    effectId: string,
    effectConfig: Partial<EffectConfig>
  ) => void;
  updateDeckFilter: (deckId: DeckId, filter: FilterConfig) => void;
};

const activeDeckLoadTokens = new Map<DeckId, symbol>();

function beginDeckLoad(deckId: DeckId): symbol {
  const token = Symbol(deckId);
  activeDeckLoadTokens.set(deckId, token);
  return token;
}

function isCurrentDeckLoad(deckId: DeckId, token: symbol): boolean {
  return activeDeckLoadTokens.get(deckId) === token;
}

function rollbackFailedDeckLoad(
  deckId: DeckId,
  config: (typeof deckConfig)["deck-a"],
  soundId: string,
  previousRadio: Radio | null,
  dependencies: DeckLoadDependencies
): boolean {
  const currentRuntime = config.getRuntime();
  if (currentRuntime.soundId !== soundId) {
    return false;
  }

  dependencies.deactivateChannel(deckId);
  config.updateDeck((draft) => {
    draft.radio = previousRadio;
  });
  return true;
}

function createDeviceInputRadio(
  side: DeckSide,
  deviceId: string,
  deviceLabel: string
): Radio {
  const radioId = `device-input-${side}`;
  const platformMetadata: DeviceInputMetadata = {
    platform: "device-input",
    itemType: "track",
    url: "",
    deviceId,
    deviceLabel,
    channelSelection: { left: 0, right: 1 },
    channelCount: 2,
  };

  return {
    id: radioId,
    name: deviceLabel,
    streamUrl: "",
    description: "Device input (mic/line-in)",
    enabled: true,
    platformMetadata,
  };
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

function shouldWarnRoutingRestoreFailure(error: unknown): boolean {
  return !(
    error instanceof ReferenceError &&
    error.message.includes("AudioContext is not defined")
  );
}

function warnRoutingRestoreFailure(message: string, error: unknown): void {
  if (shouldWarnRoutingRestoreFailure(error)) {
    console.warn(message, error);
  }
}

function connectDeckCueRouting(
  deckId: DeckId,
  soundId: string,
  dependencies: DeckLoadDependencies
): boolean {
  try {
    dependencies.connectDeckCueBus(
      deckId,
      soundId,
      dependencies.getAudioManager
    );
    return true;
  } catch (error) {
    warnRoutingRestoreFailure(
      "[dj-actions] Failed to connect cue routing:",
      error
    );
    return false;
  }
}

function connectReadyDeckCueRouting(
  deckId: DeckId,
  soundId: string,
  dependencies: DeckLoadDependencies
): boolean {
  if (!dependencies.getAudioManager().getPreFaderNode(soundId)) {
    return false;
  }

  return connectDeckCueRouting(deckId, soundId, dependencies);
}

function initializeSavedAudioDevices(dependencies: DeckLoadDependencies): void {
  try {
    const initialization = dependencies.initializeAudioDevices(
      dependencies.getAudioManager,
      dependencies.reportDjError
    );
    initialization.catch((error) => {
      warnRoutingRestoreFailure(
        "[dj-actions] Failed to initialize audio devices:",
        error
      );
    });
  } catch (error) {
    warnRoutingRestoreFailure(
      "[dj-actions] Failed to initialize audio devices:",
      error
    );
  }
}

function restoreDeckRouting(
  deckId: DeckId,
  soundId: string,
  dependencies: DeckLoadDependencies
): void {
  connectDeckCueRouting(deckId, soundId, dependencies);
  initializeSavedAudioDevices(dependencies);
}

async function activateLoadedSource(
  deckId: DeckId,
  loadToken: symbol,
  radio: Radio,
  soundId: string,
  config: (typeof deckConfig)["deck-a"],
  dependencies: DeckLoadDependencies
): Promise<{ startedPlayback: boolean }> {
  const metadata = radio.platformMetadata;
  if (!isDeviceInputMetadata(metadata)) {
    return { startedPlayback: false };
  }

  await dependencies.playDeviceSound(soundId, metadata.deviceId);

  if (!isCurrentDeckLoad(deckId, loadToken)) {
    return { startedPlayback: true };
  }

  dependencies.setDeviceChannelSelection(soundId, metadata.channelSelection);

  const channelCount = dependencies.getDeviceChannelCount(soundId);
  if (channelCount === null) {
    return { startedPlayback: true };
  }

  config.updateDeck((draft) => {
    const currentMetadata = draft.radio?.platformMetadata;
    if (isDeviceInputMetadata(currentMetadata)) {
      currentMetadata.channelCount = channelCount;
    }
  });

  return { startedPlayback: true };
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
  const loadToken = beginDeckLoad(deckId);

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
    let hasConnectedReadyCueRouting = false;
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
        }
        if (
          audioState.isPlaying &&
          !audioState.isLoading &&
          !hasConnectedReadyCueRouting &&
          currentDeck
        ) {
          hasConnectedReadyCueRouting = connectReadyDeckCueRouting(
            deckId,
            soundId,
            dependencies
          );
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
          currentRuntime.soundId
        ) {
          continuationWorkflow
            .handleStreamInterrupted({
              currentRadio: currentDeck.radio,
              position: audioState.error.position ?? 0,
              soundId: currentRuntime.soundId,
            })
            .then((result) => {
              if (
                result === "refreshed" &&
                config.getRuntime().soundId === currentRuntime.soundId
              ) {
                config.setRuntimeState(() => ({ error: null }));
              }
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
    restoreDeckRouting(deckId, soundId, dependencies);
    const sourceActivation = await activateLoadedSource(
      deckId,
      loadToken,
      radio,
      soundId,
      config,
      dependencies
    );
    if (!isCurrentDeckLoad(deckId, loadToken)) {
      return;
    }
    releaseReplacedLocalFileUrl(previousRadio, radio);

    if (wasPlaying) {
      await dependencies.playDeckSound(soundId, deck.volume);
      if (!isCurrentDeckLoad(deckId, loadToken)) {
        return;
      }
      dependencies.applyCrossfade();
    } else if (sourceActivation.startedPlayback) {
      dependencies.applyCrossfade();
    }
  } catch (error) {
    if (!isCurrentDeckLoad(deckId, loadToken)) {
      return;
    }
    rollbackFailedDeckLoad(
      deckId,
      config,
      soundId,
      previousRadio,
      dependencies
    );
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

async function loadDeckDeviceInput(
  deckId: DeckId,
  deviceId: string,
  deviceLabel: string,
  dependencies: DeckLoadDependencies
): Promise<void> {
  const side = deckConfig[deckId].side;
  await loadDeckRadio(
    deckId,
    createDeviceInputRadio(side, deviceId, deviceLabel),
    dependencies
  );
}

function pauseDeck(deckId: DeckId, dependencies: DeckLoadDependencies): void {
  const runtime = deckConfig[deckId].getRuntime();
  if (runtime.soundId) {
    dependencies.pauseDeckSound(runtime.soundId);
  }
}

async function loadDeckFile(
  deckId: DeckId,
  file: File,
  dependencies: DeckLoadDependencies
): Promise<void> {
  const side = deckConfig[deckId].side;

  try {
    dependencies.clearDjError();
    const meta = await extractFileMetadata(file);

    await loadDeckRadio(
      deckId,
      {
        id: `local-file-${side}-${Date.now()}`,
        name: meta.displayName,
        streamUrl: meta.objectUrl,
        description: "Local File",
        enabled: true,
        platformMetadata: {
          platform: "local-file",
          itemType: "track",
          url: "",
          fileName: meta.fileName,
          displayName: meta.displayName,
          duration: meta.duration,
          fileSize: meta.fileSize,
          mimeType: meta.mimeType,
          objectUrl: meta.objectUrl,
        },
      },
      dependencies
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load audio file";
    dependencies.reportDjError(message, "DJ_LOCAL_FILE_LOAD_FAILED", error);
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

function setDeckDeviceChannelSelection(
  deckId: DeckId,
  selection: ChannelSelection,
  dependencies: DeckLoadDependencies
): void {
  const config = deckConfig[deckId];
  const deck = config.getDeck();
  const metadata = deck ? getDeckRadio(deck)?.platformMetadata : undefined;
  if (!isDeviceInputMetadata(metadata)) {
    return;
  }

  const runtime = config.getRuntime();
  if (runtime.soundId) {
    dependencies.setDeviceChannelSelection(runtime.soundId, selection);
  }

  config.updateDeck((draft) => {
    const meta = draft.radio?.platformMetadata;
    if (isDeviceInputMetadata(meta)) {
      meta.channelSelection = selection;
    }
  });
}

function setDeckVolume(
  deckId: DeckId,
  volume: number,
  dependencies: DeckLoadDependencies
): void {
  dependencies.setDeckVolume(deckId, volume);
  dependencies.applyCrossfade();
}

function setDeckRepeat(deckId: DeckId, enabled: boolean): void {
  deckConfig[deckId].updateDeck((draft) => {
    draft.repeat = enabled;
  });
}

function setDeckAutoplay(deckId: DeckId, enabled: boolean): void {
  deckConfig[deckId].updateDeck((draft) => {
    draft.autoplay = enabled;
  });
}

export function createDjDeckLoadWorkflow(
  dependencies: DeckLoadDependencies
): DjDeckLoadWorkflow {
  return {
    addDeckEffect: (deckId, type) =>
      dependencies.addDeckEffect(deckId, type, dependencies.createEffectId()),
    loadDeckDeviceInput: (deckId, deviceId, deviceLabel) =>
      loadDeckDeviceInput(deckId, deviceId, deviceLabel, dependencies),
    loadDeckFile: (deckId, file) => loadDeckFile(deckId, file, dependencies),
    loadDeckRadio: (deckId, radio) =>
      loadDeckRadio(deckId, radio, dependencies),
    pauseDeck: (deckId) => pauseDeck(deckId, dependencies),
    playDeck: (deckId) => playDeck(deckId, dependencies),
    removeDeckEffect: dependencies.removeDeckEffect,
    resetDeck: (deckId) => resetDeck(deckId, dependencies),
    reorderDeckEffects: dependencies.reorderDeckEffects,
    seekDeck: (deckId, position) => seekDeck(deckId, position, dependencies),
    setDeckDeviceChannelSelection: (deckId, selection) =>
      setDeckDeviceChannelSelection(deckId, selection, dependencies),
    setDeckChannelFilter: dependencies.setDeckChannelFilter,
    setDeckEffectsDryWet: dependencies.setDeckEffectsDryWet,
    setDeckMute: dependencies.setDeckMute,
    setDeckPan: dependencies.setDeckPan,
    setDeckAutoplay,
    setDeckRepeat,
    setDeckSpeed: dependencies.setDeckSpeed,
    setDeckVolume: (deckId, volume) =>
      setDeckVolume(deckId, volume, dependencies),
    updateDeckEffect: dependencies.updateDeckEffect,
    updateDeckFilter: dependencies.updateDeckFilter,
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
