import { describe, expect, test } from "bun:test";
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
});
