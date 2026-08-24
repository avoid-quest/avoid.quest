import { describe, expect, test } from "bun:test";
import { createLocalMidiMappingPersistence } from "./local-midi-mapping-persistence";

function withLocalStorage(
  storage: Partial<Pick<Storage, "getItem" | "setItem">>,
  run: () => void
) {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage"
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  try {
    run();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "localStorage", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
}

describe("createLocalMidiMappingPersistence", () => {
  test("returns no mappings when browser storage cannot be read", () => {
    withLocalStorage(
      {
        getItem() {
          throw new Error("Storage access denied");
        },
      },
      () => {
        expect(createLocalMidiMappingPersistence().read()).toBeNull();
      }
    );
  });

  test("keeps mapping updates working when browser storage cannot be written", () => {
    withLocalStorage(
      {
        getItem() {
          return null;
        },
        setItem() {
          throw new Error("Storage quota exceeded");
        },
      },
      () => {
        expect(() =>
          createLocalMidiMappingPersistence().write({
            state: { activePresetId: null, enabled: true, mappings: [] },
            version: 2,
          })
        ).not.toThrow();
      }
    );
  });
});
