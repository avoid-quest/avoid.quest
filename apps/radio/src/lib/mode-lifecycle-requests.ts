import {
  PLAYBACK_SESSION_IDS,
  type PlaybackSessionId,
} from "@/lib/collections/playback-sessions";
import { getSettings, type SettingsRecord } from "@/lib/collections/settings";
import { normalizePlayerMode } from "@/lib/normalize-player-mode";
import {
  type ModeManager,
  type ModeTransitionSnapshot,
  modeManager,
  resetPlaybackLifecycleState,
  waitForPlaybackSession,
} from "./mode-lifecycle-manager";
import type { PlaybackActionContext } from "./playback-action-context";

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

      await manager.switchTo(value);
    },
    resetPageLifecycleState: resetPlaybackLifecycleState,
    subscribeTransitionSnapshot: manager.subscribe,
    async synchronizeMode(mode: PlaybackSessionId) {
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
        return manager.activateInitialMode(mode);
      }

      return manager.switchTo(mode, { commit: false });
    },
  };
}

export const modeLifecycleRequests = createModeLifecycleRequests();

function isPlaybackSessionId(value: string): value is PlaybackSessionId {
  return PLAYBACK_SESSION_IDS.some((sessionId) => sessionId === value);
}
