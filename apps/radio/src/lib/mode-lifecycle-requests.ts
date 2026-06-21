import {
  PLAYBACK_SESSION_IDS,
  type PlaybackSessionId,
} from "@/lib/collections/playback-sessions";
import { getSettings, type SettingsRecord } from "@/lib/collections/settings";
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
    async requestMode(value: string) {
      if (!isPlaybackSessionId(value)) {
        return;
      }

      await manager.switchTo(value);
    },
    async synchronizeMode(mode: PlaybackSessionId) {
      await waitForPlaybackSession(mode);

      const settings = getCurrentSettings();
      if (settings && settings.player.mode !== mode) {
        return;
      }

      const snapshot = manager.getSnapshot();
      if (snapshot.currentMode === mode) {
        return;
      }

      if (snapshot.currentMode === null && snapshot.phase === "inactive") {
        return manager.activateInitialMode(mode);
      }

      return manager.switchTo(mode);
    },
    resetPageLifecycleState: resetPlaybackLifecycleState,
    getTransitionSnapshot: manager.getSnapshot,
    subscribeTransitionSnapshot: manager.subscribe,
  };
}

export const modeLifecycleRequests = createModeLifecycleRequests();

function isPlaybackSessionId(value: string): value is PlaybackSessionId {
  return PLAYBACK_SESSION_IDS.some((sessionId) => sessionId === value);
}
