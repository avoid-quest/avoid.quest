import type {
  AudioContext,
  BiquadFilterNode,
  ConvolverNode,
  GainNode,
  StereoPannerNode,
} from "@avoid.quest/cacophony";

// These types are not exported by cacophony, so we'll use the AudioContext types directly
export type DelayNode = ReturnType<AudioContext["createDelay"]>;
export type WaveShaperNode = ReturnType<AudioContext["createWaveShaper"]>;
export type DynamicsCompressorNode = ReturnType<
  AudioContext["createDynamicsCompressor"]
>;

export type FilterType =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "lowshelf"
  | "highshelf"
  | "peaking"
  | "notch"
  | "allpass";

export type EffectType =
  | "biquadFilter"
  | "reverb"
  | "delay"
  | "distortion"
  | "compressor"
  | "panner";

export type EffectNode =
  | BiquadFilterNode
  | ConvolverNode
  | DelayNode
  | WaveShaperNode
  | DynamicsCompressorNode
  | StereoPannerNode;

export type BaseEffectConfig = {
  id: string;
  type: EffectType;
  enabled: boolean;
  order: number;
};

export interface BiquadFilterConfig extends BaseEffectConfig {
  type: "biquadFilter";
  filterType: FilterType;
  frequency: number;
  Q: number;
  gain: number;
}

export interface ReverbConfig extends BaseEffectConfig {
  type: "reverb";
  roomSize: number;
  wet: number;
  dry: number;
  decayTime: number;
}

export interface DelayConfig extends BaseEffectConfig {
  type: "delay";
  delayTime: number;
  feedback: number;
  wet: number;
  dry: number;
}

export interface DistortionConfig extends BaseEffectConfig {
  type: "distortion";
  amount: number;
  oversample: "none" | "2x" | "4x";
}

export interface CompressorConfig extends BaseEffectConfig {
  type: "compressor";
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
}

export interface PannerConfig extends BaseEffectConfig {
  type: "panner";
  pan: number;
}

export type EffectConfig =
  | BiquadFilterConfig
  | ReverbConfig
  | DelayConfig
  | DistortionConfig
  | CompressorConfig
  | PannerConfig;

export type EffectInstance = {
  config: EffectConfig;
  node: EffectNode | null;
  wetGain?: GainNode;
  dryGain?: GainNode;
  feedbackGain?: GainNode; // For delay feedback loop
};
