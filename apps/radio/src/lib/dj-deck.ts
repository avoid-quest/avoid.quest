import type {
  AudioErrorCode,
  AudioState,
  ChannelSelection,
  EffectConfig,
  EffectType,
  FilterConfig,
  Radio,
} from "@/lib/audio";
import { createDefaultEffectConfig } from "@/lib/audio";
import type { FileAudioMetadata } from "@/lib/audio/file-metadata";
import {
  extractFileMetadata,
  revokeFileObjectUrl,
} from "@/lib/audio/file-metadata";
import {
  inferStreamFormat,
  type StreamFormat,
} from "@/lib/audio/playback/stream-format";
import { validatePlaybackStreamUrl } from "@/lib/audio/playback/url-validation";
import {
  type ChannelEffects,
  type ChannelEffectsChange,
  channelEffects,
} from "@/lib/channel-effects.js";
import {
  getPlaybackChannel,
  type PlaybackChannelRecord,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { getAudioSettings } from "@/lib/collections/settings";
import {
  clearDjErrorSurface,
  reportDjErrorSurface,
} from "@/lib/dj/dj-error-surface";
import { findNextTrack } from "@/lib/dj-actions-playlist.js";
import { calculateDjCrossfadeVolumes } from "@/lib/dj-crossfade.js";
import type {
  DeckSourceLoadIntent,
  DeckSourceLoadResult,
} from "@/lib/dj-library-sources.js";
import { getDeckLibrarySourceIntent } from "@/lib/dj-library-sources.js";
import {
  type PlatformStreamResolution,
  type PlatformStreamResolutionInput,
  resolveDjPlatformStreamUrl,
} from "@/lib/dj-platform-stream-port.js";
import { getMixer } from "@/lib/hooks/use-dj-state";
import { getOutputRouting, type OutputRouting } from "@/lib/output-routing.js";
import { loadPlatformItem } from "@/lib/platform-item-loader";
import type { Platform } from "@/lib/platform-types";
import {
  isDeviceInputMetadata,
  isFileMetadata,
  isRadioBrowserMetadata,
  isYouTubeMetadata,
} from "@/lib/platform-types";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "@/lib/playback-action-context";
import {
  createPlaybackActionError,
  toRuntimeAudioError,
} from "@/lib/playback-action-errors.js";
import {
  getPlaybackChannelRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelPeakLevel,
  setPlaybackChannelRuntime,
  setPlaybackChannelSoundId,
} from "@/lib/stores/playback-runtime-store";
import { generateId } from "@/lib/types";

export type DeckId = "deck-a" | "deck-b";
export type DeckSide = "left" | "right";

export type DjDeckLoadIntent =
  | DeckSourceLoadIntent
  | { type: "library"; radio: Radio };

export type DjDeckLoadResult =
  | DeckSourceLoadResult
  | { type: "pending-platform"; platform: Platform };

export type DjDeckTransportIntent =
  | { type: "pause" }
  | { type: "play" }
  | { type: "reset" }
  | { type: "seek"; position: number }
  | { type: "toggle" };

export type DjDeckChange =
  | { type: "autoplay"; enabled: boolean }
  | { type: "channel-filter"; value: number }
  | { type: "cue"; enabled?: boolean }
  | { type: "device-channel-selection"; selection: ChannelSelection }
  | { type: "effect"; change: ChannelEffectsChange }
  | { type: "effects-dry-wet"; value: number }
  | { type: "filter"; filter: FilterConfig }
  | { type: "mute"; muted: boolean }
  | { type: "pan"; pan: number }
  | { type: "repeat"; enabled: boolean }
  | { type: "speed"; speed: number }
  | { type: "volume"; volume: number };

export type DjDeckAudioChange =
  | { type: "channel-filter"; value: number }
  | { type: "filter"; filter: FilterConfig }
  | { type: "mute"; muted: boolean }
  | { type: "pan"; pan: number }
  | { type: "speed"; speed: number }
  | { type: "volume"; volume: number };

export type DjDeckAudioAdapter = {
  activate(input: {
    deckId: DeckId;
    onMeter: (level: { left: number; right: number }) => void;
    onState: (state: AudioState) => void;
    radio: Radio;
    soundId: string;
  }): () => void;
  applyStrip(soundId: string, channel: PlaybackChannelRecord): void;
  change(soundId: string, change: DjDeckAudioChange): void;
  getCueTap(soundId: string): AudioNode | null;
  getDeviceChannelCount(soundId: string): number | null;
  loadFile(file: File): Promise<FileAudioMetadata>;
  refresh(
    soundId: string,
    streamUrl: string,
    position: number,
    streamFormat: StreamFormat
  ): Promise<void>;
  releaseFileUrl(url: string): void;
  resume(): Promise<void>;
  setDeviceChannelSelection(soundId: string, selection: ChannelSelection): void;
  startDevice(soundId: string, deviceId: string): Promise<void>;
  transport(
    soundId: string,
    intent:
      | { type: "pause" }
      | { type: "play"; volume: number }
      | { type: "seek"; position: number }
  ): Promise<void>;
};

export type DjDeckPlatformAdapter = {
  loadItem(url: string): ReturnType<typeof loadPlatformItem>;
  resolveStream(
    input: PlatformStreamResolutionInput
  ): Promise<PlatformStreamResolution | null>;
};

export type DjDeckHandle = {
  load(intent: DjDeckLoadIntent): Promise<DjDeckLoadResult>;
  transport(intent: DjDeckTransportIntent): Promise<void>;
  change(change: DjDeckChange): void;
};

export type DjDeckPendingSource = {
  deckId: DeckId;
  platform: Platform;
} | null;

export type DjDeckModule = {
  deck(deckId: DeckId): DjDeckHandle;
  deactivate(): void;
  pendingSource: {
    cancel(): void;
    getSnapshot(): DjDeckPendingSource;
    subscribe(listener: () => void): () => void;
  };
};

type DjDeckModuleOptions = {
  audio: DjDeckAudioAdapter;
  context: PlaybackActionContext;
  effects: ChannelEffects;
  output: OutputRouting;
  platform: DjDeckPlatformAdapter;
};

type DeckRuntime = {
  bindingCleanup: (() => void) | null;
  cueRegistration: ReturnType<OutputRouting["registerCueDeck"]> | null;
  generation: number;
  loadGeneration: number;
  playGeneration: number;
  stripRestored: boolean;
};

const sideForDeck = (deckId: DeckId): DeckSide =>
  deckId === "deck-a" ? "left" : "right";

function assertNever(value: never): never {
  throw new Error(`Unhandled DJ Deck operation: ${String(value)}`);
}

const soundIdFor = (deckId: DeckId, radio: Radio, generation: number): string =>
  `${sideForDeck(deckId)}_${radio.id}:${generation}`;

const effectsRef = (deckId: DeckId) => ({
  sessionId: "dj" as const,
  channelId: deckId,
});

function getLocalFileUrl(radio: Radio | null): string | null {
  const metadata = radio?.platformMetadata;
  return isFileMetadata(metadata) ? metadata.objectUrl : null;
}

function createLocalFileRadio(
  deckId: DeckId,
  metadata: FileAudioMetadata
): Radio {
  return {
    id: `local-file-${sideForDeck(deckId)}-${Date.now()}`,
    name: metadata.displayName,
    streamUrl: metadata.objectUrl,
    description: "Local File",
    enabled: true,
    platformMetadata: {
      platform: "local-file",
      itemType: "track",
      url: "",
      ...metadata,
    },
  };
}

function getTrackFormat(radio: Radio, streamUrl: string): StreamFormat {
  const metadata = radio.platformMetadata;
  if (metadata && "tracks" in metadata && metadata.tracks) {
    const track = metadata.tracks.find((item) => item.streamUrl === streamUrl);
    if (track && "format" in track && track.format) {
      return track.format;
    }
  }
  if (streamUrl === radio.streamUrl && radio.streamFormat) {
    return radio.streamFormat;
  }
  if (
    streamUrl === radio.streamUrl &&
    isRadioBrowserMetadata(metadata) &&
    metadata.hls
  ) {
    return "hls";
  }
  return inferStreamFormat(streamUrl);
}

type StreamRefreshRequest = {
  failureCode: string;
  failureMessage: string;
  resolution: PlatformStreamResolutionInput;
};

function getRefreshRequest(radio: Radio): StreamRefreshRequest | null {
  const metadata = radio.platformMetadata;
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
        reason: "stream-refresh",
        videoId,
        radio,
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
      radio,
    },
  };
}

function createBrowserAudioAdapter(
  context: PlaybackActionContext
): DjDeckAudioAdapter {
  return {
    activate({ onMeter, onState, radio, soundId }) {
      context.audio.createSound(radio, soundId, "audio-graph");
      let stateCleanup: (() => void) | null = null;
      let meterCleanup: (() => void) | null = null;
      try {
        stateCleanup = context.audio.subscribe(soundId, onState);
        meterCleanup = context.audio.subscribeMeter(soundId, onMeter);
      } catch (error) {
        stateCleanup?.();
        meterCleanup?.();
        context.audio.cleanupSound(soundId);
        throw error;
      }
      return () => {
        stateCleanup?.();
        meterCleanup?.();
        context.audio.cleanupSound(soundId);
      };
    },
    applyStrip(soundId, channel) {
      if (channel.muted) {
        context.audio.muteSound(soundId);
      }
      if (channel.pan !== 0) {
        context.audio.setPan(soundId, channel.pan);
      }
      if (channel.speed !== 1) {
        context.audio.setPlaybackRate(soundId, channel.speed);
      }
      if (channel.channelFilter !== 0) {
        context.audio.setChannelFilter(soundId, channel.channelFilter);
      }
      if (channel.filter.enabled) {
        context.audio.updateFilter(soundId, channel.filter as FilterConfig);
      }
    },
    change(soundId, change) {
      switch (change.type) {
        case "channel-filter":
          context.audio.setChannelFilter(soundId, change.value);
          break;
        case "filter":
          context.audio.updateFilter(soundId, change.filter);
          break;
        case "mute":
          if (change.muted) {
            context.audio.muteSound(soundId);
          } else {
            context.audio.unmuteSound(soundId);
          }
          break;
        case "pan":
          context.audio.setPan(soundId, change.pan);
          break;
        case "speed":
          context.audio.setPlaybackRate(soundId, change.speed);
          break;
        case "volume":
          context.audioEngine.volume.setChannelVolume(soundId, change.volume);
          break;
        default: {
          const exhaustive: never = change;
          return exhaustive;
        }
      }
    },
    getCueTap: (soundId) => context.audio.getPreFaderNode(soundId),
    getDeviceChannelCount: (soundId) =>
      context.audio.getDeviceSource(soundId)?.channelCount ?? null,
    loadFile: extractFileMetadata,
    refresh: (soundId, streamUrl, position, streamFormat) =>
      context.audioEngine.playback.refreshStreamUrl(
        soundId,
        streamUrl,
        position,
        streamFormat
      ),
    releaseFileUrl: revokeFileObjectUrl,
    resume: context.resumeAudioContext,
    setDeviceChannelSelection: (soundId, selection) =>
      context.audio.setDeviceChannelSelection(soundId, selection),
    startDevice: (soundId, deviceId) =>
      context.audio.playDeviceSound(soundId, deviceId),
    async transport(soundId, intent) {
      switch (intent.type) {
        case "pause":
          context.audioEngine.playback.pause(soundId);
          return;
        case "play":
          await context.audioEngine.playback.play(soundId, intent.volume);
          return;
        case "seek":
          context.audioEngine.playback.seek(soundId, intent.position);
          return;
        default: {
          const exhaustive: never = intent;
          return exhaustive;
        }
      }
    },
  };
}

const productionPlatform: DjDeckPlatformAdapter = {
  loadItem: loadPlatformItem,
  resolveStream: resolveDjPlatformStreamUrl,
};

function reportEffectsError(error: unknown): void {
  console.warn("[DjDeck] Could not restore Effects", error);
}

function reportOutputError(error: unknown, deckId: DeckId): void {
  if (
    error instanceof ReferenceError &&
    error.message.includes("AudioContext is not defined")
  ) {
    return;
  }
  console.warn("[DjDeck] Could not restore CUE output", error);
  reportDjErrorSurface(
    error instanceof Error ? error.message : "Failed to restore CUE output",
    "DJ_OUTPUT_ROUTER_ERROR",
    error,
    null,
    deckId
  );
}

export function createDjDeckModule(options: DjDeckModuleOptions): DjDeckModule {
  const releasedFileUrls = new Set<string>();
  let pendingSourceSnapshot: DjDeckPendingSource = null;
  const pendingSourceListeners = new Set<() => void>();
  const setPendingSource = (next: DjDeckPendingSource): void => {
    if (
      pendingSourceSnapshot?.deckId === next?.deckId &&
      pendingSourceSnapshot?.platform === next?.platform
    ) {
      return;
    }
    pendingSourceSnapshot = next;
    for (const listener of pendingSourceListeners) {
      listener();
    }
  };
  const pendingSource: DjDeckModule["pendingSource"] = {
    cancel: () => setPendingSource(null),
    getSnapshot: () => pendingSourceSnapshot,
    subscribe(listener) {
      pendingSourceListeners.add(listener);
      return () => pendingSourceListeners.delete(listener);
    },
  };
  const runtimes: Record<DeckId, DeckRuntime> = {
    "deck-a": {
      bindingCleanup: null,
      cueRegistration: null,
      generation: 0,
      loadGeneration: 0,
      playGeneration: 0,
      stripRestored: false,
    },
    "deck-b": {
      bindingCleanup: null,
      cueRegistration: null,
      generation: 0,
      loadGeneration: 0,
      playGeneration: 0,
      stripRestored: false,
    },
  };

  const deactivateDeck = (deckId: DeckId): void => {
    const runtime = runtimes[deckId];
    runtime.bindingCleanup?.();
    runtime.bindingCleanup = null;
    runtime.cueRegistration?.replaceTap(null);
    runtime.stripRestored = false;
    options.effects.unbind(effectsRef(deckId));
    resetPlaybackChannelRuntime(deckId);
  };

  const beginGeneration = (deckId: DeckId): number => {
    const runtime = runtimes[deckId];
    runtime.generation += 1;
    runtime.playGeneration += 1;
    return runtime.generation;
  };

  const isCurrent = (deckId: DeckId, generation: number): boolean =>
    runtimes[deckId].generation === generation;

  const beginLoad = (deckId: DeckId): number => {
    const runtime = runtimes[deckId];
    runtime.loadGeneration += 1;
    runtime.playGeneration += 1;
    return runtime.loadGeneration;
  };

  const isLoadCurrent = (deckId: DeckId, generation: number): boolean =>
    runtimes[deckId].loadGeneration === generation;

  const reportFailure = (
    deckId: DeckId,
    code: string,
    fallbackMessage: string,
    error: unknown,
    radio = getPlaybackChannel("dj", deckId)?.radio ?? null,
    playbackCode: AudioErrorCode = "PLAY_ERROR"
  ): void => {
    const playbackError = createPlaybackActionError({
      mode: "dj",
      code: playbackCode,
      cause: error,
      channelId: deckId,
      radio: radio ?? undefined,
      fallbackMessage,
    });
    options.context.reportError(playbackError);
    reportDjErrorSurface(
      playbackError.userMessage,
      code,
      playbackError.cause,
      radio,
      deckId
    );
  };

  const applyCrossfade = (): void => {
    const left = getPlaybackChannel("dj", "deck-a");
    const right = getPlaybackChannel("dj", "deck-b");
    const mixer = getMixer();
    if (!(left && right && mixer)) {
      return;
    }
    const [leftVolume, rightVolume] = calculateDjCrossfadeVolumes(
      mixer.crossfadePosition,
      left.volume,
      right.volume
    );
    const leftSoundId = getPlaybackChannelRuntime("deck-a").soundId;
    const rightSoundId = getPlaybackChannelRuntime("deck-b").soundId;
    if (leftSoundId) {
      options.audio.change(leftSoundId, {
        type: "volume",
        volume: leftVolume,
      });
    }
    if (rightSoundId) {
      options.audio.change(rightSoundId, {
        type: "volume",
        volume: rightVolume,
      });
    }
  };

  const restorePlayableState = (
    deckId: DeckId,
    generation: number,
    soundId: string
  ): void => {
    if (!isCurrent(deckId, generation)) {
      return;
    }
    const runtime = runtimes[deckId];
    const channel = getPlaybackChannel("dj", deckId);
    if (!channel) {
      return;
    }
    if (!runtime.stripRestored) {
      runtime.stripRestored = true;
      try {
        options.audio.applyStrip(soundId, channel);
      } catch (error) {
        console.warn("[DjDeck] Could not restore channel strip", error);
      }
      options.output
        .applySettings()
        .catch((error) => reportOutputError(error, deckId));
    }
    const tap = options.audio.getCueTap(soundId);
    if (!tap) {
      return;
    }
    try {
      if (runtime.cueRegistration) {
        runtime.cueRegistration.replaceTap(tap);
        runtime.cueRegistration.setEnabled(channel.cueEnabled);
      } else {
        runtime.cueRegistration = options.output.registerCueDeck(
          deckId,
          tap,
          channel.cueEnabled
        );
      }
    } catch (error) {
      reportOutputError(error, deckId);
    }
  };

  const handleAudioState = (
    deckId: DeckId,
    generation: number,
    soundId: string,
    state: AudioState
  ): void => {
    if (!isCurrent(deckId, generation)) {
      return;
    }
    const radio = getPlaybackChannel("dj", deckId)?.radio ?? null;
    setPlaybackChannelRuntime(deckId, () => ({
      soundId,
      isPlaying: state.isPlaying,
      isLoading: state.isLoading,
      isBuffering: state.isBuffering,
      error: state.error
        ? toRuntimeAudioError(state.error, state.error.code)
        : null,
    }));
    if (state.isPlaying && !state.isLoading) {
      restorePlayableState(deckId, generation, soundId);
    }
    if (state.error?.code === "STREAM_INTERRUPTED" && radio) {
      refreshInterruptedStream(
        deckId,
        generation,
        soundId,
        radio,
        state.error.position ?? 0
      ).catch((error) =>
        console.error("[DjDeck] Stream refresh failed", error)
      );
      return;
    }
    if (state.error?.message) {
      reportFailure(
        deckId,
        `DJ_${state.error.code}`,
        state.error.message,
        new Error(state.error.message),
        radio,
        state.error.code
      );
    }
    if (state.hasEnded) {
      continueAfterEnd(deckId, generation, soundId).catch((error) =>
        console.error("[DjDeck] Continuation failed", error)
      );
    }
  };

  const startDeviceInput = async (
    deckId: DeckId,
    generation: number,
    soundId: string,
    metadata: Extract<
      NonNullable<Radio["platformMetadata"]>,
      { platform: "device-input" }
    >
  ): Promise<void> => {
    await options.audio.startDevice(soundId, metadata.deviceId);
    if (!isCurrent(deckId, generation)) {
      return;
    }
    options.audio.setDeviceChannelSelection(soundId, metadata.channelSelection);
    const channelCount = options.audio.getDeviceChannelCount(soundId);
    if (channelCount === null) {
      return;
    }
    updatePlaybackChannel("dj", deckId, (draft) => {
      const current = draft.radio?.platformMetadata;
      if (isDeviceInputMetadata(current)) {
        current.channelCount = channelCount;
      }
    });
  };

  const finishSourceActivation = async (
    deckId: DeckId,
    generation: number,
    soundId: string,
    radio: Radio,
    wasPlaying: boolean
  ): Promise<void> => {
    const metadata = radio.platformMetadata;
    if (isDeviceInputMetadata(metadata)) {
      await startDeviceInput(deckId, generation, soundId, metadata);
      if (isCurrent(deckId, generation)) {
        applyCrossfade();
      }
      return;
    }
    if (!wasPlaying) {
      return;
    }
    await options.audio.transport(soundId, {
      type: "play",
      volume: getPlaybackChannel("dj", deckId)?.volume ?? 1,
    });
    applyCrossfade();
  };

  const releaseFileUrl = (url: string): void => {
    if (releasedFileUrls.has(url)) {
      return;
    }
    releasedFileUrls.add(url);
    options.audio.releaseFileUrl(url);
  };

  const releaseReplacedFile = (
    previous: Radio | null,
    radio: Radio | null
  ): void => {
    const previousUrl = getLocalFileUrl(previous);
    if (previousUrl && previousUrl !== getLocalFileUrl(radio)) {
      releaseFileUrl(previousUrl);
    }
  };

  const resetEffects = async (deckId: DeckId): Promise<void> => {
    await options.effects
      .change(effectsRef(deckId), { type: "replace", tree: [] })
      .catch(reportEffectsError);
    await options.effects
      .change(effectsRef(deckId), { type: "set-dry-wet", value: 1 })
      .catch(reportEffectsError);
  };

  const resetPersistedState = async (
    deckId: DeckId,
    clearSource: boolean
  ): Promise<void> => {
    updatePlaybackChannel("dj", deckId, (draft) => {
      Object.assign(draft, {
        volume: 1,
        muted: false,
        pan: 0,
        speed: 1,
        channelFilter: 0,
        filter: {
          type: "lowpass",
          frequency: 1000,
          Q: 1,
          gain: 0,
          enabled: false,
        },
      });
      if (clearSource) {
        draft.radio = null;
        draft.repeat = false;
        draft.autoplay = true;
      }
    });
    await resetEffects(deckId);
  };

  const rollbackSource = (
    deckId: DeckId,
    previous: Radio | null,
    radio: Radio,
    error: unknown
  ): void => {
    deactivateDeck(deckId);
    updatePlaybackChannel("dj", deckId, (draft) => {
      draft.radio = null;
    });
    releaseReplacedFile(previous, null);
    reportFailure(
      deckId,
      "DJ_LOAD_DECK_FAILED",
      `Failed to load ${deckId}`,
      error,
      radio
    );
  };

  const commitRadio = async (
    deckId: DeckId,
    loadGeneration: number,
    radio: Radio | null
  ): Promise<void> => {
    if (!isLoadCurrent(deckId, loadGeneration)) {
      return;
    }
    const generation = beginGeneration(deckId);
    const previous = getPlaybackChannel("dj", deckId)?.radio ?? null;
    const wasPlaying = getPlaybackChannelRuntime(deckId).isPlaying;
    deactivateDeck(deckId);
    if (!radio) {
      await resetPersistedState(deckId, true);
      releaseReplacedFile(previous, null);
      return;
    }
    const soundId = soundIdFor(deckId, radio, generation);
    let activationCleanup: (() => void) | null = null;
    try {
      activationCleanup = options.audio.activate({
        deckId,
        radio,
        soundId,
        onMeter: (level) => setPlaybackChannelPeakLevel(deckId, level),
        onState: (state) =>
          handleAudioState(deckId, generation, soundId, state),
      });
      if (!isCurrent(deckId, generation)) {
        activationCleanup();
        return;
      }
      runtimes[deckId].bindingCleanup = activationCleanup;
      updatePlaybackChannel("dj", deckId, (draft) => {
        draft.radio = radio;
      });
      setPlaybackChannelSoundId(deckId, soundId);
      options.effects
        .bind(effectsRef(deckId), soundId)
        .catch(reportEffectsError);
      await finishSourceActivation(
        deckId,
        generation,
        soundId,
        radio,
        wasPlaying
      );
      if (!isCurrent(deckId, generation)) {
        activationCleanup();
        releaseReplacedFile(previous, radio);
        return;
      }
      releaseReplacedFile(previous, radio);
    } catch (error) {
      if (!isCurrent(deckId, generation)) {
        activationCleanup?.();
        releaseReplacedFile(previous, radio);
        return;
      }
      rollbackSource(deckId, previous, radio, error);
    }
  };

  const reportYouTubeResolutionFailure = (
    deckId: DeckId,
    radio: Radio,
    error?: unknown
  ): void =>
    reportDjErrorSurface(
      "Failed to resolve YouTube stream",
      "DJ_YOUTUBE_RESOLVE_FAILED",
      error,
      radio,
      deckId
    );

  const resolveYouTubeTrack = async (
    deckId: DeckId,
    loadGeneration: number,
    radio: Radio,
    sourceUrl: string
  ): Promise<PlatformStreamResolution | null> => {
    const videoId = sourceUrl.slice(3);
    let resolved: PlatformStreamResolution | null = null;
    try {
      resolved = await options.platform.resolveStream({
        platform: "youtube",
        reason: "initial-load",
        videoId,
        radio,
      });
    } catch (error) {
      if (isLoadCurrent(deckId, loadGeneration)) {
        reportYouTubeResolutionFailure(deckId, radio, error);
      }
      return null;
    }
    if (!(isLoadCurrent(deckId, loadGeneration) && resolved)) {
      if (isLoadCurrent(deckId, loadGeneration)) {
        reportYouTubeResolutionFailure(deckId, radio);
      }
      return null;
    }
    const metadata = radio.platformMetadata;
    const track = isYouTubeMetadata(metadata)
      ? metadata.tracks?.find((candidate) => candidate.videoId === videoId)
      : undefined;
    if (track) {
      track.streamUrl = resolved.streamUrl;
    }
    return resolved;
  };

  const resolveTrack = async (
    deckId: DeckId,
    loadGeneration: number,
    radio: Radio,
    sourceUrl: string
  ): Promise<PlatformStreamResolution | null> => {
    const resolved = sourceUrl.startsWith("yt:")
      ? await resolveYouTubeTrack(deckId, loadGeneration, radio, sourceUrl)
      : {
          streamFormat: getTrackFormat(radio, sourceUrl),
          streamUrl: sourceUrl,
        };
    if (!resolved) {
      return null;
    }
    const validation = validatePlaybackStreamUrl(resolved.streamUrl);
    if (!validation.ok) {
      reportDjErrorSurface(
        "Invalid stream URL",
        "DJ_INVALID_STREAM_URL",
        undefined,
        radio,
        deckId
      );
      return null;
    }
    return { ...resolved, streamUrl: validation.normalizedUrl };
  };

  const play = async (deckId: DeckId): Promise<void> => {
    const runtime = getPlaybackChannelRuntime(deckId);
    const channel = getPlaybackChannel("dj", deckId);
    if (!(runtime.soundId && channel?.radio) || runtime.isPlaying) {
      return;
    }
    const generation = runtimes[deckId].generation;
    const playGeneration = ++runtimes[deckId].playGeneration;
    const { radio, volume } = channel;
    const soundId = runtime.soundId;
    const stillCurrent = () =>
      isCurrent(deckId, generation) &&
      runtimes[deckId].playGeneration === playGeneration &&
      getPlaybackChannelRuntime(deckId).soundId === soundId &&
      getPlaybackChannel("dj", deckId)?.radio?.streamUrl === radio.streamUrl;
    try {
      await options.audio.resume();
      if (!stillCurrent()) {
        return;
      }
      await options.audio.transport(soundId, { type: "play", volume });
      if (!stillCurrent()) {
        return;
      }
      clearDjErrorSurface(deckId);
      applyCrossfade();
    } catch (error) {
      if (stillCurrent()) {
        reportFailure(
          deckId,
          "DJ_PLAY_DECK_FAILED",
          `Failed to play ${deckId}`,
          error,
          radio
        );
      }
    }
  };

  const pause = async (deckId: DeckId): Promise<void> => {
    runtimes[deckId].playGeneration += 1;
    const soundId = getPlaybackChannelRuntime(deckId).soundId;
    if (soundId) {
      await options.audio.transport(soundId, { type: "pause" });
    }
  };

  async function refreshInterruptedStream(
    deckId: DeckId,
    generation: number,
    soundId: string,
    radio: Radio,
    position: number
  ): Promise<void> {
    const request = getRefreshRequest(radio);
    if (!request) {
      return;
    }
    try {
      const resolved = await options.platform.resolveStream(request.resolution);
      if (
        !isCurrent(deckId, generation) ||
        getPlaybackChannelRuntime(deckId).soundId !== soundId
      ) {
        return;
      }
      if (!resolved) {
        reportDjErrorSurface(
          request.failureMessage,
          request.failureCode,
          undefined,
          radio,
          deckId
        );
        return;
      }
      const validation = validatePlaybackStreamUrl(resolved.streamUrl);
      if (!validation.ok) {
        throw new Error("Invalid refreshed stream URL");
      }
      await options.audio.refresh(
        soundId,
        validation.normalizedUrl,
        position,
        resolved.streamFormat
      );
      if (!isCurrent(deckId, generation)) {
        return;
      }
      setPlaybackChannelRuntime(deckId, () => ({ error: null }));
      clearDjErrorSurface(deckId);
      applyCrossfade();
    } catch (error) {
      if (isCurrent(deckId, generation)) {
        reportFailure(
          deckId,
          "DJ_STREAM_REFRESH_FAILED",
          request.failureMessage,
          error,
          radio
        );
      }
    }
  }

  const isContinuationCurrent = (
    deckId: DeckId,
    generation: number,
    soundId: string
  ): boolean =>
    isCurrent(deckId, generation) &&
    getPlaybackChannelRuntime(deckId).soundId === soundId;

  async function repeatAfterEnd(
    deckId: DeckId,
    generation: number,
    soundId: string,
    radio: Radio,
    volume: number
  ): Promise<void> {
    runtimes[deckId].stripRestored = false;
    try {
      await options.audio.transport(soundId, { type: "seek", position: 0 });
      if (!isContinuationCurrent(deckId, generation, soundId)) {
        return;
      }
      await options.audio.transport(soundId, { type: "play", volume });
      if (!isContinuationCurrent(deckId, generation, soundId)) {
        return;
      }
      applyCrossfade();
    } catch (error) {
      if (isContinuationCurrent(deckId, generation, soundId)) {
        reportFailure(
          deckId,
          "DJ_REPEAT_TRACK_FAILED",
          "Failed to repeat track",
          error,
          radio
        );
      }
    }
  }

  async function continueAfterEnd(
    deckId: DeckId,
    generation: number,
    soundId: string
  ): Promise<void> {
    const channel = getPlaybackChannel("dj", deckId);
    if (
      !(channel?.radio && isContinuationCurrent(deckId, generation, soundId))
    ) {
      return;
    }
    if (channel.repeat) {
      await repeatAfterEnd(
        deckId,
        generation,
        soundId,
        channel.radio,
        channel.volume
      );
      return;
    }
    if (!channel.autoplay) {
      return;
    }
    const next = findNextTrack(channel.radio);
    if (!next) {
      return;
    }
    try {
      await load(deckId, {
        type: "track-url",
        radio: channel.radio,
        streamUrl: next.streamUrl,
        autoPlay: true,
      });
    } catch (error) {
      reportFailure(
        deckId,
        "DJ_LOAD_NEXT_TRACK_FAILED",
        "Failed to load next track",
        error,
        channel.radio
      );
    }
  }

  const loaded = (): DeckSourceLoadResult => ({ type: "loaded" });

  async function loadLibraryIntent(
    deckId: DeckId,
    radio: Radio
  ): Promise<DjDeckLoadResult> {
    const intent = getDeckLibrarySourceIntent(radio);
    if (intent.type === "pending-platform") {
      setPendingSource({ deckId, platform: intent.platform });
      return intent;
    }
    return await load(deckId, intent.source);
  }

  async function loadDeviceIntent(
    deckId: DeckId,
    loadGeneration: number,
    intent: Extract<DjDeckLoadIntent, { type: "device-input" }>
  ): Promise<DeckSourceLoadResult> {
    const side = sideForDeck(deckId);
    await commitRadio(deckId, loadGeneration, {
      id: `device-input-${side}`,
      name: intent.deviceLabel,
      streamUrl: "",
      description: "Device input (mic/line-in)",
      enabled: true,
      platformMetadata: {
        platform: "device-input",
        itemType: "track",
        url: "",
        deviceId: intent.deviceId,
        deviceLabel: intent.deviceLabel,
        channelSelection: { left: 0, right: 1 },
        channelCount: 2,
      },
    });
    return loaded();
  }

  async function loadFileIntent(
    deckId: DeckId,
    loadGeneration: number,
    file: File
  ): Promise<DeckSourceLoadResult> {
    let unownedUrl: string | null = null;
    try {
      const metadata = await options.audio.loadFile(file);
      unownedUrl = metadata.objectUrl;
      if (isLoadCurrent(deckId, loadGeneration)) {
        await commitRadio(
          deckId,
          loadGeneration,
          createLocalFileRadio(deckId, metadata)
        );
        if (
          getLocalFileUrl(getPlaybackChannel("dj", deckId)?.radio ?? null) ===
          metadata.objectUrl
        ) {
          unownedUrl = null;
        }
      }
    } catch (error) {
      if (isLoadCurrent(deckId, loadGeneration)) {
        const message =
          error instanceof Error ? error.message : "Failed to load audio file";
        reportDjErrorSurface(
          message,
          "DJ_LOCAL_FILE_LOAD_FAILED",
          error,
          null,
          deckId
        );
      }
    } finally {
      if (unownedUrl) {
        releaseFileUrl(unownedUrl);
      }
    }
    return loaded();
  }

  async function loadStaticUrlIntent(
    deckId: DeckId,
    loadGeneration: number,
    url: string
  ): Promise<DeckSourceLoadResult> {
    try {
      const result = await options.platform.loadItem(url);
      if (!isLoadCurrent(deckId, loadGeneration)) {
        return loaded();
      }
      if (!result.success) {
        reportDjErrorSurface(
          result.error,
          result.code,
          undefined,
          null,
          deckId
        );
        return loaded();
      }
      const resolved = await resolveTrack(
        deckId,
        loadGeneration,
        result.radio,
        result.radio.streamUrl
      );
      if (resolved && isLoadCurrent(deckId, loadGeneration)) {
        await commitRadio(deckId, loadGeneration, {
          ...result.radio,
          ...resolved,
        });
      }
    } catch (error) {
      if (isLoadCurrent(deckId, loadGeneration)) {
        reportDjErrorSurface(
          error instanceof Error
            ? error.message
            : "Failed to resolve audio URL",
          "DJ_STATIC_AUDIO_RESOLVE_FAILED",
          error,
          null,
          deckId
        );
      }
    }
    return loaded();
  }

  async function loadTrackIntent(
    deckId: DeckId,
    loadGeneration: number,
    intent: Extract<DjDeckLoadIntent, { type: "track" | "track-url" }>
  ): Promise<DeckSourceLoadResult> {
    if (!intent.radio) {
      await commitRadio(deckId, loadGeneration, null);
      return loaded();
    }
    const sourceUrl =
      intent.type === "track-url" ? intent.streamUrl : intent.radio.streamUrl;
    const resolved = await resolveTrack(
      deckId,
      loadGeneration,
      intent.radio,
      sourceUrl
    );
    if (!(resolved && isLoadCurrent(deckId, loadGeneration))) {
      return loaded();
    }
    const runtime = getPlaybackChannelRuntime(deckId);
    if (runtime.isPlaying) {
      await pause(deckId);
    }
    await commitRadio(deckId, loadGeneration, { ...intent.radio, ...resolved });
    if (intent.autoPlay && isLoadCurrent(deckId, loadGeneration)) {
      await play(deckId);
    }
    return loaded();
  }

  const load = async (
    deckId: DeckId,
    intent: DjDeckLoadIntent
  ): Promise<DjDeckLoadResult> => {
    if (intent.type === "library") {
      clearDjErrorSurface(deckId);
      return await loadLibraryIntent(deckId, intent.radio);
    }
    setPendingSource(null);
    const loadGeneration = beginLoad(deckId);
    clearDjErrorSurface(deckId);
    switch (intent.type) {
      case "radio":
        await commitRadio(deckId, loadGeneration, intent.radio);
        return loaded();
      case "device-input":
        return await loadDeviceIntent(deckId, loadGeneration, intent);
      case "file":
        return await loadFileIntent(deckId, loadGeneration, intent.file);
      case "static-audio-url":
        return await loadStaticUrlIntent(deckId, loadGeneration, intent.url);
      case "track":
      case "track-url":
        return await loadTrackIntent(deckId, loadGeneration, intent);
      default:
        return intent satisfies never;
    }
  };

  const transport = async (
    deckId: DeckId,
    intent: DjDeckTransportIntent
  ): Promise<void> => {
    if (intent.type === "play") {
      await play(deckId);
      return;
    }
    if (intent.type === "pause") {
      await pause(deckId);
      return;
    }
    if (intent.type === "toggle") {
      if (getPlaybackChannelRuntime(deckId).isPlaying) {
        await pause(deckId);
      } else {
        await play(deckId);
      }
      return;
    }
    if (intent.type === "seek") {
      const soundId = getPlaybackChannelRuntime(deckId).soundId;
      if (soundId) {
        await options.audio.transport(soundId, intent);
      }
      return;
    }
    const radio = getPlaybackChannel("dj", deckId)?.radio ?? null;
    if (!radio) {
      return;
    }
    await resetPersistedState(deckId, false);
    await load(deckId, { type: "radio", radio });
  };

  const changeActiveSound = (
    deckId: DeckId,
    input: DjDeckAudioChange
  ): void => {
    const soundId = getPlaybackChannelRuntime(deckId).soundId;
    if (soundId) {
      options.audio.change(soundId, input);
    }
  };

  const changeDeviceSelection = (
    deckId: DeckId,
    selection: ChannelSelection
  ): void => {
    const metadata = getPlaybackChannel("dj", deckId)?.radio?.platformMetadata;
    if (!isDeviceInputMetadata(metadata)) {
      return;
    }
    const soundId = getPlaybackChannelRuntime(deckId).soundId;
    if (soundId) {
      options.audio.setDeviceChannelSelection(soundId, selection);
    }
    updatePlaybackChannel("dj", deckId, (draft) => {
      const current = draft.radio?.platformMetadata;
      if (isDeviceInputMetadata(current)) {
        current.channelSelection = selection;
      }
    });
  };

  const changeCue = (deckId: DeckId, requested?: boolean): void => {
    const current = getPlaybackChannel("dj", deckId)?.cueEnabled ?? false;
    if (requested === undefined && !getAudioSettings().cueOutputId) {
      return;
    }
    const enabled = requested ?? !current;
    const runtime = runtimes[deckId];
    const soundId = getPlaybackChannelRuntime(deckId).soundId;
    if (runtime.cueRegistration) {
      runtime.cueRegistration.setEnabled(enabled);
    } else {
      runtime.cueRegistration = options.output.registerCueDeck(
        deckId,
        soundId ? options.audio.getCueTap(soundId) : null,
        enabled
      );
    }
    updatePlaybackChannel("dj", deckId, (draft) => {
      draft.cueEnabled = enabled;
    });
  };

  const change = (deckId: DeckId, input: DjDeckChange): void => {
    const update = (updater: (draft: PlaybackChannelRecord) => void) =>
      updatePlaybackChannel("dj", deckId, updater);
    switch (input.type) {
      case "autoplay":
        update((draft) => {
          draft.autoplay = input.enabled;
        });
        return;
      case "repeat":
        update((draft) => {
          draft.repeat = input.enabled;
        });
        return;
      case "volume":
        update((draft) => {
          draft.volume = input.volume;
        });
        applyCrossfade();
        return;
      case "mute":
        update((draft) => {
          draft.muted = input.muted;
        });
        changeActiveSound(deckId, input);
        return;
      case "pan":
        update((draft) => {
          draft.pan = input.pan;
        });
        changeActiveSound(deckId, input);
        return;
      case "speed":
        update((draft) => {
          draft.speed = input.speed;
        });
        changeActiveSound(deckId, input);
        return;
      case "channel-filter":
        update((draft) => {
          draft.channelFilter = input.value;
        });
        changeActiveSound(deckId, input);
        return;
      case "filter":
        update((draft) => {
          draft.filter = input.filter;
        });
        changeActiveSound(deckId, input);
        return;
      case "effects-dry-wet":
        options.effects
          .change(effectsRef(deckId), {
            type: "set-dry-wet",
            value: input.value,
          })
          .catch(reportEffectsError);
        return;
      case "effect":
        options.effects
          .change(effectsRef(deckId), input.change)
          .catch(reportEffectsError);
        return;
      case "device-channel-selection":
        changeDeviceSelection(deckId, input.selection);
        return;
      case "cue":
        changeCue(deckId, input.enabled);
        return;
      default:
        assertNever(input);
    }
  };

  const handles = {} as Record<DeckId, DjDeckHandle>;
  for (const deckId of ["deck-a", "deck-b"] as const) {
    handles[deckId] = {
      load: (intent) => load(deckId, intent),
      transport: (intent) => transport(deckId, intent),
      change: (input) => change(deckId, input),
    };
  }

  return {
    deck: (deckId) => handles[deckId],
    pendingSource,
    deactivate() {
      pendingSource.cancel();
      for (const deckId of ["deck-a", "deck-b"] as const) {
        const fileUrl = getLocalFileUrl(
          getPlaybackChannel("dj", deckId)?.radio ?? null
        );
        if (fileUrl) {
          releaseFileUrl(fileUrl);
        }
        beginLoad(deckId);
        beginGeneration(deckId);
        deactivateDeck(deckId);
        runtimes[deckId].cueRegistration?.cleanup();
        runtimes[deckId].cueRegistration = null;
      }
      options.output.releaseCue();
      clearDjErrorSurface();
    },
  };
}

const instances = new WeakMap<PlaybackActionContext, DjDeckModule>();

export function getDjDeckModule(
  context = getDefaultPlaybackActionContext()
): DjDeckModule {
  const existing = instances.get(context);
  if (existing) {
    return existing;
  }
  const module = createDjDeckModule({
    audio: createBrowserAudioAdapter(context),
    context,
    effects: channelEffects,
    output: context.getMainOutputRouter() ?? getOutputRouting(),
    platform: productionPlatform,
  });
  instances.set(context, module);
  return module;
}

export function createDjDeckEffectChange(
  type: EffectType,
  effectId = generateId()
): DjDeckChange {
  const effect: EffectConfig = createDefaultEffectConfig(type, effectId, 0);
  return { type: "effect", change: { type: "add", effect } };
}

export type { PlaybackActionError } from "@/lib/playback-action-errors.js";
