import { captureError } from "@avoid.quest/error";
import { toast } from "sonner";
import {
  PLAYBACK_SESSION_IDS,
  type PlaybackSessionId,
} from "@/lib/collections/playback-sessions";
import { getSettings, type SettingsRecord } from "@/lib/collections/settings";
import { normalizePlayerMode } from "@/lib/normalize-player-mode";
import { DjWorkflowLoadError } from "./dj-workflow-load-error";
import {
  type ModeManager,
  type ModeTransitionSnapshot,
  modeManager,
  resetPlaybackLifecycleState,
  waitForPlaybackSession,
} from "./mode-lifecycle-manager";
import type { PlaybackActionContext } from "./playback-action-context";
import { isPlaybackActionError } from "./playback-action-errors";

export type ModeLifecycleRequests = {
  requestMode: (value: string) => Promise<void>;
  synchronizeMode: (mode: PlaybackSessionId) => Promise<void>;
  resetPageLifecycleState: (ctx?: PlaybackActionContext) => void;
  getTransitionSnapshot: () => ModeTransitionSnapshot;
  subscribeTransitionSnapshot: (listener: () => void) => () => void;
};

type CreateModeLifecycleRequestsOptions = {
  manager?: ModeManager;
  getCurrentSettings?: () => SettingsRecord | null | undefined;
};

export function createModeLifecycleRequests({
  manager = modeManager,
  getCurrentSettings = getSettings,
}: CreateModeLifecycleRequestsOptions = {}): ModeLifecycleRequests {
  const reportedLoadFailures = new WeakSet<DjWorkflowLoadError>();
  function reportFailure(
    error: unknown,
    mode: string,
    operation: string
  ): void {
    if (error instanceof DjWorkflowLoadError) {
      if (reportedLoadFailures.has(error)) {
        return;
      }
      reportedLoadFailures.add(error);
      toast.error("Couldn't load DJ mode", {
        action: {
          label: "Reload",
          onClick: () => window.location.reload(),
        },
        description: "Reload to try DJ mode again. Reloading stops playback.",
        dismissible: false,
        duration: Number.POSITIVE_INFINITY,
        id: "dj-mode-load",
      });
    }
    if (!isPlaybackActionError(error)) {
      captureError(error, { operation, surface: "ui", tags: { mode } });
    }
  }
  return {
    getTransitionSnapshot: manager.getSnapshot,
    async requestMode(value: string) {
      if (!isPlaybackSessionId(value)) {
        return;
      }
      // Already on its way there, e.g. the renderer and the cross-tab
      // settings listener both following one legacy mode write.
      if (manager.getSnapshot().requestedMode === value) {
        return;
      }

      try {
        await manager.switchTo(value);
      } catch (error) {
        reportFailure(error, value, "requestMode");
        throw error;
      }
    },
    resetPageLifecycleState: resetPlaybackLifecycleState,
    subscribeTransitionSnapshot: manager.subscribe,
    async synchronizeMode(mode: PlaybackSessionId) {
      try {
        await waitForPlaybackSession(mode);

        const settings = getCurrentSettings();
        // The settings already name `mode`, so neither path writes them: a
        // legacy mode the settings step could not rewrite ("multiple") is
        // synchronized as its replacement.
        if (settings && normalizePlayerMode(settings.player.mode) !== mode) {
          return;
        }

        const snapshot = manager.getSnapshot();
        if (snapshot.currentMode === mode || snapshot.requestedMode === mode) {
          return;
        }

        if (snapshot.currentMode === null && snapshot.phase === "inactive") {
          return await manager.activateInitialMode(mode);
        }

        return await manager.switchTo(mode, { commit: false });
      } catch (error) {
        reportFailure(error, mode, "synchronizeMode");
        throw error;
      }
    },
  };
}

export const modeLifecycleRequests = createModeLifecycleRequests();

function isPlaybackSessionId(value: string): value is PlaybackSessionId {
  return PLAYBACK_SESSION_IDS.some((sessionId) => sessionId === value);
}
