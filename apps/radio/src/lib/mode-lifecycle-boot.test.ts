import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: spy on captureError without replacing the module graph
import * as errorSdk from "@avoid.quest/error";
import {
  type PlaybackSessionId,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { runModeLifecycleSynchronization } from "./mode-lifecycle-boot";
import { createModeLifecycleRequests } from "./mode-lifecycle-requests";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();
  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
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

beforeEach(async () => {
  await resetPlaybackSessions();
});

describe("runModeLifecycleSynchronization", () => {
  test("tags mode when the lifecycle module fails to load", async () => {
    const capture = spyOn(errorSdk, "captureError").mockReturnValue(undefined);
    const rejection = "synthetic-lifecycle-import-rejection";
    try {
      await expect(
        runModeLifecycleSynchronization("dj", () => Promise.reject(rejection))
      ).rejects.toBe(rejection);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledWith(
        rejection,
        expect.objectContaining({
          operation: "loadModeLifecycle",
          surface: "ui",
          tags: { mode: "dj" },
        })
      );
    } finally {
      capture.mockRestore();
    }
  });

  test("lets synchronizeMode own reporting for a synthetic activation rejection", async () => {
    insertPlaybackSession("node");
    const failure = new Error("Synthetic synchronizeMode activation failure");
    const capture = spyOn(errorSdk, "captureError").mockReturnValue(undefined);
    const requests = createModeLifecycleRequests({
      getCurrentSettings: () => null,
      manager: {
        activateInitialMode: () => Promise.reject(failure),
        getSnapshot: () => ({
          currentMode: null,
          error: null,
          phase: "inactive",
          requestedMode: null,
        }),
        subscribe: () => () => undefined,
        switchTo: mock(async () => undefined),
        whenSettled: mock(async () => undefined),
      },
    });

    try {
      await expect(
        runModeLifecycleSynchronization("node", async () => requests)
      ).rejects.toBe(failure);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({
          operation: "synchronizeMode",
          surface: "ui",
          tags: { mode: "node" },
        })
      );
      expect(capture.mock.calls[0]?.[1]?.operation).not.toBe(
        "loadModeLifecycle"
      );
    } finally {
      capture.mockRestore();
    }
  });
});
