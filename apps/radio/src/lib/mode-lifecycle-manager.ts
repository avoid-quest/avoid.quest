import { useSyncExternalStore } from "react";
import { fadeOut } from "@/lib/audio";
import {
  getPlaybackSession,
  PLAYBACK_SESSION_IDS,
  type PlaybackSessionId,
  playbackSessionsCollection,
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
} from "@/lib/collections/playback-sessions";
import { updatePlayerSettings } from "@/lib/collections/settings";
import { DEFAULT_TRANSITION_DURATION } from "@/lib/const";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "@/lib/playback-action-context";
import {
  getPlaybackRuntimeChannelIds,
  resetPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { createDjModeLifecycleWorkflow } from "./dj-mode-lifecycle-workflow.js";
import { createManagedPlaybackSessionWorkflow } from "./managed-playback-session-workflow.js";
import {
  cleanupOrphanedSounds,
  getRuntimeSoundIds,
} from "./mode-lifecycle-cleanup.js";

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
const MODE_TRANSITION_ERROR_MESSAGE = "Mode could not be changed. Try again.";
const MODE_STARTUP_ERROR_MESSAGE = "Playback mode could not start. Try again.";

function hasUserMessage(error: unknown): error is { userMessage: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "userMessage" in error &&
    typeof error.userMessage === "string"
  );
}

function getUserFacingErrorMessage(
  error: unknown,
  fallback = MODE_TRANSITION_ERROR_MESSAGE
): string {
  if (hasUserMessage(error)) {
    return error.userMessage;
  }
  return fallback;
}

async function waitForPlaybackSession(mode: PlaybackSessionId): Promise<void> {
  await playbackSessionsCollection.stateWhenReady();
  if (getPlaybackSession(mode)) {
    return;
  }

  await new Promise<void>((resolve) => {
    const subscription = playbackSessionsCollection.subscribeChanges(() => {
      if (!getPlaybackSession(mode)) {
        return;
      }
      subscription.unsubscribe();
      resolve();
    });
  });
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

function getModeRuntimeCleanupChannelIds(
  sessionId: PlaybackSessionId
): string[] {
  const persistedChannelIds =
    getPlaybackSession(sessionId)?.channels.map((channel) => channel.id) ?? [];
  const runtimeChannelIds = getPlaybackRuntimeChannelIds().filter((channelId) =>
    isRuntimeChannelOwnedByMode(sessionId, channelId)
  );
  return Array.from(new Set([...persistedChannelIds, ...runtimeChannelIds]));
}

function finalizeModeRuntimeCleanup(
  sessionId: PlaybackSessionId,
  channelIds: string[],
  soundIds: string[],
  ctx: PlaybackActionContext
): void {
  for (const channelId of channelIds) {
    ctx.channels.deactivate(channelId);
    resetPlaybackChannelRuntime(channelId);
  }
  cleanupOrphanedSounds(soundIds, ctx, sessionId);
}

function isRuntimeChannelOwnedByMode(
  sessionId: PlaybackSessionId,
  channelId: string
): boolean {
  if (sessionId === "single") {
    return (
      channelId === SINGLE_ACTIVE_CHANNEL_ID ||
      channelId === SINGLE_STANDBY_CHANNEL_ID
    );
  }
  if (sessionId === "multiple") {
    return channelId.startsWith("multi:");
  }
  return false;
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
      const channelIds = getModeRuntimeCleanupChannelIds(sessionId);
      const soundIds = getRuntimeSoundIds(channelIds);
      await workflow.deactivate();
      finalizeModeRuntimeCleanup(sessionId, channelIds, soundIds, ctx);
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
  let transitionQueue = Promise.resolve();
  const listeners = new Set<() => void>();

  function emit(nextSnapshot: Partial<ModeTransitionSnapshot>): void {
    snapshot = { ...snapshot, ...nextSnapshot };
    for (const listener of listeners) {
      listener();
    }
  }

  async function restorePreviousMode(
    previousMode: PlaybackSessionId | null,
    activeModeToDeactivate: PlaybackSessionId | null = null
  ): Promise<void> {
    if (activeModeToDeactivate) {
      await lifecycles[activeModeToDeactivate].deactivate();
    }
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

  async function rollbackModeSwitch(
    previousMode: PlaybackSessionId | null,
    activeModeToDeactivate: PlaybackSessionId | null
  ): Promise<void> {
    try {
      await restorePreviousMode(previousMode, activeModeToDeactivate);
    } catch (rollbackError) {
      emit({
        currentMode: previousMode,
        requestedMode: null,
        phase: previousMode ? "active" : "inactive",
        error: getUserFacingErrorMessage(rollbackError),
      });
    }
  }

  async function switchMode(nextMode: PlaybackSessionId): Promise<void> {
    if (snapshot.currentMode === nextMode && snapshot.phase === "active") {
      return;
    }

    const previousMode = snapshot.currentMode;
    let activatedNextMode = false;
    let nextModeActivationStarted = false;
    emit({ requestedMode: nextMode, phase: "deactivating", error: null });

    try {
      if (previousMode) {
        await lifecycles[previousMode].deactivate();
      }

      emit({ phase: "activating" });
      nextModeActivationStarted = true;
      await lifecycles[nextMode].activate();
      activatedNextMode = true;

      commitMode(nextMode);
      emit({
        currentMode: nextMode,
        requestedMode: null,
        phase: "active",
        error: null,
      });
    } catch (error) {
      const message = getUserFacingErrorMessage(error);
      await rollbackModeSwitch(
        previousMode,
        activatedNextMode || nextModeActivationStarted ? nextMode : null
      );
      emit({ error: message });
      throw error;
    }
  }

  function enqueueTransition<T>(run: () => Promise<T>): Promise<T> {
    const transition = transitionQueue.then(run, run);
    transitionQueue = transition.then(
      () => undefined,
      () => undefined
    );
    return transition;
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
    activateInitialMode(mode: PlaybackSessionId): Promise<void> {
      return enqueueTransition(async () => {
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
            error: getUserFacingErrorMessage(error, MODE_STARTUP_ERROR_MESSAGE),
          });
          throw error;
        }
      });
    },
    switchTo(nextMode: PlaybackSessionId): Promise<void> {
      return enqueueTransition(() => switchMode(nextMode));
    },
  };
}

export const modeManager = createModeManager();

export async function synchronizePlaybackMode(
  mode: PlaybackSessionId,
  manager: ModeManager = modeManager
): Promise<void> {
  await waitForPlaybackSession(mode);

  const snapshot = manager.getSnapshot();
  if (snapshot.currentMode === mode) {
    return;
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
