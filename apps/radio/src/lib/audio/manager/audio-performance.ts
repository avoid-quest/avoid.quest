import type {
  AudioContextPerformanceSnapshot,
  DeviceSource,
} from "../playback/index.js";
import type {
  EffectsPerformanceSnapshot,
  QuantumPerformanceSummary,
} from "./effects-graph-runtime.js";

export type AudioPerformanceDiagnostics = {
  context: AudioContextPerformanceSnapshot | null;
  effects: EffectsPerformanceSnapshot | null;
  inputs: Array<{
    diagnostics: NonNullable<ReturnType<DeviceSource["getDiagnostics"]>>;
    soundId: string;
  }>;
  topology: {
    bypassSounds: number;
    compatibilityWorklets: number;
    meterFallbacks: number;
    meterListeners: number;
    meterWorklets: number;
    officialSounds: number;
    soundCount: number;
  };
};

type AudioPerformanceInputs = Pick<
  AudioPerformanceDiagnostics,
  "context" | "effects" | "inputs"
> & {
  backends: ReadonlyArray<"bypass" | "compatibility" | "official" | null>;
  meter: {
    activeFallbackMeters: number;
    activeOpenDawMeters: number;
    listenerCount: number;
  };
  soundCount: number;
};

export function summarizeQuantumPerformance(
  perfBufferMs: Float32Array,
  quantumBudgetMs: number
): QuantumPerformanceSummary {
  const samples = [...perfBufferMs]
    .filter((sample) => Number.isFinite(sample) && sample > 0)
    .sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    samples[
      Math.min(samples.length - 1, Math.floor(samples.length * fraction))
    ] ?? 0;
  const p99Ms = percentile(0.99);
  return {
    deadlineMisses: samples.filter((sample) => sample >= quantumBudgetMs)
      .length,
    maxMs: samples.at(-1) ?? 0,
    p95Ms: percentile(0.95),
    p99LoadPercent: quantumBudgetMs > 0 ? (p99Ms / quantumBudgetMs) * 100 : 0,
    p99Ms,
    sampleCount: samples.length,
  };
}

export function createAudioPerformanceDiagnostics({
  backends,
  context,
  effects,
  inputs,
  meter,
  soundCount,
}: AudioPerformanceInputs): AudioPerformanceDiagnostics {
  return {
    context,
    effects,
    inputs,
    topology: {
      bypassSounds: backends.filter((backend) => backend === "bypass").length,
      compatibilityWorklets: backends.filter(
        (backend) => backend === "compatibility"
      ).length,
      meterFallbacks: meter.activeFallbackMeters,
      meterListeners: meter.listenerCount,
      meterWorklets: meter.activeOpenDawMeters,
      officialSounds: backends.filter((backend) => backend === "official")
        .length,
      soundCount,
    },
  };
}
