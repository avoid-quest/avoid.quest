import { AppError, captureError } from "@avoid.quest/error";
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
import type { DjModeLifecycleWorkflow } from "./dj-mode-lifecycle-workflow.js";
import { DjWorkflowLoadError } from "./dj-workflow-load-error";
import { isPlaybackActionError } from "./playback-action-errors";
import { resetManagedAudioState } from "./playback-actions-shared.js";
import { getSinglePlayback } from "./single-playback.js";

export type ModePhase = "inactive" | "activating" | "active" | "deactivating";

export type ModeLifecycle = {
  /** Load code before stopping the current mode; must not change playback. */
  prepare?: () => Promise<void>;
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
  loadDjWorkflow?: () => Promise<
    typeof import("./dj-mode-lifecycle-workflow.js")
  >;
};

type CreateModeManagerOptions = {
  initialMode?: PlaybackSessionId | null;
  lifecycles?: Record<PlaybackSessionId, ModeLifecycle>;
  commitMode?: (mode: PlaybackSessionId) => void;
};

export type SwitchModeOptions = {
  /**
   * Whether to write the mode to settings once it is active (the default).
   * False follows a mode the settings already name: a legacy record the
   * settings step could not rewrite would fail the write and roll back.
   */
  commit?: boolean;
};

export type ModeManager = {
  getSnapshot: () => ModeTransitionSnapshot;
  subscribe: (listener: () => void) => () => void;
  activateInitialMode: (mode: PlaybackSessionId) => Promise<void>;
  switchTo: (
    nextMode: PlaybackSessionId,
    options?: SwitchModeOptions
  ) => Promise<void>;
  /** Resolves, never rejects, once the transition in flight has finished. */
  whenSettled: () => Promise<void>;
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
  loadDjWorkflow = () => import("./dj-mode-lifecycle-workflow.js"),
}: CreateModeLifecycleRegistryOptions = {}): Record<
  PlaybackSessionId,
  ModeLifecycle
> {
  let djWorkflow: DjModeLifecycleWorkflow | undefined;
  let djModule: ReturnType<typeof loadDjWorkflow> | undefined;
  const loadDj = () => {
    // Retain failures too: retrying a fixed URL cannot reliably recover the
    // module graph across browsers or deployments. Only an explicit reload
    // starts over. Vite's preload helper rethrows into this catch.
    djModule ??= loadDjWorkflow().catch((error: unknown) => {
      throw new DjWorkflowLoadError(error);
    });
    return djModule;
  };
  const single = getSinglePlayback({
    ctx,
    fadeOutDurationMs,
    fadeOutSound,
  });
  const loadNode = async () =>
    (await import("./node-playback.js")).getNodePlayback({
      ctx,
      fadeOutDurationMs,
      fadeOutSound,
    });
  return {
    dj: {
      ...createLifecycle(
        async () => {
          const { createDjModeLifecycleWorkflow } = await loadDj();
          djWorkflow ??= createDjModeLifecycleWorkflow({
            ctx,
            fadeOutDurationMs,
            fadeOutSound,
          });
          await djWorkflow.activate();
        },
        async () => {
          // Rollback must never fetch code for a workflow that never existed.
          await djWorkflow?.deactivate();
        }
      ),
      async prepare() {
        await loadDj();
      },
    },
    node: createLifecycle(
      async () => (await loadNode()).activate(),
      async () => (await loadNode()).deactivate()
    ),
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
  let settled: Promise<void> = Promise.resolve();

  function track(transition: Promise<void>): Promise<void> {
    settled = transition.then(
      () => undefined,
      () => undefined
    );
    return transition;
  }

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
      if (!isPlaybackActionError(rollbackError)) {
        captureError(rollbackError, {
          operation: "restorePreviousMode",
          surface: "ui",
        });
      }
      emit({
        currentMode: previousMode,
        error: getUserFacingErrorMessage(rollbackError),
        phase: previousMode ? "active" : "inactive",
        requestedMode: null,
      });
    }
  }

  async function switchMode(
    nextMode: PlaybackSessionId,
    { commit = true }: SwitchModeOptions
  ): Promise<void> {
    if (snapshot.currentMode === nextMode && snapshot.phase === "active") {
      return;
    }

    const previousMode = snapshot.currentMode;
    let activatedNextMode = false;
    let nextModeActivationStarted = false;
    let preparationCompleted = false;
    emit({ error: null, phase: "activating", requestedMode: nextMode });

    try {
      await lifecycles[nextMode].prepare?.();
      preparationCompleted = true;
      emit({ phase: "deactivating" });
      if (previousMode) {
        await lifecycles[previousMode].deactivate();
      }

      emit({ phase: "activating" });
      nextModeActivationStarted = true;
      await lifecycles[nextMode].activate();
      activatedNextMode = true;

      if (commit) {
        commitMode(nextMode);
      }
      emit({
        currentMode: nextMode,
        error: null,
        phase: "active",
        requestedMode: null,
      });
    } catch (error) {
      const message = getUserFacingErrorMessage(error);
      if (!preparationCompleted) {
        emit({
          error: message,
          phase: previousMode ? "active" : "inactive",
          requestedMode: null,
        });
        throw error;
      }
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
      if (snapshot.currentMode === mode || snapshot.phase !== "inactive") {
        return Promise.resolve();
      }
      return track(
        (async () => {
          emit({ error: null, phase: "activating", requestedMode: mode });
          try {
            await lifecycles[mode].activate();
            emit({ currentMode: mode, phase: "active", requestedMode: null });
          } catch (error) {
            emit({
              error: getUserFacingErrorMessage(
                error,
                MODE_STARTUP_ERROR_MESSAGE
              ),
              phase: "inactive",
              requestedMode: null,
            });
            throw error;
          }
        })()
      );
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
    switchTo(
      nextMode: PlaybackSessionId,
      options: SwitchModeOptions = {}
    ): Promise<void> {
      if (isTransitionInProgress()) {
        return Promise.reject(
          new AppError({
            category: "validation",
            code: "MODE_TRANSITION_IN_PROGRESS",
            safeMessage: "Mode transition in progress",
          })
        );
      }
      return track(switchMode(nextMode, options));
    },
    whenSettled() {
      return settled;
    },
  };
}

export const modeManager = createModeManager();

export function resetPlaybackLifecycleState(
  ctx = getDefaultPlaybackActionContext()
): void {
  resetManagedAudioState(ctx);
}
