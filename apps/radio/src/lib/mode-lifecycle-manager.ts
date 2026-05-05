import { useSyncExternalStore } from "react";
import { fadeOut } from "@/lib/audio";
import {
  getPlaybackSession,
  PLAYBACK_SESSION_IDS,
  type PlaybackSessionId,
} from "@/lib/collections/playback-sessions";
import { updatePlayerSettings } from "@/lib/collections/settings";
import { DEFAULT_TRANSITION_DURATION } from "@/lib/const";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "@/lib/playback-action-context";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";
import { createDjModeLifecycleWorkflow } from "./dj-mode-lifecycle-workflow.js";
import { createManagedPlaybackSessionWorkflow } from "./managed-playback-session-workflow.js";

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

type ManagedPlaybackSessionId = Exclude<PlaybackSessionId, "dj">;

export type ModeManager = {
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

function createManagedModeLifecycle(
  sessionId: ManagedPlaybackSessionId,
  ctx: PlaybackActionContext,
  fadeOutSound: FadeOutSound,
  fadeOutDurationMs: number
): ModeLifecycle {
  const workflow = createManagedPlaybackSessionWorkflow(sessionId, {
    ctx,
    fadeOutDurationMs,
    fadeOutSound,
  });
  return createLifecycle(
    () => workflow.activate(),
    async () => {
      const soundIds = getSessionSoundIds(sessionId);
      await workflow.deactivate();
      assertNoOrphanedSounds(soundIds, ctx, sessionId);
    }
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
  const djWorkflow = createDjModeLifecycleWorkflow({
    ctx,
    fadeOutDurationMs,
    fadeOutSound,
  });
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
      () => djWorkflow.activate(),
      () => djWorkflow.deactivate()
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

export function synchronizePlaybackMode(
  mode: PlaybackSessionId,
  manager: ModeManager = modeManager
): Promise<void> {
  const snapshot = manager.getSnapshot();
  if (snapshot.currentMode === mode) {
    return Promise.resolve();
  }

  if (snapshot.currentMode === null && snapshot.phase === "inactive") {
    return manager.activateInitialMode(mode);
  }

  return manager.switchTo(mode);
}

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
