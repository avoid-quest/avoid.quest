import { afterEach, describe, expect, test } from "bun:test";
import { createDefaultEffectConfig } from "../dsp/effects/registry";
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
      "https://audio.example/stream.mp3",
    ]);
    expect(events.indexOf("media-play")).toBeGreaterThanOrEqual(0);
    expect(events.some((event) => event.startsWith("worklet-module:"))).toBe(
      false
    );
    expect(connectedNodePairs).toContain("media-source -> gain");
    expect(connectedNodePairs).toContain("gain -> stereo-panner");
    expect(connectedNodePairs).toContain("stereo-panner -> biquad");
    expect(connectedNodePairs).toContain("biquad -> gain");
    expect(workletMessageTypes).toEqual([]);
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
      ])
    );
  });

  test("pauses and replays a dry browser-backed sound without creating a worklet", async () => {
    harness = installAudioEngineLifecycleHarness();
    const manager = AudioManager.getInstance();
    const radio: Radio = {
      id: "radio-1",
      name: "Lifecycle Radio",
      streamUrl: "https://audio.example/stream.mp3",
    };

    const soundId = manager.createSound(radio, "sound-lifecycle");

    await manager.playSound(soundId, 0.4);
    manager.pauseSound(soundId);
    await manager.playSound(soundId, 0.4);

    const workletMessageTypes = harness
      .workletMessages()
      .map((message) => message.type);

    expect(harness.events()).toEqual(
      expect.arrayContaining(["media-pause", "media-play"])
    );
    expect(workletMessageTypes).toEqual([]);

    manager.cleanupSound(soundId);
  });

  test("rejects a failed media refresh and preserves the active radio", async () => {
    harness = installAudioEngineLifecycleHarness({
      failMediaUrlIncludes: "refresh-fails",
    });
    const manager = AudioManager.getInstance();
    const states: AudioState[] = [];
    const radio: Radio = {
      id: "radio-1",
      name: "Lifecycle Radio",
      streamUrl: "https://audio.example/original.mp3",
      streamFormat: "progressive",
    };
    const soundId = manager.createSound(radio, "sound-lifecycle");
    manager.subscribe(soundId, (state) => states.push(state));
    await manager.playSound(soundId, 0.4);

    await expect(
      manager.refreshStreamUrl(
        soundId,
        "https://audio.example/refresh-fails",
        12,
        "progressive"
      )
    ).rejects.toThrow("Audio stream failed to load");

    expect(manager.getSoundRadio(soundId)).toEqual(radio);
    expect(states.at(-1)).toMatchObject({
      isLoading: false,
      isPlaying: false,
      error: { code: "STREAM_FETCH_FAILED" },
    });
  });

  test("infers a legacy refresh format when the caller omits it", async () => {
    harness = installAudioEngineLifecycleHarness();
    const manager = AudioManager.getInstance();
    const soundId = manager.createSound(
      {
        id: "radio-1",
        name: "Lifecycle Radio",
        streamUrl: "https://audio.example/original.mp3",
      },
      "sound-lifecycle"
    );
    await manager.playSound(soundId, 0.4);
    const activeRadio = manager.getSoundRadio(soundId);
    if (!activeRadio) {
      throw new Error("Expected active radio");
    }
    activeRadio.streamFormat = "hls";

    await manager.refreshStreamUrl(
      soundId,
      "https://audio.example/refreshed.mp3",
      12
    );

    expect(manager.getSoundRadio(soundId)).toMatchObject({
      streamFormat: "progressive",
      streamUrl: "https://audio.example/refreshed.mp3",
    });
  });

  test("shares one effect runtime when deck restoration and graph connection initialize concurrently", async () => {
    harness = installAudioEngineLifecycleHarness({
      simulateWorkletSourceErrors: true,
    });
    const manager = AudioManager.getInstance();
    const states: AudioState[] = [];
    const soundId = manager.createSound(
      {
        id: "radio-1",
        name: "Lifecycle Radio",
        streamUrl: "https://audio.example/stream.mp3",
      },
      "sound-lifecycle"
    );
    manager.subscribe(soundId, (state) => states.push(state));

    const [graphManager, restoredManager] = await Promise.all([
      manager.effects.getOrCreateWorkletManager(soundId),
      manager.effects.getOrCreateWorkletManager(soundId),
    ]);
    graphManager.createStreamSource(soundId);
    graphManager.startSource(soundId);
    manager.addEffect(
      soundId,
      createDefaultEffectConfig("delay", "delay-1", 0)
    );
    await Promise.resolve();

    expect(states.some((state) => state.error !== null)).toBe(false);
    expect(restoredManager).toBe(graphManager);
    expect(
      harness.workletMessages().filter(({ type }) => type === "CREATE_SOURCE")
    ).toHaveLength(1);

    manager.cleanupSound(soundId);
  });

  test("stops early media playback if a required compatibility worklet fails", async () => {
    harness = installAudioEngineLifecycleHarness({ failWorkletModule: true });
    const manager = AudioManager.getInstance();
    const states: AudioState[] = [];
    const radio: Radio = {
      id: "radio-1",
      name: "Lifecycle Radio",
      streamUrl: "https://audio.example/stream.mp3",
    };

    const soundId = manager.createSound(radio, "sound-lifecycle");
    manager.addEffect(
      soundId,
      createDefaultEffectConfig("pitchShifter", "pitch-1", 0)
    );
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
    expect(workletIndex).toBeGreaterThanOrEqual(0);
    expect(pauseIndex).toBeGreaterThan(playIndex);
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
