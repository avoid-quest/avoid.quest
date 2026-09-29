import { afterEach, describe, expect, test } from "bun:test";
import type { AudioState, PlaybackSource } from "../playback/index.js";
import type { SoundRegistry } from "./sound-registry";

// Other test files replace this module with mock.module, which leaks across
// files in one `bun test` process. The query suffix loads a real instance.
const { AudioManager } = (await import(
  `./audio-manager.ts?${"unmocked"}`
)) as typeof import("./audio-manager");

type AudioManagerInstance = ReturnType<typeof AudioManager.getInstance>;

function getRegistry(manager: AudioManagerInstance): SoundRegistry {
  return (manager as unknown as { soundRegistry: SoundRegistry }).soundRegistry;
}

function createPendingSource(): PlaybackSource {
  return {
    cleanup: () => undefined,
    isActive: true,
    pause: () => undefined,
    play: () => new Promise<void>(() => undefined),
    stop: () => undefined,
  } as unknown as PlaybackSource;
}

afterEach(() => {
  AudioManager.resetInstance();
});

describe("AudioManager", () => {
  test("pausing a sound that is still connecting settles its loading state", async () => {
    const manager = AudioManager.getInstance();
    const soundId = manager.createSound(
      {
        id: "station",
        name: "Station",
        streamUrl: "https://radio.example/station.mp3",
      },
      "single:single-a",
      "native"
    );
    const instance = getRegistry(manager).get(soundId);
    if (!instance) {
      throw new Error("sound was not created");
    }
    instance.playbackSource = createPendingSource();
    const states: AudioState[] = [];
    manager.subscribe(soundId, (state) => {
      states.push(state);
    });

    manager.playSound(soundId, 0.8).catch(() => undefined);
    await Promise.resolve();
    expect(states.at(-1)).toMatchObject({ isLoading: true, isPlaying: true });

    manager.pauseSound(soundId);

    expect(states.at(-1)).toMatchObject({ isLoading: false, isPlaying: false });
    expect(instance.loading).toBe(false);
  });
});
