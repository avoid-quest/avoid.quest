import { describe, expect, test } from "bun:test";
import { createLocalMidiMappingPersistence } from "./local-midi-mapping-persistence";
import { createMidiControl, type MidiBrowserAdapter } from "./midi-control";

const unsupportedBrowser: MidiBrowserAdapter = {
  cancelFrame: () => undefined,
  isSupported: () => false,
  now: () => 0,
  requestAccess: () => Promise.reject(new Error("unsupported")),
  requestFrame: () => 1,
  subscribePermission: () => () => undefined,
};

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

  test("starts with defaults when stored JSON has invalid MIDI state", () => {
    const invalidStates = [
      {},
      { version: 2, state: {} },
      {
        version: 2,
        state: {
          activePresetId: null,
          enabled: true,
          mappings: [{ channel: 0, control: 1, targetId: 42, type: "cc" }],
        },
      },
      {
        version: 2,
        state: {
          activePresetId: null,
          enabled: true,
          mappings: [
            {
              channel: 0,
              control: 1,
              targetId: "deck-a:volume",
              transform: {
                curve: "linear",
                invert: false,
                max: 1,
                min: "0",
              },
              type: "cc",
            },
          ],
        },
      },
    ];
    for (const state of invalidStates) {
      withLocalStorage(
        {
          getItem() {
            return JSON.stringify(state);
          },
        },
        () => {
          const control = createMidiControl({
            browser: unsupportedBrowser,
            persistence: createLocalMidiMappingPersistence(),
            staticActions: [],
          });

          expect(control.getSnapshot().mappings).toEqual([]);
          expect(control.getSnapshot().enabled).toBe(false);
        }
      );
    }
  });
});
