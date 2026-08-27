import { getOutputRouting } from "../../output-routing.js";
import { AudioManager } from "./audio-manager.js";
import type { AudioPerformanceDiagnostics } from "./audio-performance.js";

const wait = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

function compactDiagnostics(diagnostics: AudioPerformanceDiagnostics) {
  const effects = diagnostics.effects
    ? {
        backend: diagnostics.effects.backend,
        cpuLoadPercent: diagnostics.effects.cpuLoadPercent,
        monitoringChannelCount: diagnostics.effects.monitoringChannelCount,
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
      const actual = { ...input.actual };
      const requested = { ...input.requested };
      actual.deviceId = undefined;
      actual.groupId = undefined;
      requested.deviceId = undefined;
      return {
        diagnostics: {
          ...input,
          actual,
          requested,
          sampleRateMismatch:
            typeof actual.sampleRate === "number" &&
            diagnostics.context !== null
              ? actual.sampleRate !== diagnostics.context.sampleRate
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
  try {
    await wait(durationMs);
    const end = manager.getPerformanceDiagnostics();
    const startUnderruns = start.context?.playbackStats?.underrunEvents;
    const endUnderruns = end.context?.playbackStats?.underrunEvents;
    return {
      capturedAt: new Date().toISOString(),
      durationMs,
      end: compactDiagnostics(end),
      environment: {
        crossOriginIsolated: globalThis.crossOriginIsolated,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        userAgent: navigator.userAgent,
      },
      output: getOutputRouting().getSnapshot(),
      playbackUnderrunEventsDelta:
        startUnderruns === undefined || endUnderruns === undefined
          ? null
          : endUnderruns - startUnderruns,
      start: compactDiagnostics(start),
    };
  } finally {
    manager.setPerformanceMeasurementEnabled(false);
  }
}
