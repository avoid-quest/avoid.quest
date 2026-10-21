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

/** localStorage for one collection, or memory when storage is unavailable. */
export function createMemoryFallbackStorage(): MemoryFallbackStorage {
  let keepInMemory = false;
  const memory = new Map<string, string>();
  // Resolved as TanStack DB does, so a page without a window keeps its default.
  let browserStorage: StorageApi | undefined;
  try {
    browserStorage =
      typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    keepInMemory = true;
  }

  const storage: StorageApi | undefined =
    typeof window === "undefined"
      ? undefined
      : {
          getItem: (key) => {
            if (!keepInMemory && browserStorage) {
              try {
                return browserStorage.getItem(key);
              } catch {
                keepInMemory = true;
              }
            }
            return memory.get(key) ?? null;
          },
          removeItem: (key) => {
            if (keepInMemory || !browserStorage) {
              memory.delete(key);
            } else {
              browserStorage.removeItem(key);
            }
          },
          setItem: (key, value) => {
            if (keepInMemory || !browserStorage) {
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
