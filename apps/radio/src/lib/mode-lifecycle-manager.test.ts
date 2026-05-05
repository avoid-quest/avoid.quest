import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type PlaybackSessionId,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { resetAllPlaybackRuntime } from "@/lib/stores/playback-runtime-store";
import {
  createModeManager,
  synchronizePlaybackMode,
} from "./mode-lifecycle-manager";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

function insertPlaybackSession(id: PlaybackSessionId) {
  playbackSessionsCollection.insert({
    id,
    channels: [],
    masterVolume: 1,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    activeChannelId: null,
  });
}

beforeEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
});

afterEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
});

describe("mode lifecycle manager", () => {
  test("routes startup mode activation through the lifecycle boundary", async () => {
    insertPlaybackSession("multiple");
    const activateInitialMode = mock(async (_mode: string) => undefined);
    const switchTo = mock(async (_mode: string) => undefined);
    const manager = {
      getSnapshot: () => ({
        currentMode: null,
        requestedMode: null,
        phase: "inactive" as const,
        error: null,
      }),
      subscribe: mock((_listener: () => void) => () => undefined),
      activateInitialMode,
      switchTo,
    };

    await synchronizePlaybackMode("multiple", manager);

    expect(activateInitialMode).toHaveBeenCalledWith("multiple");
    expect(switchTo).not.toHaveBeenCalled();
  });

  test("waits for startup playback session readiness before activating mode", async () => {
    const activateInitialMode = mock(async (_mode: string) => undefined);
    const switchTo = mock(async (_mode: string) => undefined);
    const getSnapshot = mock(() => ({
      currentMode: null,
      requestedMode: null,
      phase: "inactive" as const,
      error: null,
    }));
    const manager = {
      getSnapshot,
      subscribe: mock((_listener: () => void) => () => undefined),
      activateInitialMode,
      switchTo,
    };

    const activation = synchronizePlaybackMode("multiple", manager);
    await Promise.resolve();
    await Promise.resolve();

    expect(getSnapshot).not.toHaveBeenCalled();
    expect(activateInitialMode).not.toHaveBeenCalled();

    insertPlaybackSession("multiple");
    await activation;

    expect(activateInitialMode).toHaveBeenCalledWith("multiple");
    expect(switchTo).not.toHaveBeenCalled();
  });

  test("serializes concurrent mode switch requests", async () => {
    const releaseActivation = Promise.withResolvers<void>();
    const manager = createModeManager({
      initialMode: "single",
      lifecycles: {
        single: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: mock(async () => {
            await releaseActivation.promise;
          }),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        dj: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
      commitMode: mock(() => undefined),
    });

    const firstSwitch = manager.switchTo("multiple");
    const rejectedSwitch = manager.switchTo("dj");

    await expect(rejectedSwitch).rejects.toThrow("Mode transition in progress");
    releaseActivation.resolve();
    await firstSwitch;

    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "multiple",
      phase: "active",
    });
  });

  test("rolls back to the previous active mode when activation fails", async () => {
    const commitMode = mock((_mode: string) => undefined);
    const singleActivate = mock(async () => undefined);
    const manager = createModeManager({
      initialMode: "single",
      lifecycles: {
        single: {
          activate: singleActivate,
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: mock(() => Promise.reject(new Error("activation failed"))),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        dj: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
      commitMode,
    });

    await expect(manager.switchTo("multiple")).rejects.toThrow(
      "activation failed"
    );

    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      phase: "active",
    });
    expect(singleActivate).toHaveBeenCalledTimes(1);
    expect(commitMode).not.toHaveBeenCalled();
  });

  test("keeps failed initial activation retryable without committing mode state", async () => {
    let shouldFailActivation = true;
    const activateSingle = mock(() => {
      if (shouldFailActivation) {
        shouldFailActivation = false;
        return Promise.reject(new Error("session is not ready"));
      }
      return Promise.resolve();
    });
    const commitMode = mock((_mode: string) => undefined);
    const manager = createModeManager({
      lifecycles: {
        single: {
          activate: activateSingle,
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        dj: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
      commitMode,
    });

    await expect(manager.activateInitialMode("single")).rejects.toThrow(
      "session is not ready"
    );

    expect(manager.getSnapshot()).toMatchObject({
      currentMode: null,
      phase: "inactive",
      error: "session is not ready",
    });
    expect(commitMode).not.toHaveBeenCalled();

    await manager.activateInitialMode("single");

    expect(activateSingle).toHaveBeenCalledTimes(2);
    expect(commitMode).not.toHaveBeenCalled();
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      phase: "active",
      error: null,
    });
  });
});
