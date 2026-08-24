import { describe, expect, test } from "bun:test";
import { supportsMediaElementVolumeControl } from "./media-element-volume-control.js";

function withAudioVolume(
  AudioMock: new () => { volume: number },
  callback: () => void
): void {
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: AudioMock,
  });
  try {
    callback();
  } finally {
    if (originalAudio) {
      Object.defineProperty(globalThis, "Audio", originalAudio);
    } else {
      Reflect.deleteProperty(globalThis, "Audio");
    }
  }
}

describe("supportsMediaElementVolumeControl", () => {
  test("returns false outside a browser", () => {
    const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
    Reflect.deleteProperty(globalThis, "Audio");
    try {
      expect(supportsMediaElementVolumeControl()).toBe(false);
    } finally {
      if (originalAudio) {
        Object.defineProperty(globalThis, "Audio", originalAudio);
      }
    }
  });

  test("returns false when iOS ignores an assigned media volume", () => {
    withAudioVolume(
      class {
        get volume() {
          return 1;
        }

        set volume(_value: number) {
          // iOS accepts the assignment but preserves the system volume.
        }
      },
      () => expect(supportsMediaElementVolumeControl()).toBe(false)
    );
  });

  test("returns true when media volume is writable", () => {
    withAudioVolume(
      class {
        volume = 1;
      },
      () => expect(supportsMediaElementVolumeControl()).toBe(true)
    );
  });
});
