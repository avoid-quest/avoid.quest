import type { EffectConfig } from "../dsp/effects/types.js";

export type EffectsPerformanceSnapshot = {
  backend: "official";
  monitoringChannelCount: number;
  soundCount: number;
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
  setTempo: (bpm: number) => void;
  syncEffects: (soundId: string, effects: readonly EffectConfig[]) => void;
};
