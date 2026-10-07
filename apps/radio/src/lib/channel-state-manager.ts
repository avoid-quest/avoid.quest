import { captureError } from "@avoid.quest/error";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { AudioManager, type AudioState, type FilterConfig } from "@/lib/audio";
import {
  getPlaybackChannel,
  PLAYBACK_SESSION_IDS,
  type PlaybackChannelRecord,
  type PlaybackSessionId,
  playbackSessionsCollection,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { shouldUseNativeSinglePlayback } from "@/lib/collections/settings";
import {
  type ChannelRuntimeView,
  getPlaybackChannelRuntime,
  getPlaybackRuntimeChannelIds,
  resetPlaybackChannelRuntime,
  setPlaybackChannelPeakLevel,
  setPlaybackChannelRuntime,
  setPlaybackChannelSoundId,
  usePlaybackChannelRuntimeView,
} from "@/lib/stores/playback-runtime-store";
import { channelEffects } from "./channel-effects.js";
import {
  capturePlaybackActionError,
  createPlaybackActionError,
  toRuntimeAudioError,
} from "./playback-action-errors.js";

export type ChannelState = PlaybackChannelRecord &
  ReturnType<typeof getPlaybackChannelRuntime>;

export { selectChannelRuntimeView } from "@/lib/stores/playback-runtime-store";

/** A channel as views render it: everything but its meter-rate peak level. */
export type ChannelViewState = PlaybackChannelRecord & ChannelRuntimeView;

export type ChannelOutputMode = "audio-graph" | "native";

type ChannelAudioField =
  | "volume"
  | "muted"
  | "pan"
  | "speed"
  | "channelFilter"
  | "filter";

type ChannelUpdate =
  | Partial<PlaybackChannelRecord>
  | ((draft: PlaybackChannelRecord) => void);

export type ChannelActivationOptions = {
  soundId?: string;
  /** Return true only when a recovery owns reporting this failure. */
  onAudioState?: (audioState: AudioState) => boolean | undefined;
  persistRadio?: boolean;
  /**
   * The caller reconciles the sound's effects itself, from its own state,
   * so the channel is never bound to channel effects or the saved session.
   */
  ownsEffects?: boolean;
};

export type ChannelRuntimeSubscriptionOptions = Pick<
  ChannelActivationOptions,
  "onAudioState"
>;

const CHANNEL_AUDIO_SYNC_ORDER = [
  "volume",
  "muted",
  "pan",
  "speed",
  "channelFilter",
  "filter",
] as const satisfies readonly ChannelAudioField[];

const subscriptionCleanups = new Map<string, () => void>();
const channelOutputModes = new Map<string, ChannelOutputMode>();
const channelSessions = new Map<string, PlaybackSessionId>();
/** Channels whose effects their caller owns: never bound, never unbound. */
const effectsOwnedChannels = new Set<string>();

function getAudioManager(): AudioManager {
  return AudioManager.getInstance();
}

function mergeChannelState(
  persisted: PlaybackChannelRecord | undefined,
  runtime: ReturnType<typeof getPlaybackChannelRuntime>
): ChannelState | null {
  if (!persisted) {
    return null;
  }
  return {
    ...persisted,
    ...runtime,
  };
}

function syncChannelAudioField(
  manager: AudioManager,
  soundId: string,
  channel: PlaybackChannelRecord,
  field: ChannelAudioField
): void {
  switch (field) {
    case "volume":
      manager.setVolume(soundId, channel.volume);
      break;
    case "muted":
      if (channel.muted) {
        manager.muteSound(soundId);
      } else {
        manager.unmuteSound(soundId);
      }
      break;
    case "pan":
      manager.setPan(soundId, channel.pan);
      break;
    case "speed":
      manager.setPlaybackRate(soundId, channel.speed);
      break;
    case "channelFilter":
      manager.setChannelFilter(soundId, channel.channelFilter);
      break;
    case "filter":
      manager.updateFilter(soundId, channel.filter as FilterConfig);
      break;
    default:
      break;
  }
}

function syncChannelAudioFields(
  soundId: string,
  channel: PlaybackChannelRecord,
  fields: readonly ChannelAudioField[]
): void {
  const manager = getAudioManager();
  const selectedFields = new Set<ChannelAudioField>(fields);

  for (const field of CHANNEL_AUDIO_SYNC_ORDER) {
    if (selectedFields.has(field)) {
      syncChannelAudioField(manager, soundId, channel, field);
    }
  }
}

export function getChannelState(
  sessionId: PlaybackSessionId,
  channelId: string
): ChannelState | null {
  return mergeChannelState(
    getPlaybackChannel(sessionId, channelId),
    getPlaybackChannelRuntime(channelId)
  );
}

export function useChannelState(
  sessionId: PlaybackSessionId,
  channelId: string
): ChannelViewState | null {
  const runtime = usePlaybackChannelRuntimeView(channelId);
  const result = useLiveQuery((q) =>
    q
      .from({ session: playbackSessionsCollection })
      .where(({ session }) => eq(session.id, sessionId))
  );
  const persistedSession = result.data?.[0];
  const persisted = persistedSession?.channels.find(
    (channel) => channel.id === channelId
  ) as PlaybackChannelRecord | undefined;
  return persisted ? { ...persisted, ...runtime } : null;
}

function updateChannel(
  sessionId: PlaybackSessionId,
  channelId: string,
  update: ChannelUpdate,
  syncFields: readonly ChannelAudioField[] = []
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    if (typeof update === "function") {
      update(draft);
      return;
    }
    Object.assign(draft, update);
  });

  const channel = getPlaybackChannel(sessionId, channelId);
  const runtime = getPlaybackChannelRuntime(channelId);
  if (!(channel && runtime.soundId && syncFields.length > 0)) {
    return;
  }
  syncChannelAudioFields(runtime.soundId, channel, syncFields);
}

export function setChannelVolume(
  sessionId: PlaybackSessionId,
  channelId: string,
  volume: number
): void {
  updateChannel(sessionId, channelId, { volume }, ["volume"]);
}

export function setChannelMuted(
  sessionId: PlaybackSessionId,
  channelId: string,
  muted: boolean
): void {
  updateChannel(sessionId, channelId, { muted }, ["muted"]);
}

export function setChannelPan(
  sessionId: PlaybackSessionId,
  channelId: string,
  pan: number
): void {
  updateChannel(sessionId, channelId, { pan }, ["pan"]);
}

export function setChannelSpeed(
  sessionId: PlaybackSessionId,
  channelId: string,
  speed: number
): void {
  updateChannel(sessionId, channelId, { speed }, ["speed"]);
}

export function setChannelFilterValue(
  sessionId: PlaybackSessionId,
  channelId: string,
  channelFilter: number
): void {
  updateChannel(sessionId, channelId, { channelFilter }, ["channelFilter"]);
}

export function updateChannelFilter(
  sessionId: PlaybackSessionId,
  channelId: string,
  filter: FilterConfig
): void {
  updateChannel(sessionId, channelId, { filter }, ["filter"]);
}

function reportChannelEffectsError(error: unknown): void {
  captureError(error, { operation: "reconcileChannelEffects", surface: "ui" });
}

function setChannelSubscriptionCleanup(
  channelId: string,
  cleanup: (() => void) | null
): void {
  subscriptionCleanups.get(channelId)?.();
  if (cleanup) {
    subscriptionCleanups.set(channelId, cleanup);
    return;
  }
  subscriptionCleanups.delete(channelId);
}

export function deactivateAllChannels(): void {
  const channelIds = new Set([
    ...subscriptionCleanups.keys(),
    ...channelOutputModes.keys(),
    ...channelSessions.keys(),
    ...getPlaybackRuntimeChannelIds(),
  ]);

  for (const channelId of channelIds) {
    deactivateChannel(channelId);
  }
}

export function getChannelOutputMode(
  channelId: string
): ChannelOutputMode | null {
  return channelOutputModes.get(channelId) ?? null;
}

export function subscribeChannelRuntime(
  sessionId: PlaybackSessionId,
  channelId: string,
  soundId: string,
  options: ChannelRuntimeSubscriptionOptions = {}
): void {
  const manager = getAudioManager();
  const cleanup = manager.subscribe(soundId, (audioState) => {
    const channel = getPlaybackChannel(sessionId, channelId);
    setPlaybackChannelRuntime(channelId, () => ({
      // The start action owns its failure and possible URL renewal. Publish
      // its terminal error only after that action has exhausted recovery.
      error:
        audioState.error && !audioState.error.duringStart
          ? toRuntimeAudioError(
              audioState.error,
              audioState.error.code,
              channel?.radio ?? undefined
            )
          : null,
      isBuffering: audioState.isBuffering,
      isLoading: audioState.isLoading,
      isPlaying: audioState.isPlaying,
      soundId,
    }));
    const recoveryOwned = options.onAudioState?.(audioState) === true;
    if (audioState.error && !audioState.error.duringStart && !recoveryOwned) {
      capturePlaybackActionError(
        createPlaybackActionError({
          cause: audioState.error.cause ?? new Error(audioState.error.message),
          code: audioState.error.code,
          mode: sessionId,
          radio: channel?.radio ?? undefined,
        })
      );
    }
  });

  let meterCleanup: (() => void) | null = null;
  try {
    meterCleanup =
      sessionId === "dj"
        ? manager.subscribeMeter(soundId, (level) => {
            setPlaybackChannelPeakLevel(channelId, level);
          })
        : null;

    setChannelSubscriptionCleanup(channelId, () => {
      cleanup();
      meterCleanup?.();
    });
  } catch (error) {
    cleanup();
    meterCleanup?.();
    throw error;
  }
}

export function activateChannel(
  sessionId: PlaybackSessionId,
  channelId: string,
  radio: PlaybackChannelRecord["radio"],
  optionsOrSoundId: ChannelActivationOptions | string = {}
): string {
  if (!radio) {
    throw new Error(`Cannot activate ${channelId} without a radio`);
  }

  const options =
    typeof optionsOrSoundId === "string"
      ? { soundId: optionsOrSoundId }
      : optionsOrSoundId;
  const soundId = options.soundId ?? `${sessionId}:${channelId}`;
  const previousRadio = getPlaybackChannel(sessionId, channelId)?.radio ?? null;
  const manager = getAudioManager();
  const outputMode: ChannelOutputMode =
    sessionId === "single" && shouldUseNativeSinglePlayback()
      ? "native"
      : "audio-graph";
  let soundCreated = false;

  deactivateChannel(channelId);
  try {
    manager.createSound(radio, soundId, outputMode);
    soundCreated = true;
    channelOutputModes.set(channelId, outputMode);
    channelSessions.set(channelId, sessionId);
    if (options.persistRadio) {
      updatePlaybackChannel(sessionId, channelId, (draft) => {
        draft.radio = radio;
      });
    }
    setPlaybackChannelSoundId(channelId, soundId);
    if (options.ownsEffects) {
      effectsOwnedChannels.add(channelId);
    } else {
      channelEffects
        .bind({ channelId, sessionId }, soundId)
        .catch(reportChannelEffectsError);
    }
    subscribeChannelRuntime(sessionId, channelId, soundId, {
      onAudioState: options.onAudioState,
    });
  } catch (error) {
    setChannelSubscriptionCleanup(channelId, null);
    channelOutputModes.delete(channelId);
    channelSessions.delete(channelId);
    if (soundCreated) {
      manager.cleanupSound(soundId);
    }
    resetPlaybackChannelRuntime(channelId);
    if (!effectsOwnedChannels.delete(channelId)) {
      channelEffects.unbind({ channelId, sessionId });
    }
    if (options.persistRadio) {
      updatePlaybackChannel(sessionId, channelId, (draft) => {
        draft.radio = previousRadio;
      });
    }
    throw error;
  }
  return soundId;
}

export function deactivateChannel(channelId: string): void {
  const runtime = getPlaybackChannelRuntime(channelId);
  const sessionId =
    channelSessions.get(channelId) ??
    PLAYBACK_SESSION_IDS.find((candidate) =>
      getPlaybackChannel(candidate, channelId)
    );
  setChannelSubscriptionCleanup(channelId, null);
  channelOutputModes.delete(channelId);
  channelSessions.delete(channelId);
  if (runtime.soundId) {
    getAudioManager().cleanupSound(runtime.soundId);
  }
  resetPlaybackChannelRuntime(channelId);
  if (!effectsOwnedChannels.delete(channelId) && sessionId) {
    channelEffects.unbind({ channelId, sessionId });
  }
}
