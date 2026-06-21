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
  type FileAudioMetadata,
  revokeFileObjectUrl,
} from "@/lib/audio/file-metadata";
import { validatePlaybackStreamUrl } from "@/lib/audio/playback/url-validation";
import { getFilenameFromUrl } from "@/lib/audio/remote-url";
import {
  type DeckId,
  type DeckSide,
  deckConfig,
  getDeckRadio,
} from "@/lib/dj-actions-decks.js";
import { createDjDeckContinuationWorkflow } from "@/lib/dj-deck-continuation-workflow.js";
import type { PlatformStreamResolutionInput } from "@/lib/dj-platform-stream-port.js";
import { createPlatformRadio } from "@/lib/external-url/utils";
import {
  type DeckRecord,
  resetDeck as resetDeckDb,
} from "@/lib/hooks/use-dj-state";
import {
  type DeviceInputMetadata,
  isDeviceInputMetadata,
  isFileMetadata,
  isYouTubeMetadata,
  type Platform,
  type StaticAudioMetadata,
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
  radio?: Radio | null,
  channelId?: DeckId | null
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
  clearDjError: (deckId?: DeckId) => void;
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
  loadDeckSource: (
    deckId: DeckId,
    source: DeckSourceLoadIntent
  ) => Promise<DeckSourceLoadResult>;
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

const AUDIO_INPUT_PLATFORM_ID = -3;
const STATIC_AUDIO_PLATFORM_ID = -4;
const SEARCH_ALL_PLATFORM_ID = -6;
const RADIO_GARDEN_PLATFORM_ID = -7;
const BANDCAMP_PLATFORM_ID = -8;
const SOUNDCLOUD_PLATFORM_ID = -9;
const YOUTUBE_PLATFORM_ID = -10;

type DeckSourceLoadIntent =
  | { type: "device-input"; deviceId: string; deviceLabel: string }
  | { type: "file"; file: File }
  | { type: "ignored" }
  | { type: "pending-platform"; platform: Platform }
  | { type: "radio"; radio: Radio | null }
  | { type: "static-audio-url"; url: string }
  | { type: "track"; radio: Radio | null; autoPlay?: boolean }
  | {
      type: "track-url";
      radio: Radio;
      streamUrl: string;
      autoPlay?: boolean;
    };

type DeckSourceLoadResult =
  | { type: "ignored" }
  | { type: "loaded" }
  | { type: "pending-platform"; platform: Platform };

const activeDeckLoadTokens = new Map<DeckId, symbol>();
const activeDeckPlayTokens = new Map<DeckId, symbol>();
const activeDeckSourceLoadTokens = new Map<DeckId, symbol>();

function beginDeckSourceLoad(deckId: DeckId): symbol {
  const token = Symbol(deckId);
  activeDeckSourceLoadTokens.set(deckId, token);
  return token;
}

function isCurrentDeckSourceLoad(deckId: DeckId, token: symbol): boolean {
  return activeDeckSourceLoadTokens.get(deckId) === token;
}

function isPlatformPlaceholderItem(radio: Radio): boolean {
  return (
    radio.id === AUDIO_INPUT_PLATFORM_ID ||
    radio.id === STATIC_AUDIO_PLATFORM_ID ||
    radio.id === SEARCH_ALL_PLATFORM_ID ||
    radio.id === RADIO_GARDEN_PLATFORM_ID ||
    radio.id === BANDCAMP_PLATFORM_ID ||
    radio.id === SOUNDCLOUD_PLATFORM_ID ||
    radio.id === YOUTUBE_PLATFORM_ID
  );
}

function getPlatformFromPlaceholderItem(radio: Radio): Platform | null {
  if (radio.id === AUDIO_INPUT_PLATFORM_ID) {
    return "device-input";
  }
  if (radio.id === STATIC_AUDIO_PLATFORM_ID) {
    return "static-audio";
  }
  if (radio.id === RADIO_GARDEN_PLATFORM_ID) {
    return "radiogarden";
  }
  if (radio.id === SEARCH_ALL_PLATFORM_ID) {
    return "external";
  }
  if (radio.id === BANDCAMP_PLATFORM_ID) {
    return "bandcamp";
  }
  if (radio.id === SOUNDCLOUD_PLATFORM_ID) {
    return "soundcloud";
  }
  if (radio.id === YOUTUBE_PLATFORM_ID) {
    return "youtube";
  }
  return radio.platformMetadata?.platform || null;
}

function getDeckLibrarySourceIntent(radio: Radio): DeckSourceLoadIntent {
  if (!isPlatformPlaceholderItem(radio)) {
    return { type: "radio", radio };
  }

  const platform = getPlatformFromPlaceholderItem(radio);
  if (!platform) {
    return { type: "ignored" };
  }
  return { type: "pending-platform", platform };
}

function beginDeckLoad(deckId: DeckId): symbol {
  const token = Symbol(deckId);
  activeDeckSourceLoadTokens.delete(deckId);
  activeDeckLoadTokens.set(deckId, token);
  activeDeckPlayTokens.delete(deckId);
  return token;
}

function isCurrentDeckLoad(deckId: DeckId, token: symbol): boolean {
  return activeDeckLoadTokens.get(deckId) === token;
}

function beginDeckPlay(deckId: DeckId): symbol {
  const token = Symbol(deckId);
  activeDeckPlayTokens.set(deckId, token);
  return token;
}

function isCurrentDeckPlay(deckId: DeckId, token: symbol): boolean {
  return activeDeckPlayTokens.get(deckId) === token;
}

function cancelDeckPlay(deckId: DeckId): void {
  activeDeckPlayTokens.delete(deckId);
}

function isCurrentDeckPlayTarget(
  deckId: DeckId,
  token: symbol,
  soundId: string,
  radio: Radio,
  config: (typeof deckConfig)["deck-a"]
): boolean {
  const currentDeck = config.getDeck();
  const currentRadio = currentDeck ? getDeckRadio(currentDeck) : null;

  if (!(currentDeck && currentRadio && isCurrentDeckPlay(deckId, token))) {
    return false;
  }

  return (
    config.getRuntime().soundId === soundId &&
    currentRadio.id === radio.id &&
    currentRadio.streamUrl === radio.streamUrl
  );
}

function rollbackFailedDeckLoad(
  deckId: DeckId,
  config: (typeof deckConfig)["deck-a"],
  soundId: string,
  previousRadio: Radio | null,
  dependencies: DeckLoadDependencies,
  restorePreviousRadio: boolean
): boolean {
  const currentRuntime = config.getRuntime();
  if (currentRuntime.soundId !== soundId) {
    return false;
  }

  dependencies.deactivateChannel(deckId);
  if (restorePreviousRadio) {
    config.updateDeck((draft) => {
      draft.radio = previousRadio;
    });
  }
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

function createLocalFileRadio(
  side: DeckSide,
  metadata: FileAudioMetadata
): Radio {
  return {
    id: `local-file-${side}-${Date.now()}`,
    name: metadata.displayName,
    streamUrl: metadata.objectUrl,
    description: "Local File",
    enabled: true,
    platformMetadata: {
      platform: "local-file",
      itemType: "track",
      url: "",
      fileName: metadata.fileName,
      displayName: metadata.displayName,
      duration: metadata.duration,
      fileSize: metadata.fileSize,
      mimeType: metadata.mimeType,
      objectUrl: metadata.objectUrl,
    },
  };
}

function createStaticAudioRadio(url: string): Radio {
  const displayName = getFilenameFromUrl(url);
  const metadata: StaticAudioMetadata = {
    platform: "static-audio",
    itemType: "track",
    url,
    fileName: displayName,
    displayName,
    duration: 0,
    fileSize: 0,
    mimeType: "audio/mpeg",
    streamUrl: url,
    isLocal: false,
    requiresProxy: false,
  };
  return createPlatformRadio(url, metadata);
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
): boolean {
  const previousObjectUrl = getLocalFileObjectUrl(previousRadio);
  const nextObjectUrl = getLocalFileObjectUrl(nextRadio);
  if (!previousObjectUrl || previousObjectUrl === nextObjectUrl) {
    return false;
  }
  revokeFileObjectUrl(previousObjectUrl);
  return true;
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

  if (!isCurrentDeckLoad(deckId, loadToken)) {
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
  let previousRadioWasReleased = false;
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
              deckId,
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
            currentDeck?.radio,
            deckId
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
    previousRadioWasReleased = releaseReplacedLocalFileUrl(
      previousRadio,
      radio
    );
    if (!isCurrentDeckLoad(deckId, loadToken)) {
      return;
    }

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
      dependencies,
      !previousRadioWasReleased
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
      radio,
      deckId
    );
  }
}

async function resolveInitialYouTubeStreamUrl(
  deckId: DeckId,
  radio: Radio,
  videoId: string,
  dependencies: DeckLoadDependencies
): Promise<string | null> {
  try {
    const resolvedUrl = await dependencies.resolvePlatformStreamUrl({
      platform: "youtube",
      reason: "initial-load",
      videoId,
      radio,
    });
    if (!resolvedUrl) {
      dependencies.reportDjError(
        "Failed to resolve YouTube stream",
        "DJ_YOUTUBE_RESOLVE_FAILED",
        undefined,
        radio,
        deckId
      );
      return null;
    }

    if (
      isYouTubeMetadata(radio.platformMetadata) &&
      radio.platformMetadata.tracks
    ) {
      const track = radio.platformMetadata.tracks.find(
        (item) => "videoId" in item && item.videoId === videoId
      );
      if (track) {
        track.streamUrl = resolvedUrl;
      }
    }

    return resolvedUrl;
  } catch (error) {
    dependencies.reportDjError(
      "Failed to resolve YouTube stream",
      "DJ_YOUTUBE_RESOLVE_FAILED",
      error,
      radio,
      deckId
    );
    return null;
  }
}

async function resolveInitialTrackStreamUrl(
  deckId: DeckId,
  radio: Radio,
  streamUrl: string,
  dependencies: DeckLoadDependencies
): Promise<string | null> {
  if (!streamUrl.startsWith("yt:")) {
    return streamUrl;
  }
  return await resolveInitialYouTubeStreamUrl(
    deckId,
    radio,
    streamUrl.slice(3),
    dependencies
  );
}

async function loadDeckTrackRadio(
  deckId: DeckId,
  radio: Radio | null,
  autoPlay: boolean,
  dependencies: DeckLoadDependencies
): Promise<void> {
  const config = deckConfig[deckId];

  if (!radio) {
    await loadDeckRadio(deckId, null, dependencies);
    return;
  }

  const sourceLoadToken = beginDeckSourceLoad(deckId);
  const resolvedStreamUrl = await resolveInitialTrackStreamUrl(
    deckId,
    radio,
    radio.streamUrl,
    dependencies
  );
  if (
    !(resolvedStreamUrl && isCurrentDeckSourceLoad(deckId, sourceLoadToken))
  ) {
    return;
  }

  const streamValidation = validatePlaybackStreamUrl(resolvedStreamUrl);
  if (!streamValidation.ok) {
    dependencies.reportDjError(
      "Invalid stream URL",
      "DJ_INVALID_STREAM_URL",
      undefined,
      radio,
      deckId
    );
    return;
  }

  const normalizedRadio =
    streamValidation.normalizedUrl === radio.streamUrl
      ? radio
      : { ...radio, streamUrl: streamValidation.normalizedUrl };

  const runtime = config.getRuntime();
  if (runtime.isLoading) {
    return;
  }

  if (runtime.isPlaying) {
    pauseDeck(deckId, dependencies);
  }

  await loadDeckRadio(deckId, normalizedRadio, dependencies);

  if (autoPlay) {
    await playDeck(deckId, dependencies);
  }
}

async function loadDeckTrackUrl(
  deckId: DeckId,
  radio: Radio,
  streamUrl: string,
  autoPlay: boolean,
  dependencies: DeckLoadDependencies
): Promise<void> {
  const resolvedStreamUrl = await resolveInitialTrackStreamUrl(
    deckId,
    radio,
    streamUrl,
    dependencies
  );
  if (!resolvedStreamUrl) {
    return;
  }
  await loadDeckTrackRadio(
    deckId,
    { ...radio, streamUrl: resolvedStreamUrl },
    autoPlay,
    dependencies
  );
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

  const soundId = runtime.soundId;
  const radio = deck.radio;
  const playToken = beginDeckPlay(deckId);

  try {
    await dependencies.playDeckSound(soundId, deck.volume);
    if (!isCurrentDeckPlayTarget(deckId, playToken, soundId, radio, config)) {
      return;
    }

    dependencies.clearDjError(deckId);
    dependencies.applyCrossfade();
  } catch (error) {
    if (!isCurrentDeckPlay(deckId, playToken)) {
      return;
    }

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
      deck.radio,
      deckId
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
    cancelDeckPlay(deckId);
    dependencies.pauseDeckSound(runtime.soundId);
  }
}

async function loadDeckFile(
  deckId: DeckId,
  file: File,
  dependencies: DeckLoadDependencies
): Promise<void> {
  const side = deckConfig[deckId].side;
  let extractedObjectUrl: string | null = null;

  try {
    dependencies.clearDjError();
    const meta = await extractFileMetadata(file);
    extractedObjectUrl = meta.objectUrl;
    const radio = createLocalFileRadio(side, meta);

    await loadDeckRadio(deckId, radio, dependencies);

    const activeObjectUrl = getLocalFileObjectUrl(
      deckConfig[deckId].getDeck()?.radio ?? null
    );
    if (activeObjectUrl === extractedObjectUrl) {
      extractedObjectUrl = null;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load audio file";
    dependencies.reportDjError(
      message,
      "DJ_LOCAL_FILE_LOAD_FAILED",
      error,
      null,
      deckId
    );
  } finally {
    if (extractedObjectUrl) {
      revokeFileObjectUrl(extractedObjectUrl);
    }
  }
}

async function loadDeckSource(
  deckId: DeckId,
  source: DeckSourceLoadIntent,
  dependencies: DeckLoadDependencies
): Promise<DeckSourceLoadResult> {
  switch (source.type) {
    case "device-input":
      await loadDeckDeviceInput(
        deckId,
        source.deviceId,
        source.deviceLabel,
        dependencies
      );
      return { type: "loaded" };
    case "file":
      await loadDeckFile(deckId, source.file, dependencies);
      return { type: "loaded" };
    case "ignored":
      return { type: "ignored" };
    case "pending-platform":
      return { type: "pending-platform", platform: source.platform };
    case "radio":
      await loadDeckRadio(deckId, source.radio, dependencies);
      return { type: "loaded" };
    case "static-audio-url":
      await loadDeckTrackRadio(
        deckId,
        createStaticAudioRadio(source.url),
        false,
        dependencies
      );
      return { type: "loaded" };
    case "track":
      await loadDeckTrackRadio(
        deckId,
        source.radio,
        source.autoPlay ?? false,
        dependencies
      );
      return { type: "loaded" };
    case "track-url":
      await loadDeckTrackUrl(
        deckId,
        source.radio,
        source.streamUrl,
        source.autoPlay ?? false,
        dependencies
      );
      return { type: "loaded" };
    default:
      return { type: "ignored" };
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
    loadDeckSource: (deckId, source) =>
      loadDeckSource(deckId, source, dependencies),
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

export type {
  DeckLoadDependencies,
  DeckSourceLoadIntent,
  DeckSourceLoadResult,
  DjDeckLoadWorkflow,
};
export {
  AUDIO_INPUT_PLATFORM_ID,
  BANDCAMP_PLATFORM_ID,
  getDeckLibrarySourceIntent,
  getPlatformFromPlaceholderItem,
  isPlatformPlaceholderItem,
  RADIO_GARDEN_PLATFORM_ID,
  SEARCH_ALL_PLATFORM_ID,
  SOUNDCLOUD_PLATFORM_ID,
  STATIC_AUDIO_PLATFORM_ID,
  YOUTUBE_PLATFORM_ID,
};
