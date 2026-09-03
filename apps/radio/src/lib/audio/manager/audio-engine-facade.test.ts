import { describe, expect, mock, test } from "bun:test";
import {
  AUDIO_ENGINE_FACADE_PUBLIC_METHOD_BUDGET,
  countAudioEngineFacadeMethods,
  createAudioEngineFacade,
} from "./audio-engine-facade.js";
import type { AudioManager } from "./audio-manager.js";

function createTestAudioManager() {
  return {
    playSound: mock(async (_soundId: string, _volume?: number) => undefined),
    pauseSound: mock((_soundId: string) => undefined),
    seekSound: mock((_soundId: string, _position: number) => undefined),
    refreshStreamUrl: mock(
      async (_soundId: string, _newUrl: string, _seekPosition?: number) =>
        undefined
    ),
    setVolume: mock((_soundId: string, _volume: number) => undefined),
    setGlobalVolume: mock((_volume: number) => undefined),
  } satisfies Pick<
    AudioManager,
    | "playSound"
    | "pauseSound"
    | "seekSound"
    | "refreshStreamUrl"
    | "setVolume"
    | "setGlobalVolume"
  >;
}

describe("audio engine facade", () => {
  test("stays within its public method budget", () => {
    const facade = createAudioEngineFacade(createTestAudioManager());

    expect(countAudioEngineFacadeMethods(facade)).toBeLessThanOrEqual(
      AUDIO_ENGINE_FACADE_PUBLIC_METHOD_BUDGET
    );
  });

  test("delegates transport and volume commands to the audio manager", async () => {
    const manager = createTestAudioManager();
    const facade = createAudioEngineFacade(manager);

    await facade.playback.play("sound-1", 0.5);
    facade.playback.pause("sound-1");
    facade.playback.seek("sound-1", 12);
    await facade.playback.refreshStreamUrl("sound-1", "https://example.test");
    facade.volume.setChannelVolume("sound-1", 0.25);
    facade.volume.setMasterVolume(0.75);

    expect(manager.playSound).toHaveBeenCalledWith("sound-1", 0.5);
    expect(manager.pauseSound).toHaveBeenCalledWith("sound-1");
    expect(manager.seekSound).toHaveBeenCalledWith("sound-1", 12);
    expect(manager.refreshStreamUrl).toHaveBeenCalledWith(
      "sound-1",
      "https://example.test",
      undefined
    );
    expect(manager.setVolume).toHaveBeenCalledWith("sound-1", 0.25);
    expect(manager.setGlobalVolume).toHaveBeenCalledWith(0.75);
  });
});
