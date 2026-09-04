import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
      applySyncChanges(changes);
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
});
