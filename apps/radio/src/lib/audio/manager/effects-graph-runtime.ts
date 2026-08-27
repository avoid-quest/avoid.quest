import type { EffectConfig } from "../dsp/effects/types.js";

export type QuantumPerformanceSummary = {
  deadlineMisses: number;
  maxMs: number;
  observedSampleCount: number;
  p95Ms: number;
  p99LoadPercent: number;
  p99Ms: number;
  sampleCount: number;
  status: "clock-unavailable" | "measured" | "no-samples";
  zeroSampleCount: number;
};

export type EffectsPerformanceSnapshot = {
  backend: "official";
  cpuLoadPercent: number;
  monitoringChannelCount: number;
  perfBufferMs: Float32Array;
  perfIndex: number;
  quantumBudgetMs: number;
  soundCount: number;
  timing: QuantumPerformanceSummary;
  workletCount: 1;
};

/** EffectsController seam implemented by the openDAW and test adapters. */
export type EffectsGraphRuntime = {
  cleanup: () => void;
  connectSidechainSource: (
    soundId: string,
    source: AudioNode,
    generation?: number,
    inputChannels?: 1 | 2
  ) => Promise<boolean>;
  connectSound: (
    soundId: string,
    source: AudioNode,
    destination: AudioNode,
    generation?: number,
    inputChannels?: 1 | 2
  ) => Promise<boolean>;
  deleteSound: (soundId: string, generation?: number) => void;
  disconnectSound: (soundId: string, generation?: number) => void;
  getPerformanceSnapshot?: () => EffectsPerformanceSnapshot | null;
  setDryWet: (soundId: string, value: number) => void;
  setSidechainTarget: (soundId: string, targetSoundId: string | null) => void;
  setPerformanceMeasurementEnabled?: (enabled: boolean) => void;
  setTempo: (bpm: number) => void;
  syncEffects: (soundId: string, effects: readonly EffectConfig[]) => void;
};
