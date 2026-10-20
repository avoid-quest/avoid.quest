import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { radios as defaultRadios } from "../const";
import type { RadioRecord } from "./radios";

const STORAGE_KEY = "radio-app-radios";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage"
);
let radioModule: typeof import("./radios") | undefined;
let reloadCount = 0;
let storage: Storage;

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
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
}

function seedSavedRadios(edit?: (radio: RadioRecord) => void) {
  const records = defaultRadios.map((radio, index) => {
    const saved: RadioRecord = {
      ...radio,
      enabled: false,
      id: `saved-${index}`,
      isSystem: true,
      order: index + 20,
    };
    if (radio.metadataConfig?.kind === "nts-live-api") {
      // Preserve the property order used by older releases, even after formatting.
      saved.metadataConfig = JSON.parse(
        `{"kind":"nts-live-api","channel":"${radio.metadataConfig.channel}"}`
      );
    }
    edit?.(saved);
    return [`s:${saved.id}`, { data: saved, versionKey: `version-${index}` }];
  });
  storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(records)));
}

async function reloadRadios() {
  await radioModule?.radiosCollection.cleanup();
  reloadCount += 1;
  radioModule = (await import(
    `./radios.ts?sync-test=${reloadCount}`
  )) as typeof import("./radios");
  await radioModule.radiosCollection.stateWhenReady();
  return radioModule;
}

beforeEach(() => {
  storage = createMemoryStorage();
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
  await radioModule?.radiosCollection.cleanup();
  radioModule = undefined;
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

describe("saved radio sync", () => {
  test("does not prompt for older NTS property order on repeated reloads", async () => {
    seedSavedRadios();
    const originalData = storage.getItem(STORAGE_KEY);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: Each reload must hydrate the previous saved state.
      const { initializeRadios } = await reloadRadios();
      expect(await initializeRadios()).toBeNull();
    }

    expect(storage.getItem(STORAGE_KEY)).toBe(originalData);
  });

  test.each(["channel", "missing", "urls"])(
    "applies a real %s metadata change once and preserves user settings",
    async (change) => {
      seedSavedRadios((radio) => {
        if (change === "urls" && radio.name === "Sygma Radio") {
          radio.metadataConfig = {
            kind: "airtime-live-info",
            urls: ["https://example.com/old-live-info"],
          };
        } else if (
          change !== "urls" &&
          radio.name === "NTS Radio | Channel 1"
        ) {
          radio.metadataConfig =
            change === "missing"
              ? undefined
              : { channel: "2", kind: "nts-live-api" };
        }
      });
      const { applySyncChanges, initializeRadios, radiosCollection } =
        await reloadRadios();
      const before = [...radiosCollection.state.values()].map(
        ({ enabled, id, order }) => ({ enabled, id, order })
      );
      const changes = await initializeRadios();
      expect(changes?.updates).toHaveLength(1);
      expect(changes?.additions).toEqual([]);
      expect(changes?.deletions).toEqual([]);
      if (!changes) {
        throw new Error("Expected a real metadata update");
      }
      await applySyncChanges(changes);
      expect(await initializeRadios()).toBeNull();

      const reloaded = await reloadRadios();
      expect(await reloaded.initializeRadios()).toBeNull();
      expect(
        [...reloaded.radiosCollection.state.values()].map(
          ({ enabled, id, order }) => ({ enabled, id, order })
        )
      ).toEqual(before);
    }
  );

  test("does not offer a default whose stream is saved under another name", async () => {
    const [edited] = defaultRadios;
    seedSavedRadios((radio) => {
      if (radio.name === edited.name) {
        // Editing a station saves it as custom, as the station form does.
        radio.name = "My station";
        radio.isSystem = false;
      }
    });
    const { initializeRadios } = await reloadRadios();
    expect(await initializeRadios()).toBeNull();
  });

  test("offers a default renamed upstream once its retired row is gone", async () => {
    const [renamed] = defaultRadios;
    seedSavedRadios((radio) => {
      if (radio.name === renamed.name) {
        radio.name = "Old default name";
      }
    });
    const { applySyncChanges, initializeRadios, radiosCollection } =
      await reloadRadios();
    const changes = await initializeRadios();
    expect(changes?.additions).toEqual([renamed]);
    if (!changes) {
      throw new Error("Expected the renamed default");
    }
    await applySyncChanges(changes);
    expect(await initializeRadios()).toBeNull();
    expect(
      [...radiosCollection.state.values()].map((radio) => radio.name).sort()
    ).toEqual(defaultRadios.map((radio) => radio.name).sort());
  });
});

describe("a Spotify or Mixcloud tab saved before both became platforms", () => {
  test("reloads as Browser tab audio under its name, unchanged", async () => {
    // As an earlier release saved a pasted Spotify link it shared as a tab.
    const sourceUrl = "https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof";
    const shared: RadioRecord = {
      enabled: true,
      id: `browser-audio:${sourceUrl}`,
      isSystem: false,
      name: "Spotify",
      order: 40,
      platformMetadata: {
        capture: "display",
        channelCount: 2,
        channelSelection: { left: 0, right: 1 },
        deviceId: "display",
        deviceLabel: "Spotify",
        itemType: "track",
        platform: "device-input",
        sourceUrl,
        url: "",
      },
      streamUrl: "",
    };
    seedSavedRadios();
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    stored[`s:${shared.id}`] = { data: shared, versionKey: "version-shared" };
    storage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { getAllRadios, initializeRadios, radiosCollection } =
      await reloadRadios();
    expect(await initializeRadios()).toBeNull();
    expect(getAllRadios().find(({ id }) => id === shared.id)).toMatchObject(
      shared
    );
    // An edit validates the whole record against the current schema.
    radiosCollection.update(shared.id, (draft) => {
      draft.enabled = false;
    });
    expect(radiosCollection.state.get(shared.id)).toMatchObject({
      enabled: false,
      platformMetadata: shared.platformMetadata,
    });
  });
});

describe("bulk library persistence", () => {
  function seedLibrary() {
    const radios: RadioRecord[] = Array.from({ length: 200 }, (_, index) => ({
      enabled: true,
      id: `station-${index}`,
      isSystem: false,
      name: `Station ${index}`,
      order: index,
      streamUrl: `https://example.com/${index}`,
    }));
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        Object.fromEntries(
          radios.map((radio) => [
            `s:${radio.id}`,
            { data: radio, versionKey: radio.id },
          ])
        )
      )
    );
    return radios;
  }

  test("persists a 200-station reorder once and skips unchanged rows", async () => {
    const saved = seedLibrary();
    const { reorderRadios, radiosCollection } = await reloadRadios();
    const writes = spyOn(storage, "setItem");
    const ids = saved.map((radio) => radio.id).reverse();
    await reorderRadios(ids);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(ids.map((id) => radiosCollection.state.get(id)?.order)).toEqual(
      saved.map((_, index) => index)
    );
    await reorderRadios(ids);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  test("rolls back the entire reorder when persistence fails", async () => {
    const saved = seedLibrary();
    const { reorderRadios, radiosCollection } = await reloadRadios();
    const original = storage.getItem(STORAGE_KEY);
    const write = spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    await expect(
      reorderRadios(saved.map((radio) => radio.id).reverse())
    ).rejects.toThrow();
    expect(radiosCollection.state.size).toBe(saved.length);
    for (const radio of saved) {
      expect(radiosCollection.state.get(radio.id)).toMatchObject(radio);
    }
    expect(storage.getItem(STORAGE_KEY)).toBe(original);
    write.mockRestore();
    await reorderRadios(saved.map((radio) => radio.id).reverse());
    expect(radiosCollection.state.get(saved[0].id)?.order).toBe(199);
  });

  test("persists 200 sync updates together and skips an already-applied snapshot", async () => {
    const saved = seedLibrary();
    const { applySyncChanges } = await reloadRadios();
    const writes = spyOn(storage, "setItem");
    const changes = {
      additions: [],
      deletions: [],
      updates: saved.map((radio) => ({
        existing: radio,
        incoming: { ...radio, description: "Updated" },
      })),
    };
    await applySyncChanges(changes);
    expect(writes).toHaveBeenCalledTimes(1);
    await applySyncChanges(changes);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  test("seeds defaults with one storage write", async () => {
    const { initializeRadios } = await reloadRadios();
    const writes = spyOn(storage, "setItem");
    await initializeRadios();
    expect(
      writes.mock.calls.filter(([key]) => key === STORAGE_KEY)
    ).toHaveLength(1);
  });

  test("auto-deletes retired stations with one storage write", async () => {
    seedSavedRadios();
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    for (let index = 0; index < 200; index += 1) {
      const radio = {
        enabled: true,
        id: `retired-${index}`,
        isSystem: true,
        name: `Retired ${index}`,
        order: index,
        streamUrl: "https://example.com/retired",
      };
      saved[`s:${radio.id}`] = { data: radio, versionKey: radio.id };
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const { initializeRadios, radiosCollection } = await reloadRadios();
    const writes = spyOn(storage, "setItem");
    expect(await initializeRadios()).toBeNull();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(radiosCollection.state.size).toBe(defaultRadios.length);
  });

  test("revalidates stale additions, updates and deletions", async () => {
    const { applySyncChanges, radiosCollection } = await reloadRadios();
    const [addition] = defaultRadios;
    const changes = {
      additions: [addition, addition],
      deletions: [],
      updates: [],
    };
    await applySyncChanges(changes);
    await applySyncChanges(changes);
    expect(radiosCollection.state.size).toBe(1);
    const [existing] = radiosCollection.state.values();
    await applySyncChanges({
      additions: [{ ...addition, name: "Another name" }],
      deletions: [],
      updates: [],
    });
    expect(radiosCollection.state.size).toBe(1);
    await radiosCollection.delete(existing.id).isPersisted.promise;
    await expect(
      applySyncChanges({
        additions: [],
        deletions: [existing],
        updates: [{ existing, incoming: addition }],
      })
    ).resolves.toBeUndefined();
    expect(radiosCollection.state.size).toBe(0);
  });

  test("rolls mixed sync changes back together and permits retry", async () => {
    seedSavedRadios();
    const { applySyncChanges, radiosCollection } = await reloadRadios();
    const saved = [...radiosCollection.state.values()];
    const changes = {
      additions: [
        {
          ...defaultRadios[0],
          name: "New station",
          streamUrl: "https://example.com/new",
        },
      ],
      deletions: [saved[1]],
      updates: [
        {
          existing: saved[0],
          incoming: { ...defaultRadios[0], description: "Updated" },
        },
      ],
    };
    const writes = spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    await expect(applySyncChanges(changes)).rejects.toThrow();
    expect(radiosCollection.state.size).toBe(saved.length);
    for (const radio of saved) {
      expect(radiosCollection.state.get(radio.id)).toMatchObject(radio);
    }
    writes.mockRestore();
    await applySyncChanges(changes);
    expect(radiosCollection.state.has(saved[1].id)).toBe(false);
    expect(radiosCollection.state.get(saved[0].id)?.description).toBe(
      "Updated"
    );
    expect(radiosCollection.state.size).toBe(saved.length);
  });
});

describe("damaged local storage", () => {
  test.each(["{invalid", "{}", '["station", 4]'])(
    "ignores and backs up malformed dismissed stations: %s",
    async (raw) => {
      storage.setItem("radio-app-dismissed-radios", raw);
      const { getDismissedRadios, initializeRadios } = await reloadRadios();
      expect(getDismissedRadios()).toEqual(new Set());
      expect(storage.getItem("radio-app-dismissed-radios:corrupt")).toBe(raw);
      await expect(initializeRadios()).resolves.toBeNull();
    }
  );

  test("recovers valid custom stations beside a malformed envelope entry", async () => {
    const custom: RadioRecord = {
      enabled: false,
      id: "custom",
      isSystem: false,
      name: "My station",
      order: 42,
      streamUrl: "https://example.com/custom",
    };
    const raw = JSON.stringify({
      "s:broken": { invalid: true },
      "s:custom": { data: custom, versionKey: "v1" },
    });
    storage.setItem(STORAGE_KEY, raw);
    const { initializeRadios, radiosCollection } = await reloadRadios();
    await initializeRadios();
    expect(storage.getItem(`${STORAGE_KEY}:corrupt`)).toBe(raw);
    expect(radiosCollection.state.size).toBe(1);
    expect(radiosCollection.state.get(custom.id)).toMatchObject(custom);
    const reloaded = await reloadRadios();
    expect(reloaded.radiosCollection.state.size).toBe(1);
    expect(reloaded.radiosCollection.state.get(custom.id)).toMatchObject(
      custom
    );
  });

  test.each(["{invalid", "[]", '{"bad":{"data":{"id":"invalid"}}}'])(
    "backs up unrecoverable data before seeding: %s",
    async (raw) => {
      storage.setItem(STORAGE_KEY, raw);
      const { initializeRadios, radiosCollection } = await reloadRadios();
      await initializeRadios();
      expect(storage.getItem(`${STORAGE_KEY}:corrupt`)).toBe(raw);
      expect(radiosCollection.state.size).toBe(defaultRadios.length);
    }
  );

  test("does not overwrite unreadable data if its backup fails", async () => {
    const raw = "{invalid";
    storage.setItem(STORAGE_KEY, raw);
    const { initializeRadios, radiosCollection } = await reloadRadios();
    spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    await expect(initializeRadios()).rejects.toThrow("Storage full");
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
    expect(radiosCollection.state.size).toBe(0);
  });
});

describe("storage that refuses writes at startup", () => {
  test("opens with the default stations in memory for the visit", async () => {
    const { initializeRadios, radiosCollection, reorderRadios } =
      await reloadRadios();
    const write = spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    await expect(initializeRadios()).resolves.toBeNull();
    expect(radiosCollection.state.size).toBe(defaultRadios.length);
    write.mockRestore();

    const ids = [...radiosCollection.state.keys()].reverse();
    await reorderRadios(ids);
    expect(ids.map((id) => radiosCollection.state.get(id)?.order)).toEqual(
      ids.map((_, index) => index)
    );
    await radiosCollection.insert({
      enabled: true,
      id: "added",
      isSystem: false,
      name: "Added station",
      order: ids.length,
      streamUrl: "https://example.com/added",
    }).isPersisted.promise;
    expect(radiosCollection.state.size).toBe(defaultRadios.length + 1);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  test("keeps recovered stations in memory beside their backup", async () => {
    const custom: RadioRecord = {
      enabled: false,
      id: "custom",
      isSystem: false,
      name: "My station",
      order: 42,
      streamUrl: "https://example.com/custom",
    };
    const raw = JSON.stringify({
      "s:broken": { invalid: true },
      "s:custom": { data: custom, versionKey: "v1" },
    });
    storage.setItem(STORAGE_KEY, raw);
    const { initializeRadios, radiosCollection } = await reloadRadios();
    const setItem = storage.setItem.bind(storage);
    spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key === STORAGE_KEY) {
        throw new Error("Storage full");
      }
      setItem(key, value);
    });
    await expect(initializeRadios()).resolves.toBeNull();
    expect(storage.getItem(`${STORAGE_KEY}:corrupt`)).toBe(raw);
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
    expect(radiosCollection.state.size).toBe(1);
    expect(radiosCollection.state.get(custom.id)).toMatchObject(custom);
  });

  test("opens with retired stations it could not remove", async () => {
    seedSavedRadios();
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    const retired = {
      enabled: true,
      id: "retired",
      isSystem: true,
      name: "Retired station",
      order: 99,
      streamUrl: "https://example.com/retired",
    };
    saved[`s:${retired.id}`] = { data: retired, versionKey: retired.id };
    storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const original = storage.getItem(STORAGE_KEY);
    const { initializeRadios, radiosCollection } = await reloadRadios();
    spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    await expect(initializeRadios()).resolves.toBeNull();
    expect(radiosCollection.state.get(retired.id)).toMatchObject(retired);
    expect(storage.getItem(STORAGE_KEY)).toBe(original);
  });

  test("follows another tab's stations while they can be saved", async () => {
    // Call the listeners directly: other files may leave a DOM Event behind.
    type StorageListener = (event: Partial<StorageEvent>) => void;
    const listeners = new Set<StorageListener>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: (_type: string, listener: StorageListener) =>
          listeners.add(listener),
        localStorage: storage,
        removeEventListener: (_type: string, listener: StorageListener) =>
          listeners.delete(listener),
      },
    });
    const { initializeRadios, radiosCollection } = await reloadRadios();
    await initializeRadios();
    const other: RadioRecord = {
      enabled: true,
      id: "other-tab",
      isSystem: false,
      name: "Other tab station",
      order: 0,
      streamUrl: "https://example.com/other",
    };
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "s:other-tab": { data: other, versionKey: "v2" } })
    );
    for (const listener of listeners) {
      listener({ key: STORAGE_KEY, storageArea: storage });
    }
    expect([...radiosCollection.state.keys()]).toEqual([other.id]);
  });
});
