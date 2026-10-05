import { expect, mock, spyOn, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const scenarios = [
  "single-first",
  "node-first",
  "dj-first",
  "concurrent",
  "readiness-retry",
  "storage-retry",
  "restore",
  "reset-on-boot",
  "legacy-during-model-load",
  "quota-inline-model",
] as const;
const scenario = process.env.AVOID_QUEST_MODE_BOOT_SCENARIO;

if (scenario) {
  const dom = new JSDOM("", { url: "https://radio.test" });
  for (const [key, value] of Object.entries({
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    window: dom.window,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  // Only the rendering boundary is replaced; boot, loaders and collections are real.
  mock.module("./single", () => ({ SingleRadio: () => null }));
  mock.module("./node", () => ({ NodeRadios: () => null }));
  mock.module("./dj/dj-player", () => ({ DjPlayer: () => null }));

  const sessions = await import("@/lib/collections/playback-sessions");
  const settings = await import("@/lib/collections/settings");
  const { preparePlaybackSessions } = await import(
    "@/lib/collections/initialize"
  );
  const { initializeCollections } = await import("@/lib/collections");
  const { resetAllSettings } = await import("@/lib/settings");
  const { createDefaultEffectConfig } = await import("@/lib/audio");
  const { createLocalNamModelId, saveNamModel, getCachedNamModel } =
    await import("@/lib/audio/dsp/effects/nam-model-store");
  const { buildNodeSessionFromTemplate } = await import(
    "@/lib/node-graph/template-sessions"
  );
  const { loadSingleRadio, loadNodeRadios, loadDjPlayer } = await import(
    "./radio-mode-loader"
  );
  const loaders = {
    dj: loadDjPlayer,
    node: loadNodeRadios,
    single: loadSingleRadio,
  };
  const station = {
    id: "selected",
    name: "In-session station",
    streamUrl: "https://radio.test/stream.mp3",
  };

  test(scenario, async () => {
    await settings.initializeSettings();
    settings.setRestoreStateOnLoad(
      scenario === "restore" ||
        scenario === "legacy-during-model-load" ||
        scenario === "quota-inline-model"
    );
    await sessions.playbackSessionsCollection.stateWhenReady();

    const modelId = createLocalNamModelId();
    await saveNamModel(modelId, '{"model":"live"}');
    const effect = createDefaultEffectConfig("neuralAmp", "live-effect", 0);
    effect.modelId = modelId;
    const seedSingle = sessions.buildSingleSessionFromLegacyState({
      radio: station,
      volume: 0.25,
    });
    seedSingle.channels[0].effects = [effect];
    const seedDj = sessions.buildDjSessionFromLegacyState({
      legacyDecks: [{ id: "deck-a", radio: station, volume: 0.3 }],
    });
    seedDj.channels[0].effects = [effect];
    seedDj.activeChannelId = "deck-a";
    const seedNode = buildNodeSessionFromTemplate("start-from-multiple", {
      saved: [{ ...station, enabled: true, order: 0 }],
    });
    const seeds = [seedSingle, seedNode, seedDj];
    const snapshot = () =>
      [...sessions.playbackSessionsCollection.state.values()].map(
        sessions.parsePlaybackSessionRecord
      );

    if (scenario === "quota-inline-model") {
      if (effect.type !== "neuralAmp") {
        throw new Error("Expected neural amp config");
      }
      effect.modelData = JSON.stringify({ model: "x".repeat(10_000) });
      await sessions.playbackSessionsCollection.insert(seedSingle).isPersisted
        .promise;
      const stored = localStorage.getItem(
        sessions.PLAYBACK_SESSIONS_STORAGE_KEY
      );
      if (!stored) {
        throw new Error("Missing seeded session");
      }
      const quota = stored.length + 64;
      const { setItem } = dom.window.Storage.prototype;
      const write = spyOn(
        dom.window.Storage.prototype,
        "setItem"
      ).mockImplementation(function (
        this: Storage,
        key: string,
        value: string
      ) {
        if (
          key === sessions.PLAYBACK_SESSIONS_STORAGE_KEY &&
          value.length > quota
        ) {
          throw new Error("storage quota exceeded");
        }
        setItem.call(this, key, value);
      });
      try {
        await loadSingleRadio();
        expect(sessions.playbackSessionsCollection.state.size).toBe(3);
        expect(
          sessions.getPlaybackSession("single")?.channels[0].effects[0]
        ).toMatchObject({
          modelData: null,
          modelId,
        });
        expect(getCachedNamModel(modelId)).toBe(effect.modelData);
      } finally {
        write.mockRestore();
      }
      return;
    }

    if (scenario === "legacy-during-model-load") {
      if (effect.type !== "neuralAmp") {
        throw new Error("Expected neural amp config");
      }
      effect.modelData = '{"model":"inline"}';
      await sessions.playbackSessionsCollection.insert(seeds).isPersisted
        .promise;
      const store = await import("@/lib/audio/dsp/effects/nam-model-store");
      const { writeLegacyRecord, LEGACY_MULTIPLE_SESSION_ID } = await import(
        "@/lib/collections/migrations/legacy-records"
      );
      const started = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      const save = spyOn(store, "saveNamModel").mockImplementation(async () => {
        started.resolve();
        await gate.promise;
      });
      const pending = preparePlaybackSessions();
      try {
        await started.promise;
        writeLegacyRecord(sessions.playbackSessionsCollection, {
          ...seedNode,
          id: "multiple",
        });
        dom.window.dispatchEvent(
          new dom.window.StorageEvent("storage", {
            key: sessions.PLAYBACK_SESSIONS_STORAGE_KEY,
            storageArea: localStorage,
          })
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(
          sessions.playbackSessionsCollection.state.has(
            LEGACY_MULTIPLE_SESSION_ID
          )
        ).toBe(false);
      } finally {
        gate.resolve();
        await pending;
        save.mockRestore();
      }
      return;
    }

    if (
      scenario === "restore" ||
      scenario === "reset-on-boot" ||
      scenario === "storage-retry"
    ) {
      await sessions.playbackSessionsCollection.insert(seeds).isPersisted
        .promise;
    }

    if (scenario === "concurrent") {
      const ready = sessions.playbackSessionsCollection.stateWhenReady();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const read = spyOn(
        sessions.playbackSessionsCollection,
        "stateWhenReady"
      ).mockImplementation(async () => {
        await gate;
        return ready;
      });
      try {
        let resolved = false;
        const pending = Promise.all([
          loadSingleRadio(),
          loadNodeRadios(),
          loadDjPlayer(),
        ]).then(() => {
          resolved = true;
        });
        expect(preparePlaybackSessions()).toBe(preparePlaybackSessions());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(resolved).toBe(false);
        expect(read).toHaveBeenCalledTimes(1);
        release();
        await pending;
        expect(sessions.playbackSessionsCollection.state.size).toBe(3);
        expect(read).toHaveBeenCalledTimes(1);
      } finally {
        release();
        read.mockRestore();
      }
      return;
    }

    if (scenario === "readiness-retry") {
      const read = spyOn(
        sessions.playbackSessionsCollection,
        "stateWhenReady"
      ).mockRejectedValueOnce(new Error("read failed"));
      await expect(
        Promise.all([loadSingleRadio(), loadDjPlayer()])
      ).rejects.toThrow("read failed");
      read.mockRestore();
      expect(sessions.playbackSessionsCollection.state.size).toBe(0);
      await Promise.all([loadSingleRadio(), loadNodeRadios(), loadDjPlayer()]);
      expect(sessions.playbackSessionsCollection.state.size).toBe(3);
      return;
    }

    if (scenario === "storage-retry") {
      const before = snapshot();
      const stored = localStorage.getItem(
        sessions.PLAYBACK_SESSIONS_STORAGE_KEY
      );
      const { setItem } = dom.window.Storage.prototype;
      const log = spyOn(console, "error").mockImplementation(() => undefined);
      const write = spyOn(
        dom.window.Storage.prototype,
        "setItem"
      ).mockImplementation(function (
        this: Storage,
        key: string,
        value: string
      ) {
        if (key === sessions.PLAYBACK_SESSIONS_STORAGE_KEY) {
          throw new Error("storage full");
        }
        setItem.call(this, key, value);
      });
      try {
        await expect(
          Promise.all([loadSingleRadio(), loadDjPlayer()])
        ).rejects.toThrow("storage full");
        expect(snapshot()).toEqual(before);
        expect(
          localStorage.getItem(sessions.PLAYBACK_SESSIONS_STORAGE_KEY)
        ).toBe(stored);
        expect(getCachedNamModel(modelId)).not.toBeNull();
      } finally {
        write.mockRestore();
        log.mockRestore();
      }
      await Promise.all([loadSingleRadio(), loadDjPlayer(), loadNodeRadios()]);
      expect(
        sessions.getPlaybackSession("single")?.channels[0].radio
      ).toBeNull();
      expect(sessions.getPlaybackSession("dj")?.channels[0].radio).toBeNull();
      return;
    }

    if (scenario === "restore" || scenario === "reset-on-boot") {
      await initializeCollections();
      await Promise.all([loadSingleRadio(), loadNodeRadios(), loadDjPlayer()]);
      for (const id of ["single", "dj"] as const) {
        const restored = sessions.getPlaybackSession(id);
        expect(restored?.channels[0].radio).toEqual(
          scenario === "restore" ? station : null
        );
        const activeChannel = id === "single" ? "single-a" : "deck-a";
        expect(restored?.activeChannelId).toBe(
          scenario === "restore" ? activeChannel : null
        );
        expect(restored?.channels[0].effects).toEqual(
          scenario === "restore" ? [effect] : []
        );
      }
      // Authored Node patches survive either page-load preference.
      expect(sessions.getPlaybackSession("node")?.graph).toEqual(
        seedNode.graph
      );
      expect(getCachedNamModel(modelId) === null).toBe(scenario !== "restore");
      return;
    }

    const orders = {
      "dj-first": ["dj", "single", "node"],
      "node-first": ["node", "dj", "single"],
      "single-first": ["single", "node", "dj"],
    } as const;
    const order = orders[scenario as keyof typeof orders];
    await loaders[order[0]]();
    for (const seed of seeds) {
      sessions.updatePlaybackSession(seed.id, (draft) => {
        Object.assign(draft, seed);
      });
    }
    const edited = snapshot();
    await loaders[order[1]]();
    expect(snapshot()).toEqual(edited);
    await loaders[order[2]]();
    await initializeCollections();
    expect(snapshot()).toEqual(edited);
    expect(getCachedNamModel(modelId)).not.toBeNull();

    // The once-per-page guard must not suppress an explicit Settings Reset.
    await resetAllSettings();
    expect(sessions.getPlaybackSession("single")?.channels[0].radio).toBeNull();
    expect(sessions.getPlaybackSession("dj")?.channels[0].radio).toBeNull();
    expect(sessions.getPlaybackSession("single")?.channels[0].effects).toEqual(
      []
    );
    expect(getCachedNamModel(modelId)).toBeNull();
  });
} else {
  for (const pageScenario of scenarios) {
    test(`mode boot: ${pageScenario}`, async () => {
      // Each process is a fresh page: module caches and collection storage start together.
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        env: { ...process.env, AVOID_QUEST_MODE_BOOT_SCENARIO: pageScenario },
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
}
