/**
 * Effect Registry
 *
 * Metadata and factory functions for available effects.
 */

import type { EffectConfig, EffectType } from "./types.js";

export type EffectMetadata = {
  type: EffectType;
  name: string;
  description: string;
  icon?: string;
  defaultConfig: Omit<EffectConfig, "id" | "order">;
  parameterRanges?: Record<string, { min: number; max: number; step?: number }>;
};

export const AVAILABLE_EFFECTS: EffectMetadata[] = [
  {
    type: "biquadFilter",
    name: "Filter",
    description:
      "Biquad filter with 8 types (lowpass, highpass, bandpass, etc.)",
    defaultConfig: {
      type: "biquadFilter",
      filterType: "lowpass",
      frequency: 1000,
      Q: 1,
      gain: 0,
      enabled: false,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      frequency: { min: 20, max: 20_000, step: 1 },
      Q: { min: 0.1, max: 30, step: 0.1 },
      gain: { min: -40, max: 40, step: 0.1 },
      dryWet: { min: 0, max: 1, step: 0.01 },
      inputGain: { min: 0, max: 4.0, step: 0.01 },
      outputGain: { min: 0, max: 4.0, step: 0.01 },
    },
  },
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
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      preDelay: { min: 0, max: 47_999, step: 1 },
      bandwidth: { min: 0, max: 1, step: 0.0001 },
      inputDiffusion1: { min: 0, max: 1, step: 0.01 },
      inputDiffusion2: { min: 0, max: 1, step: 0.01 },
      decay: { min: 0, max: 1, step: 0.01 },
      decayDiffusion1: { min: 0, max: 0.999_999, step: 0.001 },
      decayDiffusion2: { min: 0, max: 0.999_999, step: 0.001 },
      damping: { min: 0, max: 1, step: 0.001 },
      excursionRate: { min: 0, max: 2, step: 0.01 },
      excursionDepth: { min: 0, max: 2, step: 0.01 },
      dryWet: { min: 0, max: 1, step: 0.01 },
      inputGain: { min: 0, max: 4.0, step: 0.01 },
      outputGain: { min: 0, max: 4.0, step: 0.01 },
    },
  },
  {
    type: "standardReverb",
    name: "Standard Reverb",
    description: "Simple convolution-based reverb with room size and decay",
    defaultConfig: {
      type: "standardReverb",
      enabled: false,
      roomSize: 0.05,
      decayTime: 2.0,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      roomSize: { min: 0.01, max: 0.1, step: 0.001 },
      decayTime: { min: 0.1, max: 5.0, step: 0.1 },
      dryWet: { min: 0, max: 1, step: 0.01 },
      inputGain: { min: 0, max: 4.0, step: 0.01 },
      outputGain: { min: 0, max: 4.0, step: 0.01 },
    },
  },
  {
    type: "phaseVocoder",
    name: "Phase Vocoder",
    description: "Pitch shifting effect using phase vocoder algorithm",
    defaultConfig: {
      type: "phaseVocoder",
      enabled: false,
      pitchFactor: 1.0,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      pitchFactor: { min: 0.25, max: 4.0, step: 0.01 },
      dryWet: { min: 0, max: 1, step: 0.01 },
      inputGain: { min: 0, max: 4.0, step: 0.01 },
      outputGain: { min: 0, max: 4.0, step: 0.01 },
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
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      delayTime: { min: 0, max: 1, step: 0.01 },
      feedback: { min: 0, max: 0.95, step: 0.01 },
      dryWet: { min: 0, max: 1, step: 0.01 },
      inputGain: { min: 0, max: 4.0, step: 0.01 },
      outputGain: { min: 0, max: 4.0, step: 0.01 },
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
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      amount: { min: 0, max: 100, step: 1 },
      dryWet: { min: 0, max: 1, step: 0.01 },
      inputGain: { min: 0, max: 4.0, step: 0.01 },
      outputGain: { min: 0, max: 4.0, step: 0.01 },
    },
  },
  {
    type: "compressor",
    name: "Compressor",
    description: "Dynamic range compressor",
    defaultConfig: {
      type: "compressor",
      enabled: false,
      threshold: -24,
      ratio: 12,
      attack: 0.003,
      release: 0.25,
      knee: 30,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      threshold: { min: -100, max: 0, step: 1 },
      ratio: { min: 1, max: 20, step: 0.1 },
      attack: { min: 0, max: 1, step: 0.001 },
      release: { min: 0, max: 1, step: 0.001 },
      knee: { min: 0, max: 40, step: 1 },
      dryWet: { min: 0, max: 1, step: 0.01 },
      inputGain: { min: 0, max: 4.0, step: 0.01 },
      outputGain: { min: 0, max: 4.0, step: 0.01 },
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
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      crush: { min: 0, max: 1, step: 0.01 },
      bitDepth: { min: 1, max: 16, step: 1 },
      boost: { min: -40, max: 40, step: 0.1 },
      dryWet: { min: 0, max: 1, step: 0.01 },
      inputGain: { min: 0, max: 4.0, step: 0.01 },
      outputGain: { min: 0, max: 4.0, step: 0.01 },
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
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      amount: { min: -40, max: 40, step: 0.1 },
      volume: { min: -40, max: 40, step: 0.1 },
      oversample: { min: 2, max: 8, step: 2 },
      dryWet: { min: 0, max: 1, step: 0.01 },
      inputGain: { min: 0, max: 4.0, step: 0.01 },
      outputGain: { min: 0, max: 4.0, step: 0.01 },
    },
  },
  {
    type: "stereoTool",
    name: "Stereo Tool",
    description:
      "Stereo manipulation with volume, panning, width, and channel controls",
    defaultConfig: {
      type: "stereoTool",
      enabled: false,
      volume: 0,
      panning: 0,
      stereo: 0,
      invertL: false,
      invertR: false,
      swap: false,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      volume: { min: -40, max: 40, step: 0.1 },
      panning: { min: -1, max: 1, step: 0.01 },
      stereo: { min: -1, max: 1, step: 0.01 },
      dryWet: { min: 0, max: 1, step: 0.01 },
      inputGain: { min: 0, max: 4.0, step: 0.01 },
      outputGain: { min: 0, max: 4.0, step: 0.01 },
    },
  },
  {
    type: "revamp",
    name: "Revamp",
    description:
      "Multi-band EQ with 7 bands (highpass, low shelf, low bell, mid bell, high bell, high shelf, lowpass)",
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
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      highPassFrequency: { min: 20, max: 20_000, step: 1 },
      highPassQ: { min: 0.1, max: 30, step: 0.1 },
      highPassOrder: { min: 1, max: 4, step: 1 },
      lowShelfFrequency: { min: 20, max: 20_000, step: 1 },
      lowShelfGain: { min: -40, max: 40, step: 0.1 },
      lowBellFrequency: { min: 20, max: 20_000, step: 1 },
      lowBellGain: { min: -40, max: 40, step: 0.1 },
      lowBellQ: { min: 0.1, max: 30, step: 0.1 },
      midBellFrequency: { min: 20, max: 20_000, step: 1 },
      midBellGain: { min: -40, max: 40, step: 0.1 },
      midBellQ: { min: 0.1, max: 30, step: 0.1 },
      highBellFrequency: { min: 20, max: 20_000, step: 1 },
      highBellGain: { min: -40, max: 40, step: 0.1 },
      highBellQ: { min: 0.1, max: 30, step: 0.1 },
      highShelfFrequency: { min: 20, max: 20_000, step: 1 },
      highShelfGain: { min: -40, max: 40, step: 0.1 },
      lowPassFrequency: { min: 20, max: 20_000, step: 1 },
      lowPassQ: { min: 0.1, max: 30, step: 0.1 },
      lowPassOrder: { min: 1, max: 4, step: 1 },
      dryWet: { min: 0, max: 1, step: 0.01 },
      inputGain: { min: 0, max: 4.0, step: 0.01 },
      outputGain: { min: 0, max: 4.0, step: 0.01 },
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
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      rate: { min: 0.1, max: 10.0, step: 0.01 },
      depth: { min: 0, max: 1, step: 0.01 },
      slope: { min: 0, max: 1, step: 0.01 },
      symmetry: { min: 0, max: 1, step: 0.01 },
      offset: { min: 0, max: 360, step: 1 },
      channelOffset: { min: 0, max: 360, step: 1 },
      dryWet: { min: 0, max: 1, step: 0.01 },
      inputGain: { min: 0, max: 4.0, step: 0.01 },
      outputGain: { min: 0, max: 4.0, step: 0.01 },
    },
  },
];

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
