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
  const {
    createNodeSessionPersistence,
    createPlaybackSessionPersistence,
    getPlaybackSessionPersistence,
    flushPlaybackSessionWrites,
  } = await import("./node-session-persistence");

  beforeAll(async () => {
    await playbackSessionsCollection.stateWhenReady();
  });
  afterEach(() => {
    flushPlaybackSessionWrites();
    for (const id of playbackSessionsCollection.state.keys()) {
      playbackSessionsCollection.delete(id);
    }
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

  test("all sessions coalesce control bursts and apply audio before storage", async () => {
    const { createDefaultChannel } = await import("./playback-sessions");
    const roles = {
      dj: "deck-a",
      node: "node",
      single: "single-primary",
    } as const;
    for (const id of ["single", "node", "dj"] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: each session must be seeded before observing its writes.
      await playbackSessionsCollection.insert({
        ...buildNodeSessionFromTemplate("starter"),
        channels: [createDefaultChannel(id.concat("-a"), roles[id], 0)],
        id,
      }).isPersisted.promise;
      const writer = createPlaybackSessionPersistence(id);
      let audio = 1;
      const apply = () => {
        audio = playbackSessionsCollection.state.get(id)?.masterVolume ?? 1;
      };
      const write = spyOn(dom.window.Storage.prototype, "setItem");
      const original = write.getMockImplementation();
      write.mockImplementation(function (
        this: Storage,
        key: string,
        value: string
      ) {
        if (key === PLAYBACK_SESSIONS_STORAGE_KEY) {
          expect(audio).toBe(
            playbackSessionsCollection.state.get(id)?.masterVolume ?? 1
          );
        }
        original?.call(this, key, value);
      });
      try {
        for (let i = 0; i < 60; i += 1) {
          writer.update((draft) => {
            draft.masterVolume = i / 100;
          }, apply);
          expect(audio).toBe(i / 100);
        }
        expect(
          write.mock.calls.filter(
            ([key]) => key === PLAYBACK_SESSIONS_STORAGE_KEY
          ).length
        ).toBeLessThanOrEqual(1);
        await writer.whenSettled();
        expect(
          write.mock.calls.filter(
            ([key]) => key === PLAYBACK_SESSIONS_STORAGE_KEY
          ).length
        ).toBe(2);
        expect(localStorage.getItem(PLAYBACK_SESSIONS_STORAGE_KEY)).toContain(
          '"masterVolume":0.59'
        );
      } finally {
        writer.flush();
        write.mockRestore();
      }
    }
  });

  test("DJ input bursts share one writer and update audio before its writes", async () => {
    const { createDefaultChannel } = await import("./playback-sessions");
    const { setCrossfadePosition, setMasterVolume, setHeadphoneVolume } =
      await import("@/lib/dj-actions");
    const { getOutputRouting } = await import("@/lib/output-routing");
    const { setPlaybackChannelSoundId } = await import(
      "@/lib/stores/playback-runtime-store"
    );
    await playbackSessionsCollection.insert({
      ...buildNodeSessionFromTemplate("starter"),
      channels: [
        createDefaultChannel("deck-a", "deck-a", 0),
        createDefaultChannel("deck-b", "deck-b", 1),
      ],
      id: "dj",
    }).isPersisted.promise;
    setPlaybackChannelSoundId("deck-a", "sound-a");
    setPlaybackChannelSoundId("deck-b", "sound-b");
    const events: string[] = [];
    const changeChannel = mock(() => {
      events.push("audio");
    });
    const changeMaster = mock(() => {
      events.push("audio");
    });
    const context = {
      audioEngine: {
        volume: {
          setChannelVolume: changeChannel,
          setMasterVolume: changeMaster,
        },
      },
    } as unknown as import("@/lib/playback-action-context").PlaybackActionContext;
    const headphone = spyOn(
      getOutputRouting(),
      "setHeadphoneVolume"
    ).mockImplementation(() => {
      events.push("audio");
    });
    const write = spyOn(dom.window.Storage.prototype, "setItem");
    const original = write.getMockImplementation();
    write.mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key === PLAYBACK_SESSIONS_STORAGE_KEY) {
        expect(events.at(-1)).toBe("audio");
        events.push("write");
      }
      original?.call(this, key, value);
    });
    try {
      for (let i = 0; i < 60; i += 1) {
        setCrossfadePosition(i / 100, context);
        setMasterVolume(i / 100, context);
        setHeadphoneVolume(i / 100);
      }
      expect(changeChannel).toHaveBeenCalledTimes(120);
      expect(changeMaster).toHaveBeenCalledTimes(60);
      expect(headphone).toHaveBeenCalledTimes(60);
      expect(
        write.mock.calls.filter(
          ([key]) => key === PLAYBACK_SESSIONS_STORAGE_KEY
        ).length
      ).toBeLessThanOrEqual(1);
      await getPlaybackSessionPersistence("dj").whenSettled();
      expect(
        write.mock.calls.filter(
          ([key]) => key === PLAYBACK_SESSIONS_STORAGE_KEY
        ).length
      ).toBeLessThanOrEqual(2);
      expect(playbackSessionsCollection.state.get("dj")).toMatchObject({
        crossfadePosition: 0.59,
        headphoneVolume: 0.59,
        masterVolume: 0.59,
      });
    } finally {
      flushPlaybackSessionWrites();
      write.mockRestore();
      headphone.mockRestore();
    }
  });

  test.each([
    "pagehide",
    "pointerup",
    "pointercancel",
    "keyup",
    "hidden",
    "explicit",
  ])("%s flushes the final optimistic value", async (boundary) => {
    await playbackSessionsCollection.insert(
      buildNodeSessionFromTemplate("starter")
    ).isPersisted.promise;
    const writer = getPlaybackSessionPersistence("node");
    writer.update((draft) => {
      draft.masterVolume = 0.2;
    });
    await writer.whenSettled();
    writer.update((draft) => {
      draft.masterVolume = 0.7;
    });
    expect(localStorage.getItem(PLAYBACK_SESSIONS_STORAGE_KEY)).toContain(
      '"masterVolume":0.2'
    );
    if (boundary === "hidden") {
      Object.defineProperty(dom.window.document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      dom.window.document.dispatchEvent(
        new dom.window.Event("visibilitychange")
      );
    } else if (boundary === "explicit") {
      flushPlaybackSessionWrites();
    } else {
      dom.window.dispatchEvent(new dom.window.Event(boundary));
    }
    expect(localStorage.getItem(PLAYBACK_SESSIONS_STORAGE_KEY)).toContain(
      '"masterVolume":0.7'
    );
    await writer.whenSettled();
  });

  test("an immediate session change preserves pending control values", async () => {
    const { updatePlaybackSession } = await import("./playback-sessions");
    await playbackSessionsCollection.insert(
      buildNodeSessionFromTemplate("starter")
    ).isPersisted.promise;
    const writer = getPlaybackSessionPersistence("node");
    writer.update((draft) => {
      draft.masterVolume = 0.2;
    });
    await writer.whenSettled();
    writer.update((draft) => {
      draft.masterVolume = 0.6;
    });
    updatePlaybackSession("node", (draft) => {
      draft.tempo = 145;
    });
    await writer.whenSettled();
    expect(playbackSessionsCollection.state.get("node")).toMatchObject({
      masterVolume: 0.6,
      tempo: 145,
    });
    expect(localStorage.getItem(PLAYBACK_SESSIONS_STORAGE_KEY)).toContain(
      '"tempo":145'
    );
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
    let audioVolume = 1;
    const apply = () => {
      audioVolume =
        playbackSessionsCollection.state.get("node")?.masterVolume ?? 1;
    };
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
      }, apply);
      expect(audioVolume).toBe(0.8);
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
      expect(audioVolume).toBe(0.4);
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
      timeout: 30_000,
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ errors: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      errors: "",
      exitCode: 0,
    });
  }, 35_000);
}
