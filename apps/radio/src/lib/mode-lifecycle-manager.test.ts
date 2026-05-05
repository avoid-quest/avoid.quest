import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { playbackSessionsCollection } from "@/lib/collections/playback-sessions";
import { resetAllPlaybackRuntime } from "@/lib/stores/playback-runtime-store";
import { createModeManager } from "./mode-lifecycle-manager";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
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
    const failedActivation = mock(() =>
      Promise.reject(new Error("session is not ready"))
    );
    const successfulActivation = mock(async () => undefined);
    const commitMode = mock((_mode: string) => undefined);
    const manager = createModeManager({
      lifecycles: {
        single: {
          activate: failedActivation,
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: successfulActivation,
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

    await manager.activateInitialMode("multiple");

    expect(failedActivation).toHaveBeenCalledTimes(1);
    expect(successfulActivation).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "multiple",
      phase: "active",
      error: null,
    });
  });
});
