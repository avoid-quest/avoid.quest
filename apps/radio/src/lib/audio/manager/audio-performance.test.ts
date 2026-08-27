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
      p95Ms: 3,
      p99LoadPercent: 150,
      p99Ms: 3,
      sampleCount: 4,
    });
  });
});
