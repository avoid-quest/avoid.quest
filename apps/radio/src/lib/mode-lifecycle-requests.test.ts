import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: observe production reporting without replacing the error module
import * as Sentry from "@sentry/core";
import { toast } from "sonner";
import {
  type PlaybackSessionId,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import {
  type SettingsRecord,
  settingsCollection,
} from "@/lib/collections/settings";
import {
  createModeLifecycleRegistry,
  createModeManager,
  type ModeLifecycle,
} from "./mode-lifecycle-manager";
import { createModeLifecycleRequests } from "./mode-lifecycle-requests";
import {
  capturePlaybackActionError,
  reportPlaybackActionError,
} from "./playback-action-errors";

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

// Another tab writing the mode, as the settings listener then sees it.
function storeMode(mode: PlaybackSessionId) {
  settingsCollection.update("app-settings", (draft) => {
    draft.player.mode = mode;
  });
}

// Let synchronization reach the manager while its transition is in flight.
function flushTasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeLifecycle(): ModeLifecycle {
  return {
    activate: mock(async () => undefined),
    deactivate: mock(async () => undefined),
    getPhase: () => "inactive",
  };
}

function createCrossTabHarness() {
  for (const mode of ["dj", "node", "single"] as const) {
    insertPlaybackSession(mode);
  }
  const preparation = Promise.withResolvers<void>();
  const preparing = Promise.withResolvers<void>();
  const lifecycles = {
    dj: {
      ...fakeLifecycle(),
      prepare: mock(() => {
        preparing.resolve();
        return preparation.promise;
      }),
    },
    node: fakeLifecycle(),
    single: fakeLifecycle(),
  };
  const commitMode = mock((_mode: PlaybackSessionId) => undefined);
  const manager = createModeManager({
    commitMode,
    initialMode: "single",
    lifecycles,
  });
  const switchTo = spyOn(manager, "switchTo");
  const requests = createModeLifecycleRequests({ manager });
  return {
    commitMode,
    lifecycles,
    manager,
    preparation,
    preparing: preparing.promise,
    requests,
    switchTo,
  };
}

beforeEach(async () => {
  await resetPlaybackSessions();
  await resetSettings();
});

describe("mode lifecycle requests", () => {
  test("reports synchronization failures after recovery and preserves the playback action's reporting owner", async () => {
    insertPlaybackSession("node");
    const enabled = spyOn(Sentry, "isEnabled").mockReturnValue(true);
    const capture = spyOn(Sentry, "captureException").mockReturnValue(
      "1234567890abcdef1234567890abcdef"
    );
    let failure: unknown = new Error("Mode module could not load");
    const inactive = {
      activate: async () => undefined,
      deactivate: async () => undefined,
      getPhase: () => "inactive" as const,
    };
    const manager = createModeManager({
      lifecycles: {
        dj: inactive,
        node: {
          ...inactive,
          activate: () => Promise.reject(failure),
        },
        single: inactive,
      },
    });
    const requests = createModeLifecycleRequests({ manager });
    try {
      await expect(requests.synchronizeMode("node")).rejects.toBe(failure);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(manager.getSnapshot().phase).toBe("inactive");

      capture.mockClear();
      failure = reportPlaybackActionError(capturePlaybackActionError, {
        cause: new Error("Audio engine could not start"),
        code: "WORKLET_LOAD_FAILED",
        mode: "node",
      });
      await expect(requests.requestMode("node")).rejects.toBe(failure);
      expect(capture).toHaveBeenCalledTimes(1);

      capture.mockClear();
      const settingsFailure = new Error("Settings could not be read");
      const synchronization = createModeLifecycleRequests({
        getCurrentSettings: () => {
          throw settingsFailure;
        },
        manager,
      });
      await expect(synchronization.synchronizeMode("node")).rejects.toBe(
        settingsFailure
      );
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture.mock.calls[0]?.[0]).toBe(settingsFailure);
    } finally {
      capture.mockRestore();
      enabled.mockRestore();
    }
  });

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
        whenSettled: mock(async () => undefined),
      },
    });

    await requests.requestMode("");
    await requests.requestMode("unknown");
    // Retired with Multiple; callers normalise it to "node" first.
    await requests.requestMode("multiple");

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
        whenSettled: mock(async () => undefined),
      },
    });

    await requests.requestMode("node");

    expect(switchTo).toHaveBeenCalledWith("node");
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
        whenSettled: mock(async () => undefined),
      },
    });

    await requests.requestMode("node");
    await requests.requestMode("dj");

    expect(switchTo).toHaveBeenCalledTimes(1);
    expect(switchTo).toHaveBeenCalledWith("dj");
  });

  test("cancels stale runtime synchronization after settings change", async () => {
    insertPlaybackSession("node");
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
        whenSettled: mock(async () => undefined),
      },
    });

    await requests.synchronizeMode("node");

    expect(activateInitialMode).not.toHaveBeenCalled();
    expect(switchTo).not.toHaveBeenCalled();
  });

  test("switches to a legacy stored mode's replacement without committing", async () => {
    insertPlaybackSession("node");
    const switchTo = mock(
      async (_mode: PlaybackSessionId, _options?: { commit?: boolean }) =>
        undefined
    );
    const requests = createModeLifecycleRequests({
      // Another tab wrote "multiple" while this one plays Single.
      getCurrentSettings: () =>
        ({
          id: "app-settings",
          player: { mode: "multiple", restoreStateOnLoad: true },
        }) as unknown as SettingsRecord,
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
        whenSettled: mock(async () => undefined),
      },
    });

    await requests.synchronizeMode("node");

    expect(switchTo).toHaveBeenCalledWith("node", { commit: false });
  });

  test("activates a legacy stored mode as its replacement without committing", async () => {
    insertPlaybackSession("node");
    const activateInitialMode = mock(
      async (_mode: PlaybackSessionId) => undefined
    );
    const switchTo = mock(async (_mode: PlaybackSessionId) => undefined);
    const requests = createModeLifecycleRequests({
      // A "multiple" the settings step could not rewrite.
      getCurrentSettings: () =>
        ({
          id: "app-settings",
          player: { mode: "multiple", restoreStateOnLoad: true },
        }) as unknown as SettingsRecord,
      manager: {
        activateInitialMode,
        getSnapshot: mock(() => ({
          currentMode: null,
          error: null,
          phase: "inactive" as const,
          requestedMode: null,
        })),
        subscribe: mock((_listener: () => void) => () => undefined),
        switchTo,
        whenSettled: mock(async () => undefined),
      },
    });

    await requests.synchronizeMode("node");

    expect(activateInitialMode).toHaveBeenCalledWith("node");
    expect(switchTo).not.toHaveBeenCalled();
  });
});

describe("settings synchronization during a transition", () => {
  test("follows a mode another tab picks while DJ is still loading", async () => {
    insertSettings("dj");
    const {
      commitMode,
      lifecycles,
      manager,
      preparation,
      preparing,
      requests,
    } = createCrossTabHarness();

    const toDj = requests.synchronizeMode("dj");
    await preparing;
    storeMode("node");
    const toNode = requests.synchronizeMode("node");
    await flushTasks();
    preparation.resolve();
    await toDj;
    await toNode;

    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "node",
      error: null,
      phase: "active",
      requestedMode: null,
    });
    expect(lifecycles.dj.activate).toHaveBeenCalledTimes(1);
    expect(lifecycles.dj.deactivate).toHaveBeenCalledTimes(1);
    expect(lifecycles.node.activate).toHaveBeenCalledTimes(1);
    expect(commitMode).not.toHaveBeenCalled();
  });

  test("replays only the newest of several changes made during one transition", async () => {
    insertSettings("dj");
    const { lifecycles, manager, preparation, preparing, requests, switchTo } =
      createCrossTabHarness();

    const toDj = requests.synchronizeMode("dj");
    await preparing;
    storeMode("node");
    const toNode = requests.synchronizeMode("node");
    // Back to the mode that was playing when DJ was requested.
    storeMode("single");
    const toSingle = requests.synchronizeMode("single");
    await flushTasks();
    preparation.resolve();
    await Promise.all([toDj, toNode, toSingle]);

    expect(lifecycles.node.activate).not.toHaveBeenCalled();
    expect(switchTo.mock.calls).toEqual([
      ["dj", { commit: false }],
      ["single", { commit: false }],
    ]);
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      phase: "active",
    });
  });

  test("a change back to the mode being started drops the queued change", async () => {
    insertSettings("dj");
    const { lifecycles, manager, preparation, preparing, requests, switchTo } =
      createCrossTabHarness();

    const toDj = requests.synchronizeMode("dj");
    await preparing;
    // The same mode again is already on its way.
    await requests.synchronizeMode("dj");
    storeMode("node");
    const toNode = requests.synchronizeMode("node");
    await flushTasks();
    storeMode("dj");
    await requests.synchronizeMode("dj");
    preparation.resolve();
    await Promise.all([toDj, toNode]);
    // And the mode that is playing.
    await requests.synchronizeMode("dj");

    expect(switchTo).toHaveBeenCalledTimes(1);
    expect(lifecycles.dj.prepare).toHaveBeenCalledTimes(1);
    expect(lifecycles.node.activate).not.toHaveBeenCalled();
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "dj",
      phase: "active",
    });
  });

  test("replays a change made while a requested DJ load fails", async () => {
    for (const mode of ["dj", "node", "single"] as const) {
      insertPlaybackSession(mode);
    }
    insertSettings("single");
    const module =
      Promise.withResolvers<typeof import("./dj-mode-lifecycle-workflow")>();
    const loading = Promise.withResolvers<void>();
    const loadDjWorkflow = mock(() => {
      loading.resolve();
      return module.promise;
    });
    const lifecycles = createModeLifecycleRegistry({ loadDjWorkflow });
    lifecycles.node = fakeLifecycle();
    lifecycles.single = fakeLifecycle();
    const commitMode = mock((_mode: PlaybackSessionId) => undefined);
    const manager = createModeManager({
      commitMode,
      initialMode: "single",
      lifecycles,
    });
    const requests = createModeLifecycleRequests({ manager });
    const notice = spyOn(toast, "error").mockReturnValue("dj-mode-load");
    try {
      const toDj = requests.requestMode("dj");
      await loading.promise;
      // A user switch still waits its turn rather than queueing.
      await expect(requests.requestMode("node")).rejects.toThrow(
        "Mode transition in progress"
      );
      storeMode("node");
      const toNode = requests.synchronizeMode("node");
      await flushTasks();
      module.reject(
        new TypeError("Failed to fetch dynamically imported module")
      );
      await expect(toDj).rejects.toThrow("DJ mode could not load");
      await toNode;

      expect(lifecycles.single.deactivate).toHaveBeenCalledTimes(1);
      expect(lifecycles.node.activate).toHaveBeenCalledTimes(1);
      expect(commitMode).not.toHaveBeenCalled();
      expect(notice).toHaveBeenCalledTimes(1);
      expect(manager.getSnapshot()).toMatchObject({
        currentMode: "node",
        error: null,
        phase: "active",
      });
    } finally {
      notice.mockRestore();
    }
  });

  test("a replayed DJ change after a failed DJ load fails once without another notice", async () => {
    for (const mode of ["dj", "node", "single"] as const) {
      insertPlaybackSession(mode);
    }
    insertSettings("single");
    const loadDjWorkflow = mock(() =>
      Promise.reject(new Error("Missing deployment chunk"))
    );
    const lifecycles = createModeLifecycleRegistry({ loadDjWorkflow });
    const nodeStarting = Promise.withResolvers<void>();
    const releaseNode = Promise.withResolvers<void>();
    lifecycles.node = {
      ...fakeLifecycle(),
      activate: mock(() => {
        nodeStarting.resolve();
        return releaseNode.promise;
      }),
    };
    lifecycles.single = fakeLifecycle();
    const manager = createModeManager({
      commitMode: () => undefined,
      initialMode: "single",
      lifecycles,
    });
    const switchTo = spyOn(manager, "switchTo");
    const requests = createModeLifecycleRequests({ manager });
    const notice = spyOn(toast, "error").mockReturnValue("dj-mode-load");
    try {
      await expect(requests.requestMode("dj")).rejects.toThrow(
        "DJ mode could not load"
      );
      storeMode("node");
      const toNode = requests.synchronizeMode("node");
      await nodeStarting.promise;
      storeMode("dj");
      const toDj = requests.synchronizeMode("dj");
      await flushTasks();
      releaseNode.resolve();
      await toNode;
      await expect(toDj).rejects.toThrow("DJ mode could not load");

      expect(loadDjWorkflow).toHaveBeenCalledTimes(1);
      expect(notice).toHaveBeenCalledTimes(1);
      expect(switchTo.mock.calls).toEqual([
        ["dj"],
        ["node", { commit: false }],
        ["dj", { commit: false }],
      ]);
      expect(manager.getSnapshot()).toMatchObject({
        currentMode: "node",
        phase: "active",
        requestedMode: null,
      });
    } finally {
      notice.mockRestore();
    }
  });
});
