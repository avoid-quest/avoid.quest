import type { EffectConfig } from "../dsp/effects/types.js";

export type EffectWriteResult = "applied" | "structural" | "unavailable";

export type EffectsPerformanceSnapshot = {
  backend: "official";
  monitoringChannelCount: number;
  soundCount: number;
  workletCount: 1;
};

export type OfficialSoundSettings = {
  dryWet: number;
  /**
   * Its effects; a keyed one names, in `sidechain.channelId`, the sound or
   * key it keys from, registered on its own (`connectSidechainSource`).
   */
  effects: readonly EffectConfig[];
  tempo: number;
};

/** EffectsController seam implemented by the openDAW and test adapters. */
export type EffectsGraphRuntime = {
  writeEffect: (
    soundId: string,
    effectId: string,
    config: EffectConfig,
    transient?: boolean
  ) => EffectWriteResult;
  syncEffects: (soundId: string, effects: readonly EffectConfig[]) => void;
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
    inputChannels?: 1 | 2,
    settings?: OfficialSoundSettings
  ) => Promise<boolean>;
  deleteSound: (soundId: string, generation?: number) => void;
  disconnectSound: (soundId: string, generation?: number) => void;
  getPerformanceSnapshot?: () => EffectsPerformanceSnapshot | null;
};
