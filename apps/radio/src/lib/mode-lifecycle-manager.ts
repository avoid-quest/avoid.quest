import { fadeOut } from "@/lib/audio";
import {
  getPlaybackSession,
  type PlaybackSessionId,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { updatePlayerSettings } from "@/lib/collections/settings";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "@/lib/playback-action-context";
import { createDjModeLifecycleWorkflow } from "./dj-mode-lifecycle-workflow.js";
import { getMultiplePlayback } from "./multiple-playback.js";
import { getNodePlayback } from "./node-playback.js";
import { resetManagedAudioState } from "./playback-actions-shared.js";
import { getSinglePlayback } from "./single-playback.js";

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

export async function waitForPlaybackSession(
  mode: PlaybackSessionId
): Promise<void> {
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
  const single = getSinglePlayback({
    ctx,
    fadeOutDurationMs,
    fadeOutSound,
  });
  const multiple = getMultiplePlayback({
    ctx,
    fadeOutDurationMs,
    fadeOutSound,
  });
  const node = getNodePlayback({
    ctx,
    fadeOutDurationMs,
    fadeOutSound,
  });
  return {
    dj: createLifecycle(
      () => djWorkflow.activate(),
      () => djWorkflow.deactivate()
    ),
    multiple: createLifecycle(multiple.activate, multiple.deactivate),
    node: createLifecycle(node.activate, node.deactivate),
    single: createLifecycle(single.activate, single.deactivate),
  };
}

function defaultCommitMode(mode: PlaybackSessionId): void {
  updatePlayerSettings(() => ({ mode }));
}

export function createModeManager({
  initialMode = null,
  lifecycles = createModeLifecycleRegistry(),
  commitMode = defaultCommitMode,
}: CreateModeManagerOptions = {}): ModeManager {
  let snapshot: ModeTransitionSnapshot = {
    currentMode: initialMode,
    error: null,
    phase: initialMode ? "active" : "inactive",
    requestedMode: null,
  };
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
    let cleanupError: unknown = null;
    if (activeModeToDeactivate) {
      try {
        await lifecycles[activeModeToDeactivate].deactivate();
      } catch (error) {
        cleanupError = error;
      }
    }
    if (!previousMode) {
      emit({ currentMode: null, phase: "inactive", requestedMode: null });
      if (cleanupError) {
        throw cleanupError;
      }
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
        error: getUserFacingErrorMessage(rollbackError),
        phase: previousMode ? "active" : "inactive",
        requestedMode: null,
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
    emit({ error: null, phase: "deactivating", requestedMode: nextMode });

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
        error: null,
        phase: "active",
        requestedMode: null,
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

  function isTransitionInProgress(): boolean {
    return snapshot.phase === "activating" || snapshot.phase === "deactivating";
  }

  return {
    activateInitialMode(mode: PlaybackSessionId): Promise<void> {
      return (async () => {
        if (snapshot.currentMode === mode || snapshot.phase !== "inactive") {
          return;
        }
        emit({ error: null, phase: "activating", requestedMode: mode });
        try {
          await lifecycles[mode].activate();
          emit({ currentMode: mode, phase: "active", requestedMode: null });
        } catch (error) {
          emit({
            error: getUserFacingErrorMessage(error, MODE_STARTUP_ERROR_MESSAGE),
            phase: "inactive",
            requestedMode: null,
          });
          throw error;
        }
      })();
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    switchTo(nextMode: PlaybackSessionId): Promise<void> {
      if (isTransitionInProgress()) {
        return Promise.reject(new Error("Mode transition in progress"));
      }
      return switchMode(nextMode);
    },
  };
}

export const modeManager = createModeManager();

export function resetPlaybackLifecycleState(
  ctx = getDefaultPlaybackActionContext()
): void {
  resetManagedAudioState(ctx);
}
