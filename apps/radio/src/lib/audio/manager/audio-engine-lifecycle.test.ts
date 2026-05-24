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

    const events = harness.events();
    const connectedNodePairs = harness.connectedNodePairs();
    const workletMessageTypes = harness
      .workletMessages()
      .map((message) => message.type);

    expect(harness.loadedMediaUrls()).toEqual([
      "/api/stream-proxy?url=https%3A%2F%2Faudio.example%2Fstream.mp3",
    ]);
    expect(events.indexOf("media-play")).toBeGreaterThanOrEqual(0);
    expect(
      events.findIndex((event) => event.startsWith("worklet-module:"))
    ).toBeGreaterThan(events.indexOf("media-play"));
    expect(connectedNodePairs).toContain("media-source -> gain");
    expect(connectedNodePairs).toContain("gain -> stereo-panner");
    expect(connectedNodePairs).toContain("stereo-panner -> biquad");
    expect(connectedNodePairs.indexOf("biquad -> gain")).toBeLessThan(
      connectedNodePairs.indexOf("biquad -> worklet")
    );
    expect(connectedNodePairs).toContain("biquad -> worklet");
    expect(connectedNodePairs).toContain("worklet-gain -> gain");
    expect(workletMessageTypes).toContain("CREATE_SOURCE");
    expect(workletMessageTypes).toContain("START_SOURCE");
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

  test("stops early media playback if worklet initialization fails", async () => {
    harness = installAudioEngineLifecycleHarness({ failWorkletModule: true });
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

    await expect(manager.playSound(soundId, 0.4)).rejects.toThrow(
      "Worklet module failed"
    );

    const events = harness.events();
    const playIndex = events.indexOf("media-play");
    const workletIndex = events.findIndex((event) =>
      event.startsWith("worklet-module:")
    );
    const pauseIndex = events.lastIndexOf("media-pause");

    expect(playIndex).toBeGreaterThanOrEqual(0);
    expect(workletIndex).toBeGreaterThan(playIndex);
    expect(pauseIndex).toBeGreaterThan(workletIndex);
    expect(states.at(-1)).toEqual(
      expect.objectContaining({
        isLoading: false,
        isPlaying: false,
      })
    );
    expect(manager.hasSound(soundId)).toBe(true);

    manager.cleanupSound(soundId);
    unsubscribe();
  });
});
