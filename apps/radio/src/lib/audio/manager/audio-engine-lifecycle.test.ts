import { afterEach, describe, expect, test } from "bun:test";
import { AudioContextManager, type AudioState, type Radio } from "../playback";
import {
  type AudioEngineLifecycleHarness,
  installAudioEngineLifecycleHarness,
} from "./audio-engine-lifecycle-test-harness";
import { AudioManager } from "./audio-manager";

describe("audio engine lifecycle", () => {
  let harness: AudioEngineLifecycleHarness | null = null;

  afterEach(() => {
    AudioManager.resetInstance();
    AudioContextManager.resetForTesting();
    harness?.restore();
    harness = null;
  });

  test("creates, loads, connects, notifies, and cleans up one browser-backed sound", async () => {
    harness = installAudioEngineLifecycleHarness();
    const manager = AudioManager.getInstance();
    const states: AudioState[] = [];
    const radio: Radio = {
      id: "radio-1",
      name: "Lifecycle Radio",
      streamUrl: "https://audio.example/stream.mp3",
    };

    const soundId = manager.createSound(radio, "sound-lifecycle");
    const unsubscribe = manager.subscribe(soundId, (state) => {
      states.push(state);
    });

    await manager.playSound(soundId, 0.4);

    expect(harness.loadedMediaUrls()).toEqual([
      "/api/stream-proxy?url=https%3A%2F%2Faudio.example%2Fstream.mp3",
    ]);
    expect(harness.connectedNodePairs()).toContain("media-source -> gain");
    expect(harness.connectedNodePairs()).toContain("gain -> stereo-panner");
    expect(harness.connectedNodePairs()).toContain("stereo-panner -> biquad");
    expect(harness.connectedNodePairs()).toContain("biquad -> worklet");
    expect(harness.connectedNodePairs()).toContain("worklet-gain -> gain");
    expect(harness.workletMessages().map((message) => message.type)).toContain(
      "CREATE_SOURCE"
    );
    expect(harness.workletMessages().map((message) => message.type)).toContain(
      "START_SOURCE"
    );
    expect(states).toContainEqual(
      expect.objectContaining({
        isLoading: true,
        isPlaying: true,
        volume: 0.4,
      })
    );
    expect(states.at(-1)).toEqual(
      expect.objectContaining({
        isLoading: false,
        isPlaying: true,
        volume: 0.4,
        error: null,
      })
    );

    manager.cleanupSound(soundId);
    unsubscribe();

    expect(manager.hasSound(soundId)).toBe(false);
    expect(states.at(-1)).toEqual(
      expect.objectContaining({ isPlaying: false })
    );
    expect(harness.disconnectedNodeNames()).toEqual(
      expect.arrayContaining([
        "media-source",
        "gain",
        "stereo-panner",
        "biquad",
        "analyser",
        "worklet",
        "worklet-gain",
      ])
    );
  });
});
