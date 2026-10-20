import type { StorageApi, StorageEventApi } from "@tanstack/react-db";

type StorageListener = (event: StorageEvent) => void;

export type MemoryFallbackStorage = {
  /** For `localStorageCollectionOptions`; undefined without a window. */
  storage: StorageApi | undefined;
  storageEventApi: StorageEventApi | undefined;
  /**
   * Run a startup write. If the browser refuses it, e.g. storage is full or
   * blocked, move the collection to memory for this visit and run it again,
   * rather than leave the app without the rows. A failed write rolls its
   * rows back, so `write` must insert them again.
   */
  persistOrKeepInMemory: (
    write: () => Promise<unknown>,
    label: string
  ) => Promise<void>;
};

/** localStorage for one collection, or memory once a startup write fails. */
export function createMemoryFallbackStorage(): MemoryFallbackStorage {
  let keepInMemory = false;
  const memory = new Map<string, string>();
  // Resolved as TanStack DB does, so a page without a window keeps its default.
  const browserStorage =
    typeof window === "undefined" ? undefined : window.localStorage;

  const storage: StorageApi | undefined = browserStorage && {
    getItem: (key) =>
      keepInMemory ? (memory.get(key) ?? null) : browserStorage.getItem(key),
    removeItem: (key) => {
      if (keepInMemory) {
        memory.delete(key);
      } else {
        browserStorage.removeItem(key);
      }
    },
    setItem: (key, value) => {
      if (keepInMemory) {
        memory.set(key, value);
      } else {
        browserStorage.setItem(key, value);
      }
    },
  };

  const forwarded = new WeakMap<StorageListener, StorageListener>();

  /**
   * Other tabs' writes, presented as events from `storage`: TanStack DB only
   * takes events from its own storage. A collection in memory ignores them.
   */
  const storageEventApi: StorageEventApi | undefined = storage && {
    addEventListener: (type, listener) => {
      const forward = (event: StorageEvent) => {
        if (keepInMemory || event.storageArea !== browserStorage) {
          return;
        }
        listener(
          new Proxy(event, {
            get: (target, property) =>
              property === "storageArea"
                ? storage
                : Reflect.get(target, property),
          })
        );
      };
      forwarded.set(listener, forward);
      window.addEventListener(type, forward);
    },
    removeEventListener: (type, listener) => {
      const forward = forwarded.get(listener);
      if (forward) {
        forwarded.delete(listener);
        window.removeEventListener(type, forward);
      }
    },
  };

  return {
    persistOrKeepInMemory: async (write, label) => {
      try {
        await write();
      } catch (error) {
        if (keepInMemory || !storage) {
          throw error;
        }
        console.warn(
          `[${label}] Could not save; keeping them for this visit`,
          error
        );
        keepInMemory = true;
        await write();
      }
    },
    storage,
    storageEventApi,
  };
}
