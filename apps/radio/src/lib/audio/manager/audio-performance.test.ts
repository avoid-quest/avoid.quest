import { describe, expect, test } from "bun:test";
import {
  createAudioPerformanceDiagnostics,
  summarizeQuantumPerformance,
} from "./audio-performance";

describe("audio performance diagnostics", () => {
  test("counts each runtime and meter without creating audio resources", () => {
    const diagnostics = createAudioPerformanceDiagnostics({
      backends: ["bypass", "compatibility", "official", "official", null],
      context: null,
      effects: null,
      inputs: [],
      meter: {
        activeFallbackMeters: 1,
        activeOpenDawMeters: 2,
        listenerCount: 3,
      },
      soundCount: 5,
    });

    expect(diagnostics.topology).toEqual({
      bypassSounds: 1,
      compatibilityWorklets: 1,
      meterFallbacks: 1,
      meterListeners: 3,
      meterWorklets: 2,
      officialSounds: 2,
      soundCount: 5,
    });
  });

  test("summarizes populated openDAW timing samples against their deadline", () => {
    expect(
      summarizeQuantumPerformance(new Float32Array([0, 0.25, 0.5, 1, 3]), 2)
    ).toEqual({
      deadlineMisses: 1,
      maxMs: 3,
      observedSampleCount: 5,
      p95Ms: 3,
      p99LoadPercent: 150,
      p99Ms: 3,
      sampleCount: 4,
      status: "measured",
      zeroSampleCount: 1,
    });
  });

  test("distinguishes a stalled timing clock from an empty interval", () => {
    expect(summarizeQuantumPerformance(new Float32Array([0, 0, 0]), 2)).toEqual(
      {
        deadlineMisses: 0,
        maxMs: 0,
        observedSampleCount: 3,
        p95Ms: 0,
        p99LoadPercent: 0,
        p99Ms: 0,
        sampleCount: 0,
        status: "clock-unavailable",
        zeroSampleCount: 3,
      }
    );
  });
});
