import { afterEach, beforeEach, expect, test } from "bun:test";
import { createMemoryFallbackStorage } from "./memory-fallback-storage";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
type StorageListener = (event: Partial<StorageEvent>) => void;
let browserWindow: object;
let listeners: Set<StorageListener>;
let data: Map<string, string>;
let readsBlocked: boolean;

beforeEach(() => {
  data = new Map();
  readsBlocked = false;
  listeners = new Set();
  browserWindow = {
    addEventListener: (_type: string, listener: StorageListener) => {
      listeners.add(listener);
    },
    localStorage: {
      getItem: (key: string) => {
        if (readsBlocked) {
          throw new DOMException("Storage blocked", "SecurityError");
        }
        return data.get(key) ?? null;
      },
      removeItem: (key: string) => data.delete(key),
      setItem: (key: string, value: string) => data.set(key, value),
    },
    removeEventListener: (_type: string, listener: StorageListener) => {
      listeners.delete(listener);
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browserWindow,
  });
});

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

function expectMemoryStorage() {
  const { storage } = createMemoryFallbackStorage();
  expect(storage).toBeDefined();
  expect(storage?.getItem("rows")).toBeNull();
  storage?.setItem("rows", "defaults");
  expect(storage?.getItem("rows")).toBe("defaults");
  expect(data.has("rows")).toBe(false);
  storage?.removeItem("rows");
  expect(storage?.getItem("rows")).toBeNull();
}

test("keeps rows in memory when acquiring localStorage throws", () => {
  Object.defineProperty(browserWindow, "localStorage", {
    get: () => {
      throw new DOMException("Storage blocked", "SecurityError");
    },
  });
  expectMemoryStorage();
});

test("keeps rows in memory when the first storage read throws", () => {
  readsBlocked = true;
  expectMemoryStorage();
});

test("stays in memory and ignores storage events after a later read fails", () => {
  data.set("rows", "saved");
  const { storage, storageEventApi } = createMemoryFallbackStorage();
  expect(storage?.getItem("rows")).toBe("saved");
  readsBlocked = true;
  expect(storage?.getItem("unread")).toBeNull();
  readsBlocked = false;
  storage?.setItem("rows", "edited");
  expect(storage?.getItem("rows")).toBe("edited");
  expect(data.get("rows")).toBe("saved");

  let eventCount = 0;
  const listener = () => {
    eventCount += 1;
  };
  storageEventApi?.addEventListener("storage", listener);
  expect(listeners.size).toBe(1);
  for (const forward of listeners) {
    forward({ storageArea: window.localStorage });
  }
  expect(eventCount).toBe(0);
  storageEventApi?.removeEventListener("storage", listener);
  expect(listeners.size).toBe(0);
});

test("uses browser storage while it is available", () => {
  data.set("rows", "saved");
  const { storage } = createMemoryFallbackStorage();
  expect(storage?.getItem("rows")).toBe("saved");
  storage?.setItem("rows", "edited");
  expect(data.get("rows")).toBe("edited");
  storage?.removeItem("rows");
  expect(data.has("rows")).toBe(false);
});

test("leaves storage undefined without a browser window", () => {
  Reflect.deleteProperty(globalThis, "window");
  const adapter = createMemoryFallbackStorage();
  expect(adapter.storage).toBeUndefined();
  expect(adapter.storageEventApi).toBeUndefined();
});
