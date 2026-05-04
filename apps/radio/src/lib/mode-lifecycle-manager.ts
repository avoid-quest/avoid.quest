import { useSyncExternalStore } from "react";
import { fadeOut, type Radio } from "@/lib/audio";
import {
  getPlaybackSession,
  type PlaybackSessionId,
} from "@/lib/collections/playback-sessions";
import { updatePlayerSettings } from "@/lib/collections/settings";
import { DEFAULT_TRANSITION_DURATION } from "@/lib/const";
import { clearDjErrorSurface } from "@/lib/dj/dj-error-surface";
import {
  cleanupAudioOnly,
  setCrossfadePosition,
  setDeckARadio,
  setDeckBRadio,
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
  ensureMainAudioSettingsApplied,
} from "@/lib/playback-actions-shared";
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

const MODE_IDS = ["single", "multiple", "dj"] as const;
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

async function activateManagedMode(
  sessionId: PlaybackSessionId,
  ctx: PlaybackActionContext
): Promise<void> {
  await ensureMainAudioSettingsApplied(ctx);
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

async function activateDjMode(ctx: PlaybackActionContext): Promise<void> {
  const session = getPlaybackSession("dj");
  await activateManagedMode("dj", ctx);
  if (!session) {
    return;
  }

  const deckA = session.channels.find((channel) => channel.id === "deck-a");
  const deckB = session.channels.find((channel) => channel.id === "deck-b");
  const deckARadio = deckA?.radio ?? null;
  const deckBRadio = deckB?.radio ?? null;

  if (deckARadio?.platformMetadata?.platform === "local-file") {
    resetDeck("deck-a");
  } else if (isRestorableDjRadio(deckARadio)) {
    await setDeckARadio(deckARadio);
  }

  if (deckBRadio?.platformMetadata?.platform === "local-file") {
    resetDeck("deck-b");
  } else if (isRestorableDjRadio(deckBRadio)) {
    await setDeckBRadio(deckBRadio);
  }

  setMasterVolume(session.masterVolume);
  setCrossfadePosition(session.crossfadePosition);
}

async function deactivateDjMode(
  ctx: PlaybackActionContext,
  fadeOutSound: FadeOutSound,
  fadeOutDurationMs: number
): Promise<void> {
  const soundIds = getSessionSoundIds("dj");
  const channelIds = getSessionChannelIds("dj");
  await fadeOutSoundIds(soundIds, fadeOutSound, fadeOutDurationMs);
  await cleanupAudioOnly();
  for (const channelId of channelIds) {
    resetPlaybackChannelRuntime(channelId);
  }
  clearDjErrorSurface();
  assertNoOrphanedSounds(soundIds, ctx, "dj");
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
    single: createLifecycle(
      () => activateManagedMode("single", ctx),
      () =>
        deactivateManagedMode("single", ctx, fadeOutSound, fadeOutDurationMs)
    ),
    multiple: createLifecycle(
      () => activateManagedMode("multiple", ctx),
      () =>
        deactivateManagedMode("multiple", ctx, fadeOutSound, fadeOutDurationMs)
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
}: CreateModeManagerOptions = {}) {
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

  async function restorePreviousMode(previousMode: PlaybackSessionId | null) {
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
  return MODE_IDS.includes(value as PlaybackSessionId);
}
