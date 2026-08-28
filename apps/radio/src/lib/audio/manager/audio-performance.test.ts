import { describe, expect, test } from "bun:test";
import { createAudioPerformanceDiagnostics } from "./audio-performance";

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
});
