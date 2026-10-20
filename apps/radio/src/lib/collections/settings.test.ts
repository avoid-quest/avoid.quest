import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { getChangelogSeenAt } from "@avoid.quest/ui/lib/changelog";
import { CHANGELOG_STORAGE_KEY } from "../const";
import {
  getSettings,
  initializeSettings,
  setPlayerMode,
  settingsCollection,
  shouldUseNativeSinglePlayback,
  updatePlayerSettings,
} from "./settings";

const SETTINGS_ID = "app-settings";

async function clearSettings() {
  await settingsCollection.stateWhenReady();
  for (const settingsId of Array.from(settingsCollection.state.keys())) {
    settingsCollection.delete(settingsId);
  }
}

beforeEach(clearSettings);
afterEach(clearSettings);

test.each([
  ["default", 0, true],
  ["default", 50, false],
  ["custom", 0, false],
] as const)(
  "Single on output %s with delay %s uses native playback: %s",
  (mainOutputId, mainDelayMs, native) => {
    settingsCollection.insert({
      audio: {
        cueOutputId: null,
        delay: { cueDelayMs: 0, mainDelayMs },
        mainOutputId,
      },
      id: SETTINGS_ID,
      player: { mode: "single", restoreStateOnLoad: true },
    });
    expect(shouldUseNativeSinglePlayback()).toBe(native);
  }
);

describe("player mode", () => {
  test("accepts node alongside the existing modes", () => {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: { mode: "node", restoreStateOnLoad: true },
    });
    expect(getSettings()?.player.mode).toBe("node");

    setPlayerMode("dj");
    expect(getSettings()?.player.mode).toBe("dj");

    updatePlayerSettings(() => ({ mode: "node" }));
    expect(getSettings()?.player.mode).toBe("node");
  });

  test("refuses multiple, which Node replaced", () => {
    setPlayerMode("node");
    expect(() =>
      settingsCollection.update(SETTINGS_ID, (draft) => {
        (draft.player as { mode: string }).mode = "multiple";
      })
    ).toThrow();
    expect(getSettings()?.player.mode).toBe("node");
  });

  test("refuses an unknown mode", () => {
    setPlayerMode("single");
    expect(() =>
      settingsCollection.update(SETTINGS_ID, (draft) => {
        (draft.player as { mode: string }).mode = "turntable";
      })
    ).toThrow();
    expect(getSettings()?.player.mode).toBe("single");
  });
});

describe("damaged saved settings", () => {
  const storageKey = "radio-app-settings";
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage"
  );
  let recoveredModule: typeof import("./settings") | undefined;
  let reloadCount = 0;
  let storage: Storage;

  beforeEach(() => {
    const data = new Map<string, string>();
    storage = {
      clear: () => data.clear(),
      getItem: (key) => data.get(key) ?? null,
      key: (index) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
      removeItem: (key) => data.delete(key),
      setItem: (key, value) => {
        data.set(key, value);
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: Object.assign(new EventTarget(), { localStorage: storage }),
    });
  });

  afterEach(async () => {
    await recoveredModule?.settingsCollection.cleanup();
    recoveredModule = undefined;
    for (const [key, descriptor] of [
      ["window", originalWindow],
      ["localStorage", originalStorage],
    ] as const) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  async function reloadSettings() {
    reloadCount += 1;
    recoveredModule = await import(
      `./settings.ts?recovery-test=${reloadCount}`
    );
    if (!recoveredModule) {
      throw new Error("Settings did not load");
    }
    return recoveredModule;
  }

  test.each(["dj", "multiple"])(
    "recovers %s preferences beside a malformed entry",
    async (mode) => {
      const saved = {
        audio: { cueOutputId: "cue", mainOutputId: "speakers" },
        id: SETTINGS_ID,
        player: { mode, restoreStateOnLoad: false },
      };
      const raw = JSON.stringify({
        broken: null,
        "s:app-settings": { data: saved, versionKey: "v1" },
      });
      storage.setItem(storageKey, raw);
      const recovered = await reloadSettings();
      await recovered.initializeSettings();
      expect(storage.getItem(`${storageKey}:corrupt`)).toBe(raw);
      expect(recovered.getSettings()).toMatchObject({
        ...saved,
        player: { ...saved.player, mode: mode === "multiple" ? "node" : mode },
      });
    }
  );

  test.each(["{invalid", "[]", '{"bad":{"data":{"id":"invalid"}}}'])(
    "backs up %s before inserting defaults",
    async (raw) => {
      storage.setItem(storageKey, raw);
      const recovered = await reloadSettings();
      await recovered.initializeSettings();
      expect(storage.getItem(`${storageKey}:corrupt`)).toBe(raw);
      expect(recovered.getSettings()?.player.mode).toBe("single");
    }
  );

  test("keeps the original if its backup cannot be saved", async () => {
    const raw = "{invalid";
    storage.setItem(storageKey, raw);
    const recovered = await reloadSettings();
    spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    await expect(recovered.initializeSettings()).rejects.toThrow(
      "Storage full"
    );
    expect(storage.getItem(storageKey)).toBe(raw);
    expect(recovered.settingsCollection.state.size).toBe(0);
  });
});

describe("changelog on first visit", () => {
  test("a new browser starts caught up; one with settings does not", async () => {
    const stored = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    });
    try {
      await initializeSettings();
      expect(getChangelogSeenAt(CHANGELOG_STORAGE_KEY)).toBeString();

      stored.clear();
      await initializeSettings();
      expect(getChangelogSeenAt(CHANGELOG_STORAGE_KEY)).toBeNull();
    } finally {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  test("a new browser is marked at the newest entry, not its own clock", async () => {
    const newest = "2026-09-30T12:00:00.000Z";
    const stored = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    });
    Object.defineProperty(globalThis, "__CHANGELOG_NEWEST_DATE__", {
      configurable: true,
      value: newest,
    });
    try {
      await initializeSettings();
      expect(getChangelogSeenAt(CHANGELOG_STORAGE_KEY)).toBe(newest);
    } finally {
      Reflect.deleteProperty(globalThis, "localStorage");
      Reflect.deleteProperty(globalThis, "__CHANGELOG_NEWEST_DATE__");
    }
  });

  test("a reset keeps the mark it finds", async () => {
    const seenAt = "2026-01-01T00:00:00.000Z";
    const stored = new Map([[CHANGELOG_STORAGE_KEY, seenAt]]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    });
    try {
      await initializeSettings();
      expect(getChangelogSeenAt(CHANGELOG_STORAGE_KEY)).toBe(seenAt);
    } finally {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});
