import type { EffectConfig, EffectType } from "./types";

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
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      frequency: { min: 20, max: 20_000, step: 1 },
      Q: { min: 0.1, max: 30, step: 0.1 },
      gain: { min: -40, max: 40, step: 0.1 },
    },
  },
  {
    type: "reverb",
    name: "Reverb",
    description: "Convolution reverb with room size and decay control",
    defaultConfig: {
      type: "reverb",
      enabled: false,
      roomSize: 0.05,
      wet: 0.3,
      dry: 0.7,
      decayTime: 2.0,
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      roomSize: { min: 0.01, max: 0.1, step: 0.001 },
      wet: { min: 0, max: 1, step: 0.01 },
      dry: { min: 0, max: 1, step: 0.01 },
      decayTime: { min: 0.1, max: 5, step: 0.1 },
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
      wet: 0.3,
      dry: 0.7,
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      delayTime: { min: 0, max: 1, step: 0.01 },
      feedback: { min: 0, max: 0.95, step: 0.01 },
      wet: { min: 0, max: 1, step: 0.01 },
      dry: { min: 0, max: 1, step: 0.01 },
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
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      amount: { min: 0, max: 100, step: 1 },
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
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      threshold: { min: -100, max: 0, step: 1 },
      ratio: { min: 1, max: 20, step: 0.1 },
      attack: { min: 0, max: 1, step: 0.001 },
      release: { min: 0, max: 1, step: 0.001 },
      knee: { min: 0, max: 40, step: 1 },
    },
  },
  {
    type: "panner",
    name: "Stereo Panner",
    description: "Stereo panning control",
    defaultConfig: {
      type: "panner",
      enabled: false,
      pan: 0,
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      pan: { min: -1, max: 1, step: 0.01 },
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
