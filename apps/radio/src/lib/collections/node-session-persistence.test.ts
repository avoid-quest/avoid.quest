import { afterEach, beforeAll, expect, mock, spyOn, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

if (process.env.AVOID_QUEST_PERSISTENCE_SCENARIO === "1") {
  const dom = new JSDOM("", { url: "https://radio.test" });
  for (const [key, value] of Object.entries({
    localStorage: dom.window.localStorage,
    window: dom.window,
  })) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  const { playbackSessionsCollection, PLAYBACK_SESSIONS_STORAGE_KEY } =
    await import("./playback-sessions");
  const { buildNodeSessionFromTemplate } = await import(
    "@/lib/node-graph/template-sessions"
  );
  const { createNodeSessionPersistence } = await import(
    "./node-session-persistence"
  );

  beforeAll(async () => {
    await playbackSessionsCollection.stateWhenReady();
  });
  afterEach(() => {
    playbackSessionsCollection.delete("node");
    localStorage.clear();
  });

  test("a knob burst stays live and flush writes only the latest session", async () => {
    await playbackSessionsCollection.insert(
      buildNodeSessionFromTemplate("starter")
    ).isPersisted.promise;
    const write = spyOn(dom.window.Storage.prototype, "setItem");
    const persistence = createNodeSessionPersistence();
    try {
      for (let i = 0; i < 5; i += 1) {
        persistence.update((draft) => {
          draft.masterVolume = 0.1 + i / 10;
        });
        expect(playbackSessionsCollection.state.get("node")?.masterVolume).toBe(
          0.1 + i / 10
        );
        // biome-ignore lint/performance/noAwaitInLoops: each edit must reach the next reconciliation microtask
        await Promise.resolve();
      }
      expect(
        write.mock.calls.filter(
          ([key]) => key === PLAYBACK_SESSIONS_STORAGE_KEY
        ).length
      ).toBeLessThan(5);
      persistence.flush();
      expect(localStorage.getItem(PLAYBACK_SESSIONS_STORAGE_KEY)).toContain(
        '"masterVolume":0.5'
      );
    } finally {
      persistence.flush();
      write.mockRestore();
    }
  });

  test("settling waits for a write made while it waits", async () => {
    await playbackSessionsCollection.insert(
      buildNodeSessionFromTemplate("starter")
    ).isPersisted.promise;
    const persistence = createNodeSessionPersistence();
    persistence.update((draft) => {
      draft.masterVolume = 0.3;
    });
    const settling = persistence.whenSettled();
    persistence.update((draft) => {
      draft.masterVolume = 0.6;
    });
    await settling;
    expect(localStorage.getItem(PLAYBACK_SESSIONS_STORAGE_KEY)).toContain(
      '"masterVolume":0.6'
    );
  });

  test("a failed trailing write rolls back to the last persisted session", async () => {
    await playbackSessionsCollection.insert(
      buildNodeSessionFromTemplate("starter")
    ).isPersisted.promise;
    const report = mock(() => undefined);
    const persistence = createNodeSessionPersistence(report);
    persistence.update((draft) => {
      draft.masterVolume = 0.4;
    });
    await persistence.whenSettled();
    const stored = localStorage.getItem(PLAYBACK_SESSIONS_STORAGE_KEY);
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    const write = spyOn(
      dom.window.Storage.prototype,
      "setItem"
    ).mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      persistence.update((draft) => {
        draft.masterVolume = 0.8;
      });
      expect(playbackSessionsCollection.state.get("node")?.masterVolume).toBe(
        0.8
      );
      await expect(persistence.whenSettled()).rejects.toThrow(
        "QuotaExceededError"
      );
      expect(localStorage.getItem(PLAYBACK_SESSIONS_STORAGE_KEY)).toBe(stored);
      expect(playbackSessionsCollection.state.get("node")?.masterVolume).toBe(
        0.4
      );
      expect(report).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
      log.mockRestore();
    }
  });
} else {
  test("paced Node session persistence against real storage", async () => {
    // Collection singletons choose storage on first import; keep this scenario isolated.
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, AVOID_QUEST_PERSISTENCE_SCENARIO: "1" },
      stderr: "pipe",
      stdout: "pipe",
      timeout: 5000,
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ errors: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      errors: "",
      exitCode: 0,
    });
  });
}
