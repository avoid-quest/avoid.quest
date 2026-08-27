import {
  getOutputRouting,
  type OutputRoutingSnapshot,
} from "../../output-routing.js";
import {
  type AudioContextPerformanceSnapshot,
  getAudioContextManager,
  getMobileAudioBufferFrames,
} from "../playback/audio-context.js";
import type { DeviceSourceDiagnostics } from "../playback/device-source.js";
import { AudioManager } from "./audio-manager.js";
import type { AudioPerformanceDiagnostics } from "./audio-performance.js";

const wait = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));
const redactOutputDeviceId = (deviceId: string): string =>
  deviceId === "default" ? deviceId : "<redacted>";

type PlaybackStats = NonNullable<
  AudioContextPerformanceSnapshot["playbackStats"]
>;

export function summarizePlaybackWindow(
  start: PlaybackStats | null,
  end: PlaybackStats | null,
  elapsedWallTimeMs: number,
  latencyResetAtStart: boolean
) {
  if (!(start && end && elapsedWallTimeMs > 0)) {
    return null;
  }
  const totalDurationDeltaMs = end.totalDurationMs - start.totalDurationMs;
  const underrunDurationDeltaMs =
    end.underrunDurationMs - start.underrunDurationMs;
  const underrunEventsDelta = end.underrunEvents - start.underrunEvents;
  if (
    totalDurationDeltaMs < 0 ||
    underrunDurationDeltaMs < 0 ||
    underrunEventsDelta < 0 ||
    underrunDurationDeltaMs > totalDurationDeltaMs
  ) {
    return null;
  }
  return {
    averageLatencyMs: latencyResetAtStart ? end.averageLatencyMs : null,
    latencyResetAtStart,
    maximumLatencyMs: latencyResetAtStart ? end.maximumLatencyMs : null,
    minimumLatencyMs: latencyResetAtStart ? end.minimumLatencyMs : null,
    nonUnderrunDurationDeltaMs: totalDurationDeltaMs - underrunDurationDeltaMs,
    reportedDurationPercent: Number(
      ((totalDurationDeltaMs / elapsedWallTimeMs) * 100).toFixed(3)
    ),
    totalDurationDeltaMs,
    underrunDurationDeltaMs,
    underrunEventsDelta,
    underrunPercent:
      totalDurationDeltaMs === 0
        ? 0
        : Number(
            ((underrunDurationDeltaMs / totalDurationDeltaMs) * 100).toFixed(3)
          ),
  };
}

export function redactMobileInputDiagnostics(
  input: DeviceSourceDiagnostics
): DeviceSourceDiagnostics {
  return {
    ...input,
    actual: {
      ...input.actual,
      deviceId: undefined,
      groupId: undefined,
    },
    capabilities: input.capabilities
      ? {
          ...input.capabilities,
          deviceId: undefined,
          groupId: undefined,
        }
      : null,
    requested: { ...input.requested, deviceId: undefined },
  };
}

export function redactMobileOutputSnapshot(
  output: OutputRoutingSnapshot
): OutputRoutingSnapshot {
  return {
    ...output,
    settings: {
      ...output.settings,
      cueOutputId:
        output.settings.cueOutputId === null
          ? null
          : redactOutputDeviceId(output.settings.cueOutputId),
      mainOutputId: redactOutputDeviceId(output.settings.mainOutputId),
    },
  };
}

export function summarizeCaptureLatency(input: DeviceSourceDiagnostics) {
  const capabilityMin = input.capabilities?.latency?.min;
  const capabilityMax = input.capabilities?.latency?.max;
  const selected = input.actual.latency;
  let selection: "interior" | "maximum" | "minimum" | "unknown" = "unknown";
  if (
    typeof selected === "number" &&
    typeof capabilityMin === "number" &&
    typeof capabilityMax === "number"
  ) {
    if (selected === capabilityMin) {
      selection = "minimum";
    } else if (selected === capabilityMax) {
      selection = "maximum";
    } else {
      selection = "interior";
    }
  }
  return {
    capabilityMaxMs:
      typeof capabilityMax === "number" ? capabilityMax * 1000 : null,
    capabilityMinMs:
      typeof capabilityMin === "number" ? capabilityMin * 1000 : null,
    selectedMs: typeof selected === "number" ? selected * 1000 : null,
    selection,
    trial: input.latencyTrial
      ? {
          result: input.latencyTrial.result,
          targetMs: input.latencyTrial.target * 1000,
        }
      : null,
  };
}

function compactDiagnostics(diagnostics: AudioPerformanceDiagnostics) {
  const effects = diagnostics.effects
    ? {
        backend: diagnostics.effects.backend,
        cpuLoadPercent:
          diagnostics.effects.timing.status === "measured"
            ? diagnostics.effects.cpuLoadPercent
            : null,
        monitoringChannelCount: diagnostics.effects.monitoringChannelCount,
        perfIndex: diagnostics.effects.perfIndex,
        quantumBudgetMs: diagnostics.effects.quantumBudgetMs,
        soundCount: diagnostics.effects.soundCount,
        timing: diagnostics.effects.timing,
        workletCount: diagnostics.effects.workletCount,
      }
    : null;
  return {
    context: diagnostics.context,
    effects,
    inputs: diagnostics.inputs.map(({ diagnostics: input, soundId }) => {
      const redacted = redactMobileInputDiagnostics(input);
      return {
        captureLatency: summarizeCaptureLatency(input),
        diagnostics: {
          ...redacted,
          sampleRateMismatch:
            typeof redacted.actual.sampleRate === "number" &&
            diagnostics.context !== null
              ? redacted.actual.sampleRate !== diagnostics.context.sampleRate
              : null,
        },
        soundId,
      };
    }),
    topology: diagnostics.topology,
  };
}

export async function captureMobileAudioDiagnostic(durationMs = 5000) {
  const manager = AudioManager.getInstance();
  manager.setPerformanceMeasurementEnabled(true);
  const start = manager.getPerformanceDiagnostics();
  const latencyResetAtStart = getAudioContextManager().resetPlaybackLatency();
  const startedAt = performance.now();
  try {
    await wait(durationMs);
    const elapsedWallTimeMs = performance.now() - startedAt;
    const end = manager.getPerformanceDiagnostics();
    const playbackWindow = summarizePlaybackWindow(
      start.context?.playbackStats ?? null,
      end.context?.playbackStats ?? null,
      elapsedWallTimeMs,
      latencyResetAtStart
    );
    return {
      capturedAt: new Date().toISOString(),
      durationMs,
      elapsedWallTimeMs,
      end: compactDiagnostics(end),
      environment: {
        crossOriginIsolated: globalThis.crossOriginIsolated,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        requestedMobileBufferFrames: getMobileAudioBufferFrames(),
        userAgent: navigator.userAgent,
      },
      output: redactMobileOutputSnapshot(getOutputRouting().getSnapshot()),
      playbackUnderrunEventsDelta: playbackWindow?.underrunEventsDelta ?? null,
      playbackWindow,
      start: compactDiagnostics(start),
    };
  } finally {
    manager.setPerformanceMeasurementEnabled(false);
  }
}
