import { describe, expect, mock, test } from "bun:test";
import type { AudioState, Radio } from "../playback/index.js";
import { createSoundInstance } from "./audio-manager-types.js";
import { VolumeController } from "./volume-controller.js";

const radio: Radio = {
  id: "radio-1",
  name: "Test Radio",
  streamUrl: "https://example.com/stream.mp3",
};

describe("VolumeController", () => {
  test("stores per-sound and global volume state without Web Audio nodes", () => {
    const sound = createSoundInstance(radio, "deck-a");
    const stateUpdates: AudioState[] = [];
    const volume = new VolumeController({
      getSound: (soundId) => (soundId === "deck-a" ? sound : null),
      getSounds: () => [["deck-a", sound]],
      notifyListeners: (_soundId, state) => stateUpdates.push(state),
    });

    volume.set("deck-a", 1.5);
    expect(sound.volume).toBe(1);
    expect(volume.getSoundVolume("deck-a")).toBe(1);

    volume.muteSound("deck-a");
    expect(sound.volume).toBe(0);
    expect(volume.isSoundMuted("deck-a")).toBe(true);

    volume.unmuteSound("deck-a");
    expect(sound.volume).toBe(1);
    expect(volume.isSoundMuted("deck-a")).toBe(false);

    volume.setGlobalVolume(0.25);
    volume.muteGlobal();
    expect(volume.getGlobalVolume()).toBe(0);
    expect(volume.isGlobalMuted()).toBe(true);

    volume.unmuteGlobal();
    expect(volume.getGlobalVolume()).toBe(0.25);
    expect(volume.isGlobalMuted()).toBe(false);

    expect(stateUpdates.at(-1)?.volume).toBe(1);
  });

  test("holds the sampled curve value when cancelAndHoldAtTime is unavailable", () => {
    const sound = createSoundInstance(radio, "deck-a");
    let currentTime = 0;
    const gain = {
      cancelScheduledValues: mock(() => undefined),
      setTargetAtTime: mock(() => undefined),
      setValueAtTime: mock((value: number, _time: number) => {
        gain.value = value;
      }),
      setValueCurveAtTime: mock(() => undefined),
      value: 0.0001,
    };
    sound.nodes = {
      gain: { gain },
    } as unknown as NonNullable<typeof sound.nodes>;
    const volume = new VolumeController({
      getContext: () => ({ currentTime }) as AudioContext,
      getSound: (soundId) => (soundId === "deck-a" ? sound : null),
      getSounds: () => [["deck-a", sound]],
      notifyListeners: () => undefined,
    });

    volume.scheduleVolumeCurve("deck-a", new Float32Array([0, 1]), 1000);
    currentTime = 0.5;
    volume.set("deck-a", 0.25);

    expect(gain.cancelScheduledValues).toHaveBeenLastCalledWith(0.5);
    expect(gain.setValueAtTime).toHaveBeenCalledTimes(1);
    expect(gain.setValueAtTime.mock.calls[0]?.[0]).toBeCloseTo(0.500_05, 5);
    expect(gain.setValueAtTime.mock.calls[0]?.[1]).toBe(0.5);
    expect(gain.setTargetAtTime).toHaveBeenLastCalledWith(0.25, 0.5, 0.02);
  });
});
