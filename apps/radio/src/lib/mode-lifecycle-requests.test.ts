import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type PlaybackSessionId,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { settingsCollection } from "@/lib/collections/settings";
import { createModeLifecycleRequests } from "./mode-lifecycle-requests";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

async function resetSettings() {
  await settingsCollection.stateWhenReady();

  for (const settingsId of Array.from(settingsCollection.state.keys())) {
    settingsCollection.delete(settingsId);
  }
}

function insertPlaybackSession(id: PlaybackSessionId) {
  playbackSessionsCollection.insert({
    activeChannelId: null,
    channels: [],
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    id,
    masterVolume: 1,
  });
}

function insertSettings(mode: PlaybackSessionId) {
  settingsCollection.insert({
    id: "app-settings",
    player: {
      mode,
      restoreStateOnLoad: true,
    },
  });
}

beforeEach(async () => {
  await resetPlaybackSessions();
  await resetSettings();
});

describe("mode lifecycle requests", () => {
  test("ignores invalid mode request values", async () => {
    const switchTo = mock(async (_mode: PlaybackSessionId) => undefined);
    const requests = createModeLifecycleRequests({
      manager: {
        activateInitialMode: mock(
          async (_mode: PlaybackSessionId) => undefined
        ),
        getSnapshot: mock(() => ({
          currentMode: "single" as const,
          error: null,
          phase: "active" as const,
          requestedMode: null,
        })),
        subscribe: mock((_listener: () => void) => () => undefined),
        switchTo,
      },
    });

    await requests.requestMode("");
    await requests.requestMode("unknown");

    expect(switchTo).not.toHaveBeenCalled();
  });

  test("routes valid mode request values through the manager", async () => {
    const switchTo = mock(async (_mode: PlaybackSessionId) => undefined);
    const requests = createModeLifecycleRequests({
      manager: {
        activateInitialMode: mock(
          async (_mode: PlaybackSessionId) => undefined
        ),
        getSnapshot: mock(() => ({
          currentMode: "single" as const,
          error: null,
          phase: "active" as const,
          requestedMode: null,
        })),
        subscribe: mock((_listener: () => void) => () => undefined),
        switchTo,
      },
    });

    await requests.requestMode("multiple");

    expect(switchTo).toHaveBeenCalledWith("multiple");
  });

  test("does not re-request the mode already being switched to", async () => {
    const switchTo = mock(async (_mode: PlaybackSessionId) => undefined);
    const requests = createModeLifecycleRequests({
      manager: {
        activateInitialMode: mock(
          async (_mode: PlaybackSessionId) => undefined
        ),
        getSnapshot: mock(() => ({
          currentMode: "single" as const,
          error: null,
          phase: "deactivating" as const,
          requestedMode: "node" as const,
        })),
        subscribe: mock((_listener: () => void) => () => undefined),
        switchTo,
      },
    });

    await requests.requestMode("node");
    await requests.requestMode("dj");

    expect(switchTo).toHaveBeenCalledTimes(1);
    expect(switchTo).toHaveBeenCalledWith("dj");
  });

  test("cancels stale runtime synchronization after settings change", async () => {
    insertPlaybackSession("multiple");
    insertSettings("dj");
    const activateInitialMode = mock(
      async (_mode: PlaybackSessionId) => undefined
    );
    const switchTo = mock(async (_mode: PlaybackSessionId) => undefined);
    const requests = createModeLifecycleRequests({
      manager: {
        activateInitialMode,
        getSnapshot: mock(() => ({
          currentMode: "single" as const,
          error: null,
          phase: "active" as const,
          requestedMode: null,
        })),
        subscribe: mock((_listener: () => void) => () => undefined),
        switchTo,
      },
    });

    await requests.synchronizeMode("multiple");

    expect(activateInitialMode).not.toHaveBeenCalled();
    expect(switchTo).not.toHaveBeenCalled();
  });
});
