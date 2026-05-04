import { useSyncExternalStore } from "react";
import { fadeOut, type Radio } from "@/lib/audio";
import {
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  getPlaybackSession,
  PLAYBACK_SESSION_IDS,
  type PlaybackSessionId,
  type PlaybackSessionRecord,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { updatePlayerSettings } from "@/lib/collections/settings";
import { DEFAULT_TRANSITION_DURATION } from "@/lib/const";
import { clearDjErrorSurface } from "@/lib/dj/dj-error-surface";
import {
  cleanupAudioOnly,
  createDjDeckCommands,
  setCrossfadePosition,
  setMasterVolume,
} from "@/lib/dj-actions";
import { resetDeck } from "@/lib/hooks/use-dj-state";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "@/lib/playback-action-context";
import {
  applySessionMasterVolume,
  cleanupManagedChannel,
  createManagedSound,
  ensureMainAudioSettingsApplied,
} from "@/lib/playback-actions-shared";
import type { DeckId } from "@/lib/stores/dj-runtime-store";
import {
  getPlaybackChannelRuntime,
  resetPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";

export type ModePhase = "inactive" | "activating" | "active" | "deactivating";

export type ModeLifecycle = {
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
  getPhase: () => ModePhase;
};

export type ModeTransitionSnapshot = {
  currentMode: PlaybackSessionId | null;
  requestedMode: PlaybackSessionId | null;
  phase: ModePhase;
  error: string | null;
};

type FadeOutSound = (
  soundId: string,
  durationMs: number,
  stopAfter: boolean
) => Promise<void>;

type CreateModeLifecycleRegistryOptions = {
  ctx?: PlaybackActionContext;
  fadeOutDurationMs?: number;
  fadeOutSound?: FadeOutSound;
};

type CreateModeManagerOptions = {
  initialMode?: PlaybackSessionId | null;
  lifecycles?: Record<PlaybackSessionId, ModeLifecycle>;
  commitMode?: (mode: PlaybackSessionId) => void;
};

type DjDeckCommands = ReturnType<typeof createDjDeckCommands>;
type ManagedPlaybackSessionId = Exclude<PlaybackSessionId, "dj">;

type ModeManager = {
  getSnapshot: () => ModeTransitionSnapshot;
  subscribe: (listener: () => void) => () => void;
  activateInitialMode: (mode: PlaybackSessionId) => Promise<void>;
  switchTo: (nextMode: PlaybackSessionId) => Promise<void>;
};

const MODE_FADE_OUT_DURATION_MS = 150;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Mode transition failed";
}

function createLifecycle(
  activateMode: () => Promise<void>,
  deactivateMode: () => Promise<void>
): ModeLifecycle {
  let phase: ModePhase = "inactive";

  return {
    async activate() {
      phase = "activating";
      try {
        await activateMode();
        phase = "active";
      } catch (error) {
        phase = "inactive";
        throw error;
      }
    },
    async deactivate() {
      phase = "deactivating";
      try {
        await deactivateMode();
        phase = "inactive";
      } catch (error) {
        phase = "active";
        throw error;
      }
    },
    getPhase() {
      return phase;
    },
  };
}

async function fadeOutSoundIds(
  soundIds: string[],
  fadeOutSound: FadeOutSound,
  durationMs: number
): Promise<void> {
  await Promise.all(
    soundIds.map((soundId) => fadeOutSound(soundId, durationMs, true))
  );
}

function getSessionSoundIds(sessionId: PlaybackSessionId): string[] {
  const session = getPlaybackSession(sessionId);
  if (!session) {
    return [];
  }
  return session.channels.flatMap((channel) => {
    const soundId = getPlaybackChannelRuntime(channel.id).soundId;
    return soundId ? [soundId] : [];
  });
}

function getSessionChannelIds(sessionId: PlaybackSessionId): string[] {
  return (
    getPlaybackSession(sessionId)?.channels.map((channel) => channel.id) ?? []
  );
}

function assertNoOrphanedSounds(
  soundIds: string[],
  ctx: PlaybackActionContext,
  sessionId: PlaybackSessionId
): void {
  const orphanedSoundIds = soundIds.filter((soundId) =>
    ctx.audio.hasSound(soundId)
  );
  if (orphanedSoundIds.length > 0) {
    throw new Error(
      `Orphaned ${sessionId} sounds after deactivation: ${orphanedSoundIds.join(
        ", "
      )}`
    );
  }
}

const PLAYBACK_MODE_LABELS = {
  dj: "DJ",
  multiple: "Multiple",
  single: "Single",
} satisfies Record<PlaybackSessionId, string>;

async function getReadyPlaybackSession(
  sessionId: PlaybackSessionId
): Promise<PlaybackSessionRecord> {
  await playbackSessionsCollection.stateWhenReady();
  const session = getPlaybackSession(sessionId);
  if (!session) {
    throw new Error(
      `${PLAYBACK_MODE_LABELS[sessionId]} playback session is not ready`
    );
  }
  return session;
}

async function prepareReadyPlaybackSession(
  sessionId: PlaybackSessionId,
  ctx: PlaybackActionContext
): Promise<PlaybackSessionRecord> {
  const session = await getReadyPlaybackSession(sessionId);
  await ensureMainAudioSettingsApplied(ctx);
  return session;
}

function getManagedRestoreChannels(
  sessionId: ManagedPlaybackSessionId,
  session: PlaybackSessionRecord
): PlaybackSessionRecord["channels"] {
  if (sessionId === "single") {
    return session.channels.filter(
      (channel) => channel.id === session.activeChannelId
    );
  }
  return session.channels;
}

function restoreManagedModeSounds(
  sessionId: ManagedPlaybackSessionId,
  session: PlaybackSessionRecord,
  ctx: PlaybackActionContext
): void {
  for (const channel of getManagedRestoreChannels(sessionId, session)) {
    if (!channel.radio) {
      continue;
    }
    if (getPlaybackChannelRuntime(channel.id).soundId) {
      continue;
    }
    createManagedSound(sessionId, channel.id, channel.radio, undefined, ctx);
  }
}

async function activateManagedMode(
  sessionId: ManagedPlaybackSessionId,
  ctx: PlaybackActionContext
): Promise<void> {
  const session = await prepareReadyPlaybackSession(sessionId, ctx);
  restoreManagedModeSounds(sessionId, session, ctx);
  applySessionMasterVolume(sessionId, ctx);
}

async function deactivateManagedMode(
  sessionId: PlaybackSessionId,
  ctx: PlaybackActionContext,
  fadeOutSound: FadeOutSound,
  fadeOutDurationMs: number
): Promise<void> {
  const soundIds = getSessionSoundIds(sessionId);
  await fadeOutSoundIds(soundIds, fadeOutSound, fadeOutDurationMs);

  const session = getPlaybackSession(sessionId);
  for (const channel of session?.channels ?? []) {
    cleanupManagedChannel(channel.id, ctx);
    resetPlaybackChannelRuntime(channel.id);
  }

  assertNoOrphanedSounds(soundIds, ctx, sessionId);
}

function isRestorableDjRadio(radio: Radio | null): radio is Radio {
  return radio !== null && radio.platformMetadata?.platform !== "local-file";
}

async function restoreDjDeckRadio(
  deckId: DeckId,
  radio: Radio | null,
  deckCommands: DjDeckCommands
): Promise<void> {
  if (radio?.platformMetadata?.platform === "local-file") {
    resetDeck(deckId);
    return;
  }

  if (!isRestorableDjRadio(radio)) {
    return;
  }

  if (deckId === DECK_A_CHANNEL_ID) {
    await deckCommands.setDeckARadio(radio);
    return;
  }

  await deckCommands.setDeckBRadio(radio);
}

async function activateDjMode(ctx: PlaybackActionContext): Promise<void> {
  const session = await prepareReadyPlaybackSession("dj", ctx);
  applySessionMasterVolume("dj", ctx);
  const deckCommands = createDjDeckCommands(ctx);

  const deckA = session.channels.find(
    (channel) => channel.id === DECK_A_CHANNEL_ID
  );
  const deckB = session.channels.find(
    (channel) => channel.id === DECK_B_CHANNEL_ID
  );

  await restoreDjDeckRadio(
    DECK_A_CHANNEL_ID,
    deckA?.radio ?? null,
    deckCommands
  );
  await restoreDjDeckRadio(
    DECK_B_CHANNEL_ID,
    deckB?.radio ?? null,
    deckCommands
  );

  setMasterVolume(session.masterVolume, ctx);
  setCrossfadePosition(session.crossfadePosition, ctx);
}

async function deactivateDjMode(
  ctx: PlaybackActionContext,
  fadeOutSound: FadeOutSound,
  fadeOutDurationMs: number
): Promise<void> {
  const soundIds = getSessionSoundIds("dj");
  const channelIds = getSessionChannelIds("dj");
  await fadeOutSoundIds(soundIds, fadeOutSound, fadeOutDurationMs);
  await cleanupAudioOnly(ctx);
  for (const channelId of channelIds) {
    resetPlaybackChannelRuntime(channelId);
  }
  clearDjErrorSurface();
  assertNoOrphanedSounds(soundIds, ctx, "dj");
}

function createManagedModeLifecycle(
  sessionId: ManagedPlaybackSessionId,
  ctx: PlaybackActionContext,
  fadeOutSound: FadeOutSound,
  fadeOutDurationMs: number
): ModeLifecycle {
  return createLifecycle(
    () => activateManagedMode(sessionId, ctx),
    () => deactivateManagedMode(sessionId, ctx, fadeOutSound, fadeOutDurationMs)
  );
}

export function createModeLifecycleRegistry({
  ctx = getDefaultPlaybackActionContext(),
  fadeOutDurationMs = MODE_FADE_OUT_DURATION_MS,
  fadeOutSound = fadeOut,
}: CreateModeLifecycleRegistryOptions = {}): Record<
  PlaybackSessionId,
  ModeLifecycle
> {
  return {
    single: createManagedModeLifecycle(
      "single",
      ctx,
      fadeOutSound,
      fadeOutDurationMs
    ),
    multiple: createManagedModeLifecycle(
      "multiple",
      ctx,
      fadeOutSound,
      fadeOutDurationMs
    ),
    dj: createLifecycle(
      () => activateDjMode(ctx),
      () => deactivateDjMode(ctx, fadeOutSound, fadeOutDurationMs)
    ),
  };
}

function defaultCommitMode(mode: PlaybackSessionId): void {
  updatePlayerSettings((player) => ({
    mode,
    single: {
      transitionDuration:
        player.single?.transitionDuration ?? DEFAULT_TRANSITION_DURATION,
    },
  }));
}

export function createModeManager({
  initialMode = null,
  lifecycles = createModeLifecycleRegistry(),
  commitMode = defaultCommitMode,
}: CreateModeManagerOptions = {}): ModeManager {
  let snapshot: ModeTransitionSnapshot = {
    currentMode: initialMode,
    requestedMode: null,
    phase: initialMode ? "active" : "inactive",
    error: null,
  };
  const listeners = new Set<() => void>();

  function emit(nextSnapshot: Partial<ModeTransitionSnapshot>): void {
    snapshot = { ...snapshot, ...nextSnapshot };
    for (const listener of listeners) {
      listener();
    }
  }

  async function restorePreviousMode(
    previousMode: PlaybackSessionId | null
  ): Promise<void> {
    if (!previousMode) {
      emit({ currentMode: null, phase: "inactive", requestedMode: null });
      return;
    }
    await lifecycles[previousMode].activate();
    emit({
      currentMode: previousMode,
      phase: "active",
      requestedMode: null,
    });
  }

  return {
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async activateInitialMode(mode: PlaybackSessionId): Promise<void> {
      if (snapshot.currentMode === mode || snapshot.phase !== "inactive") {
        return;
      }
      emit({ requestedMode: mode, phase: "activating", error: null });
      try {
        await lifecycles[mode].activate();
        emit({ currentMode: mode, requestedMode: null, phase: "active" });
      } catch (error) {
        emit({
          requestedMode: null,
          phase: "inactive",
          error: getErrorMessage(error),
        });
        throw error;
      }
    },
    async switchTo(nextMode: PlaybackSessionId): Promise<void> {
      if (snapshot.currentMode === nextMode && snapshot.phase === "active") {
        return;
      }
      if (
        snapshot.phase === "activating" ||
        snapshot.phase === "deactivating"
      ) {
        throw new Error("Mode transition in progress");
      }

      const previousMode = snapshot.currentMode;
      emit({ requestedMode: nextMode, phase: "deactivating", error: null });

      try {
        if (previousMode) {
          await lifecycles[previousMode].deactivate();
        }

        emit({ phase: "activating" });
        await lifecycles[nextMode].activate();

        commitMode(nextMode);
        emit({
          currentMode: nextMode,
          requestedMode: null,
          phase: "active",
          error: null,
        });
      } catch (error) {
        const message = getErrorMessage(error);
        try {
          await restorePreviousMode(previousMode);
        } catch (rollbackError) {
          emit({
            currentMode: previousMode,
            requestedMode: null,
            phase: previousMode ? "active" : "inactive",
            error: getErrorMessage(rollbackError),
          });
        }
        emit({ error: message });
        throw error;
      }
    },
  };
}

export const modeManager = createModeManager();

export function useModeTransitionSnapshot(): ModeTransitionSnapshot {
  return useSyncExternalStore(
    modeManager.subscribe,
    modeManager.getSnapshot,
    modeManager.getSnapshot
  );
}

export function isPlaybackSessionId(value: string): value is PlaybackSessionId {
  return PLAYBACK_SESSION_IDS.some((sessionId) => sessionId === value);
}
