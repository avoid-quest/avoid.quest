/**
 * Effect Registry
 *
 * Metadata and factory functions for available effects.
 */

import type { EffectConfig, EffectType } from "./types.js";

export type EffectMetadata = {
  readonly type: EffectType;
  readonly name: string;
  readonly description: string;
  readonly icon?: string;
  readonly defaultConfig: Omit<EffectConfig, "id" | "order">;
};

/**
 * Available effects with their default configurations.
 * Immutable array - use as const satisfies for type safety.
 */
export const AVAILABLE_EFFECTS = [
  {
    type: "plateReverb",
    name: "Plate Reverb",
    description: "Advanced plate reverb with extensive controls",
    defaultConfig: {
      type: "plateReverb",
      enabled: false,
      preDelay: 0,
      bandwidth: 0.9999,
      inputDiffusion1: 0.75,
      inputDiffusion2: 0.625,
      decay: 0.5,
      decayDiffusion1: 0.7,
      decayDiffusion2: 0.5,
      damping: 0.005,
      excursionRate: 0.5,
      excursionDepth: 0.7,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
  },
  {
    type: "pitchShifter",
    name: "Pitch/Speed",
    description:
      "Speed-based pitch change (varispeed). Changes tempo proportionally with pitch.",
    defaultConfig: {
      type: "pitchShifter",
      enabled: false,
      pitchFactor: 1.0,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
  },
  {
    type: "delay",
    name: "Delay",
    description: "Echo/delay effect with feedback control",
    defaultConfig: {
      type: "delay",
      enabled: false,
      delayTime: 0.3,
      feedback: 0.3,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
  },
  {
    type: "distortion",
    name: "Distortion",
    description: "Wave shaper distortion effect",
    defaultConfig: {
      type: "distortion",
      enabled: false,
      amount: 50,
      oversample: "2x",
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
  },
  {
    type: "compressor",
    name: "Compressor",
    description:
      "Professional dynamics compressor with lookahead and auto attack/release",
    defaultConfig: {
      type: "compressor",
      enabled: false,
      threshold: -10,
      ratio: 4,
      attack: 2,
      release: 140,
      knee: 6,
      makeup: 0,
      mix: 1,
      lookahead: true,
      autoAttack: false,
      autoRelease: false,
      autoMakeup: false,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
  },
  {
    type: "crusher",
    name: "Crusher",
    description: "Bit crusher effect with crush rate, bit depth, and boost",
    defaultConfig: {
      type: "crusher",
      enabled: false,
      crush: 0.5,
      bitDepth: 8,
      boost: 0,
      autoGain: true,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
  },
  {
    type: "fold",
    name: "Fold",
    description: "Wave folding effect with amount, volume, and oversampling",
    defaultConfig: {
      type: "fold",
      enabled: false,
      amount: 0,
      volume: 0,
      oversample: 2,
      autoGain: true,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
  },
  {
    type: "stereoTool",
    name: "Stereo Tool",
    description: "Stereo manipulation with volume, width, and channel controls",
    defaultConfig: {
      type: "stereoTool",
      enabled: false,
      volume: 0,
      stereo: 0,
      invertL: false,
      invertR: false,
      swap: false,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
  },
  {
    type: "revamp",
    name: "7-Band EQ",
    description: "Parametric equalizer with 7 bands",
    defaultConfig: {
      type: "revamp",
      enabled: false,
      highPassEnabled: true,
      highPassFrequency: 20,
      highPassQ: Math.SQRT1_2,
      highPassOrder: 1,
      lowShelfEnabled: true,
      lowShelfFrequency: 80,
      lowShelfGain: 0,
      lowBellEnabled: true,
      lowBellFrequency: 200,
      lowBellGain: 0,
      lowBellQ: Math.SQRT1_2,
      midBellEnabled: true,
      midBellFrequency: 1000,
      midBellGain: 0,
      midBellQ: Math.SQRT1_2,
      highBellEnabled: true,
      highBellFrequency: 5000,
      highBellGain: 0,
      highBellQ: Math.SQRT1_2,
      highShelfEnabled: true,
      highShelfFrequency: 10_000,
      highShelfGain: 0,
      lowPassEnabled: true,
      lowPassFrequency: 20_000,
      lowPassQ: Math.SQRT1_2,
      lowPassOrder: 1,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
  },
  {
    type: "tidal",
    name: "Tidal",
    description:
      "Rhythm shaping effect with rate, depth, slope, symmetry, and phase controls",
    defaultConfig: {
      type: "tidal",
      enabled: false,
      rate: 1.0,
      depth: 0.0,
      slope: 0.0,
      symmetry: 0.0,
      offset: 0,
      channelOffset: 0,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
  },
  {
    type: "limiter",
    name: "Limiter",
    description: "Transparent brick-wall limiter for output protection",
    defaultConfig: {
      type: "limiter",
      enabled: false,
      threshold: 0,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
  },
] as const;

export function getEffectMetadata(
  type: EffectType
): EffectMetadata | undefined {
  return AVAILABLE_EFFECTS.find((effect) => effect.type === type);
}

export function createDefaultEffectConfig(
  type: EffectType,
  id: string,
  order: number
): EffectConfig {
  const metadata = getEffectMetadata(type);
  if (!metadata) {
    throw new Error(`Unknown effect type: ${type}`);
  }

  return {
    ...metadata.defaultConfig,
    id,
    order,
  } as EffectConfig;
}
