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
    description: "Dattorro plate reverb with advanced controls",
    defaultConfig: {
      type: "reverb",
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
      wet: 0.3,
      dry: 0.6,
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      preDelay: { min: 0, max: 48_000, step: 1 },
      bandwidth: { min: 0, max: 1, step: 0.0001 },
      inputDiffusion1: { min: 0, max: 1, step: 0.01 },
      inputDiffusion2: { min: 0, max: 1, step: 0.01 },
      decay: { min: 0, max: 1, step: 0.01 },
      decayDiffusion1: { min: 0, max: 0.999_999, step: 0.001 },
      decayDiffusion2: { min: 0, max: 0.999_999, step: 0.001 },
      damping: { min: 0, max: 1, step: 0.001 },
      excursionRate: { min: 0, max: 2, step: 0.01 },
      excursionDepth: { min: 0, max: 2, step: 0.01 },
      wet: { min: 0, max: 1, step: 0.01 },
      dry: { min: 0, max: 1, step: 0.01 },
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
    name: "Panner",
    description: "3D spatial audio positioning and panning",
    defaultConfig: {
      type: "panner",
      enabled: false,
      coneInnerAngle: 360,
      coneOuterAngle: 360,
      coneOuterGain: 0,
      distanceModel: "inverse",
      maxDistance: 10_000,
      refDistance: 1,
      rolloffFactor: 1,
      panningModel: "HRTF",
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      orientationX: 0,
      orientationY: 0,
      orientationZ: 0,
    } as Omit<EffectConfig, "id" | "order">,
    parameterRanges: {
      coneInnerAngle: { min: 0, max: 360, step: 1 },
      coneOuterAngle: { min: 0, max: 360, step: 1 },
      coneOuterGain: { min: 0, max: 1, step: 0.01 },
      maxDistance: { min: 0, max: 100_000, step: 1 },
      refDistance: { min: 0, max: 1000, step: 0.1 },
      rolloffFactor: { min: 0, max: 10, step: 0.1 },
      positionX: { min: -1000, max: 1000, step: 0.1 },
      positionY: { min: -1000, max: 1000, step: 0.1 },
      positionZ: { min: -1000, max: 1000, step: 0.1 },
      orientationX: { min: -1, max: 1, step: 0.01 },
      orientationY: { min: -1, max: 1, step: 0.01 },
      orientationZ: { min: -1, max: 1, step: 0.01 },
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
