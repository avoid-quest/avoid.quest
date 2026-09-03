import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  getAudioContextOptions,
  resetAudioContextPlaybackLatency,
  snapshotAudioContext,
} from "./audio-context";

const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
});

describe("AudioContextManager latency policy", () => {
  test("uses openDAW's low-latency 48 kHz context profile", () => {
    expect(getAudioContextOptions()).toEqual({
      latencyHint: 0,
      sampleRate: 48_000,
    });
  });

  test("lets Firefox use the system sample rate", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Mozilla/5.0 Firefox/142.0" },
    });

    expect(getAudioContextOptions()).toEqual({ latencyHint: 0 });
  });

  test("uses the measured 2.67 ms latency hint on mobile", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Mozilla/5.0 (Linux; Android 16) Mobile" },
    });

    expect(getAudioContextOptions()).toEqual({
      latencyHint: 128 / 48_000,
      sampleRate: 48_000,
    });
  });

  test("exports native playback underruns and latency with explicit units", () => {
    const context = {
      baseLatency: 0.002,
      outputLatency: 0.006,
      playbackStats: {
        averageLatency: 0.007,
        maximumLatency: 0.009,
        minimumLatency: 0.005,
        totalDuration: 12,
        underrunDuration: 0.004,
        underrunEvents: 2,
      },
      renderQuantumSize: 128,
      sampleRate: 48_000,
      state: "running",
    } as unknown as AudioContext;

    expect(snapshotAudioContext(context)).toEqual({
      baseLatencyMs: 2,
      outputLatencyMs: 6,
      playbackStats: {
        averageLatencyMs: 7,
        maximumLatencyMs: 9,
        minimumLatencyMs: 5,
        totalDurationMs: 12_000,
        underrunDurationMs: 4,
        underrunEvents: 2,
      },
      renderQuantumSize: 128,
      sampleRate: 48_000,
      state: "running",
    });
  });

  test("resets native playback latency statistics when supported", () => {
    const resetLatency = mock(() => undefined);
    const context = {
      playbackStats: { resetLatency },
    } as unknown as AudioContext;

    expect(resetAudioContextPlaybackLatency(context)).toBe(true);
    expect(resetLatency).toHaveBeenCalledTimes(1);
    expect(
      resetAudioContextPlaybackLatency({} as unknown as AudioContext)
    ).toBe(false);
  });
});
