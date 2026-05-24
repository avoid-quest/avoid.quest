import { describe, expect, mock, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import { attachWorkletManagerListeners } from "./audio-manager-graph";
import type { SoundInstance } from "./audio-manager-types";

type WorkletEventHandlers = Record<string, (payload: unknown) => void>;

function createTestSoundInstance(radio: Radio): SoundInstance {
  return {
    radio,
    sourceId: "sound-1",
    volume: 1,
    playing: true,
    loading: false,
    buffering: false,
    nodes: null,
    playbackSource: null,
    deviceSource: null,
    unsubscribe: null,
    meterUnsubscribe: null,
    isDeviceInput: false,
  } as unknown as SoundInstance;
}

describe("audio manager graph worklet errors", () => {
  test("does not surface stale worklet SOURCE_NOT_FOUND as playback failure", () => {
    const handlers: WorkletEventHandlers = {};
    const workletManager = {
      on: mock((event: string, callback: (payload: unknown) => void) => {
        handlers[event] = callback;
      }),
    };
    const notifyListeners = mock(
      (_soundId: string, _state: unknown) => undefined
    );
    const originalWarn = console.warn;
    console.warn = mock(() => undefined);

    try {
      attachWorkletManagerListeners({
        wm: workletManager as never,
        soundId: "sound-1",
        sounds: new Map([
          [
            "sound-1",
            createTestSoundInstance({
              id: "station-1",
              name: "Station 1",
              streamUrl: "https://radio.example/one.mp3",
            }),
          ],
        ]),
        notifyListeners,
        meterListeners: new Map(),
      });

      handlers.sourceError?.({
        id: "err-1",
        sourceId: "sound-1",
        error: "Cannot pause: source sound-1 not found",
        code: "SOURCE_NOT_FOUND",
        timestamp: 123,
      });

      expect(notifyListeners).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        "[AudioManager] Ignoring stale worklet source error: Cannot pause: source sound-1 not found"
      );
    } finally {
      console.warn = originalWarn;
    }
  });

  test("surfaces non-pause SOURCE_NOT_FOUND worklet errors", () => {
    const handlers: WorkletEventHandlers = {};
    const workletManager = {
      on: mock((event: string, callback: (payload: unknown) => void) => {
        handlers[event] = callback;
      }),
    };
    const notifyListeners = mock(
      (_soundId: string, _state: unknown) => undefined
    );

    attachWorkletManagerListeners({
      wm: workletManager as never,
      soundId: "sound-1",
      sounds: new Map([
        [
          "sound-1",
          createTestSoundInstance({
            id: "station-1",
            name: "Station 1",
            streamUrl: "https://radio.example/one.mp3",
          }),
        ],
      ]),
      notifyListeners,
      meterListeners: new Map(),
    });

    handlers.sourceError?.({
      id: "err-1",
      sourceId: "sound-1",
      error: "Cannot start: source sound-1 not found",
      code: "SOURCE_NOT_FOUND",
      timestamp: 123,
    });

    expect(notifyListeners).toHaveBeenCalledWith(
      "sound-1",
      expect.objectContaining({
        error: expect.objectContaining({
          code: "PLAYBACK_FAILED",
          message: "Cannot start: source sound-1 not found",
        }),
      })
    );
  });
});
