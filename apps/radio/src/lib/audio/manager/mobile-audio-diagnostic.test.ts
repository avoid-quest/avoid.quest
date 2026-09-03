import { describe, expect, test } from "bun:test";
import {
  redactMobileInputDiagnostics,
  redactMobileOutputSnapshot,
  summarizeCaptureLatency,
  summarizePlaybackWindow,
} from "./mobile-audio-diagnostic";

describe("mobile audio diagnostic", () => {
  test("classifies the selected capture latency against its range", () => {
    expect(
      summarizeCaptureLatency({
        actual: { latency: 0.04 },
        capabilities: { latency: { max: 0.04, min: 0.02 } },
      } as never)
    ).toEqual({
      capabilityMaxMs: 40,
      capabilityMinMs: 20,
      selectedMs: 40,
      selection: "maximum",
    });
  });

  test("reports playback counters and reset-scoped latency for the capture window", () => {
    expect(
      summarizePlaybackWindow(
        {
          averageLatencyMs: 7,
          maximumLatencyMs: 9,
          minimumLatencyMs: 5,
          totalDurationMs: 12_000,
          underrunDurationMs: 4,
          underrunEvents: 2,
        },
        {
          averageLatencyMs: 8,
          maximumLatencyMs: 11,
          minimumLatencyMs: 6,
          totalDurationMs: 17_000,
          underrunDurationMs: 10,
          underrunEvents: 4,
        },
        5000,
        true
      )
    ).toEqual({
      averageLatencyMs: 8,
      latencyResetAtStart: true,
      maximumLatencyMs: 11,
      minimumLatencyMs: 6,
      nonUnderrunDurationDeltaMs: 4994,
      reportedDurationPercent: 100,
      totalDurationDeltaMs: 5000,
      underrunDurationDeltaMs: 6,
      underrunEventsDelta: 2,
      underrunPercent: 0.12,
    });
  });

  test("rejects decreasing cumulative playback counters", () => {
    expect(
      summarizePlaybackWindow(
        {
          averageLatencyMs: 7,
          maximumLatencyMs: 9,
          minimumLatencyMs: 5,
          totalDurationMs: 12_000,
          underrunDurationMs: 4,
          underrunEvents: 2,
        },
        {
          averageLatencyMs: 8,
          maximumLatencyMs: 11,
          minimumLatencyMs: 6,
          totalDurationMs: 11_000,
          underrunDurationMs: 3,
          underrunEvents: 1,
        },
        5000,
        false
      )
    ).toBeNull();
  });

  test("redacts device and group identifiers from every input section", () => {
    const redacted = redactMobileInputDiagnostics({
      actual: { deviceId: "actual-device", groupId: "actual-group" },
      capabilities: {
        deviceId: "capability-device",
        groupId: "capability-group",
      },
      label: "Default",
      latencyConstraintSupported: true,
      muted: false,
      readyState: "live",
      requested: { deviceId: { exact: "requested-device" } },
    } as never);

    expect(JSON.stringify(redacted)).not.toContain("device");
    expect(JSON.stringify(redacted)).not.toContain("group");
  });

  test("redacts selected output device identifiers without changing defaults", () => {
    const redacted = redactMobileOutputSnapshot({
      cueActive: true,
      deckCueEnabled: { "deck-a": true },
      headphoneVolume: 0.5,
      settings: {
        cueDelayMs: 10,
        cueOutputId: "persistent-cue-device-id",
        mainDelayMs: 20,
        mainOutputId: "persistent-main-device-id",
      },
      sinkSelectionSupported: true,
    });

    expect(redacted).toEqual({
      cueActive: true,
      deckCueEnabled: { "deck-a": true },
      headphoneVolume: 0.5,
      settings: {
        cueDelayMs: 10,
        cueOutputId: "<redacted>",
        mainDelayMs: 20,
        mainOutputId: "<redacted>",
      },
      sinkSelectionSupported: true,
    });
    expect(
      redactMobileOutputSnapshot({
        ...redacted,
        settings: {
          ...redacted.settings,
          cueOutputId: null,
          mainOutputId: "default",
        },
      }).settings
    ).toEqual({
      cueDelayMs: 10,
      cueOutputId: null,
      mainDelayMs: 20,
      mainOutputId: "default",
    });
  });
});
