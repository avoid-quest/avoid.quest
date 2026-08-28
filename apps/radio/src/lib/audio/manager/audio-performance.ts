import type {
  AudioContextPerformanceSnapshot,
  DeviceSource,
} from "../playback/index.js";
import type { EffectsPerformanceSnapshot } from "./effects-graph-runtime.js";

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
