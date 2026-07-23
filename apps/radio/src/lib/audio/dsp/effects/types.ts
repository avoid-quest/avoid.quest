/**
 * DSP Effect Types
 *
 * Type definitions for audio effects processing.
 */

export type FilterType =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "lowshelf"
  | "highshelf"
  | "peaking"
  | "notch"
  | "allpass";

/**
 * All valid effect type identifiers as a const array.
 * Used for runtime validation at store boundaries.
 */
export const OPENDAW_EFFECT_TYPES = [
  "plateReverb",
  "crusher",
  "fold",
  "revamp",
  "delay",
  "compressor",
  "stereoTool",
  "tidal",
  "cheapReverb",
  "gate",
  "waveshaper",
  "maximizer",
  "vocoder",
  "neuralAmp",
  "werkstatt",
  "autotune",
  "fxComposite",
  "stereoSplit",
  "frequencySplit",
] as const;

export const RADIO_EFFECT_TYPES = [
  "pitchShifter",
  "distortion",
  "limiter",
] as const;

export const EFFECT_TYPES = [
  ...OPENDAW_EFFECT_TYPES,
  ...RADIO_EFFECT_TYPES,
] as const;

export type EffectType = (typeof EFFECT_TYPES)[number];
export type OpenDawEffectType = (typeof OPENDAW_EFFECT_TYPES)[number];
export type RadioEffectType = (typeof RADIO_EFFECT_TYPES)[number];

/**
 * Runtime type guard for EffectType.
 * Use at store boundaries to validate user input.
 */
export function isEffectType(value: unknown): value is EffectType {
  return (
    typeof value === "string" &&
    (EFFECT_TYPES as readonly string[]).includes(value)
  );
}

export type BaseEffectConfig = {
  id: string;
  type: EffectType;
  enabled: boolean;
  order: number;
  dryWet: number; // 0.0 = fully dry, 1.0 = fully wet
  inputGain: number; // Linear gain: 0.0 = -∞dB, 1.0 = 0dB, ~4.0 = +12dB
  outputGain: number; // Linear gain: 0.0 = -∞dB, 1.0 = 0dB, ~4.0 = +12dB
  sidechain?: EffectSidechainConfig;
};

export type EffectSidechainConfig = {
  channelId: string;
};

export const TEMPO_DIVISIONS = [
  "1/32",
  "1/16",
  "1/8",
  "1/4",
  "1/2",
  "1/1",
] as const;

export type TempoDivision = (typeof TEMPO_DIVISIONS)[number];

export const OPENDAW_DELAY_FRACTIONS = [
  "Off",
  "1/128",
  "1/96",
  "1/64",
  "1/48",
  "1/32",
  "1/24",
  "3/64",
  "1/16",
  "1/12",
  "3/32",
  "1/8",
  "1/6",
  "3/16",
  "1/4",
  "5/16",
  "1/3",
  "3/8",
  "7/16",
  "1/2",
  "1/1",
] as const;

export type OpenDawDelayFraction = (typeof OPENDAW_DELAY_FRACTIONS)[number];

export const OPENDAW_TIDAL_FRACTIONS = [
  "1/1",
  "1/2",
  "1/3",
  "1/4",
  "3/16",
  "1/6",
  "1/8",
  "3/32",
  "1/12",
  "1/16",
  "3/64",
  "1/24",
  "1/32",
  "1/48",
  "1/64",
  "1/96",
  "1/128",
] as const;

export type OpenDawTidalFraction = (typeof OPENDAW_TIDAL_FRACTIONS)[number];

export type PlateReverbConfig = BaseEffectConfig & {
  type: "plateReverb";
  preDelay: number;
  bandwidth: number;
  inputDiffusion1: number;
  inputDiffusion2: number;
  decay: number;
  decayDiffusion1: number;
  decayDiffusion2: number;
  damping: number;
  excursionRate: number;
  excursionDepth: number;
  wet?: number;
  dry?: number;
};

export type PitchShifterConfig = BaseEffectConfig & {
  type: "pitchShifter";
  pitchFactor: number;
};

export type DelayConfig = BaseEffectConfig & {
  type: "delay";
  /** Legacy compatibility delay in seconds. */
  delayTime: number;
  feedback: number;
  /** Official openDAW musical and millisecond timing fields. */
  delayMusical?: OpenDawDelayFraction;
  delayMillis?: number;
  preSyncTimeLeft?: OpenDawDelayFraction;
  preMillisTimeLeft?: number;
  preSyncTimeRight?: OpenDawDelayFraction;
  preMillisTimeRight?: number;
  cross?: number;
  filter?: number;
  wet?: number;
  dry?: number;
  lfoSpeed?: number;
  /** Legacy compatibility fields retained for saved sessions. */
  tempoSync?: boolean;
  tempoDivision?: TempoDivision;
  preDelay?: number;
  crossFeedback?: number;
  filterFrequency?: number;
  lfoRate?: number;
  lfoDepth?: number;
};

export type DistortionConfig = BaseEffectConfig & {
  type: "distortion";
  amount: number;
  oversample: "none" | "2x" | "4x";
};

export type CompressorConfig = BaseEffectConfig & {
  type: "compressor";
  /** Threshold in dB (-60 to 0) */
  threshold: number;
  /** Ratio (1:1 to inf:1, values > 24 become limiter) */
  ratio: number;
  /** Attack time in ms (0.1 to 100) */
  attack: number;
  /** Release time in ms (10 to 2000) */
  release: number;
  /** Knee width in dB (0 to 24) */
  knee: number;
  /** Makeup gain in dB (-12 to 24) */
  makeup: number;
  /** Mix (0 to 1) for parallel compression */
  mix: number;
  /** Enable lookahead (5ms delay) */
  lookahead: boolean;
  /** Auto attack based on crest factor */
  autoAttack: boolean;
  /** Auto release based on crest factor */
  autoRelease: boolean;
  /** Auto makeup gain */
  autoMakeup: boolean;
  /** Official openDAW field names retained alongside legacy camel-case keys. */
  inputgain?: number;
  automakeup?: boolean;
  autoattack?: boolean;
  autorelease?: boolean;
};

export type CrusherConfig = BaseEffectConfig & {
  type: "crusher";
  crush: number; // 0-1 (inverted in processor: setCrush(1.0 - value))
  bitDepth: number; // 1-16
  boost: number; // dB
  autoGain: boolean; // Auto gain compensation for boost
};

export type FoldConfig = BaseEffectConfig & {
  type: "fold";
  amount: number; // dB (converted to linear gain)
  volume: number; // dB (converted to linear gain)
  oversample: 2 | 4 | 8;
  autoGain: boolean; // Auto gain compensation for amount
};

export type StereoToolConfig = BaseEffectConfig & {
  type: "stereoTool";
  volume: number; // dB (converted to linear gain)
  stereo: number; // -1 to 1 (stereo width)
  panning?: number;
  panLaw?: "linear" | "equalPower";
  invertL: boolean;
  invertR: boolean;
  swap: boolean;
};

export type RevampConfig = BaseEffectConfig & {
  type: "revamp";
  // Highpass
  highPassEnabled: boolean;
  highPassFrequency: number;
  highPassQ: number;
  highPassOrder: number;
  // Low shelf
  lowShelfEnabled: boolean;
  lowShelfFrequency: number;
  lowShelfGain: number;
  // Low bell
  lowBellEnabled: boolean;
  lowBellFrequency: number;
  lowBellGain: number;
  lowBellQ: number;
  // Mid bell
  midBellEnabled: boolean;
  midBellFrequency: number;
  midBellGain: number;
  midBellQ: number;
  // High bell
  highBellEnabled: boolean;
  highBellFrequency: number;
  highBellGain: number;
  highBellQ: number;
  // High shelf
  highShelfEnabled: boolean;
  highShelfFrequency: number;
  highShelfGain: number;
  // Lowpass
  lowPassEnabled: boolean;
  lowPassFrequency: number;
  lowPassQ: number;
  lowPassOrder: number;
};

export type TidalConfig = BaseEffectConfig & {
  type: "tidal";
  /** Legacy free-running rate in Hz. */
  rate: number;
  /** Official openDAW synchronized rate. */
  rateDivision?: OpenDawTidalFraction;
  tempoSync?: boolean;
  tempoDivision?: TempoDivision;
  depth: number; // 0-1
  slope: number; // 0-1
  symmetry: number; // 0-1
  offset: number; // degrees 0-360
  channelOffset: number; // degrees 0-360
};

export type LimiterConfig = BaseEffectConfig & {
  type: "limiter";
  threshold: number; // dB (-60 to 0)
};

export type CheapReverbConfig = BaseEffectConfig & {
  type: "cheapReverb";
  /** Legacy compatibility controls. */
  roomSize: number;
  damping: number;
  width: number;
  /** Official Free Reverb fields. */
  decay?: number;
  preDelay?: number;
  damp?: number;
  filter?: number;
  wet?: number;
  dry?: number;
};

export type GateConfig = BaseEffectConfig & {
  type: "gate";
  threshold: number;
  return?: number;
  attack: number;
  hold: number;
  release: number;
  floor: number;
  inverse: boolean;
};

export const WAVESHAPER_CURVES = [
  "hardClip",
  "cubicSoft",
  "tanh",
  "sigmoid",
  "arctan",
  "asymmetric",
] as const;

export type WaveshaperCurve = (typeof WAVESHAPER_CURVES)[number];

export const OPENDAW_WAVESHAPER_EQUATIONS = [
  "hardclip",
  "cubicSoft",
  "tanh",
  "sigmoid",
  "arctan",
  "asymmetric",
] as const;

export type OpenDawWaveshaperEquation =
  (typeof OPENDAW_WAVESHAPER_EQUATIONS)[number];

export type WaveshaperConfig = BaseEffectConfig & {
  type: "waveshaper";
  /** Legacy compatibility controls. */
  curve: WaveshaperCurve;
  drive: number;
  output: number;
  /** Official device controls; suffixed gains avoid BaseEffectConfig units. */
  equation?: OpenDawWaveshaperEquation;
  deviceInputGain?: number;
  deviceOutputGain?: number;
  mix?: number;
};

export type MaximizerConfig = BaseEffectConfig & {
  type: "maximizer";
  threshold: number;
  /** Legacy compatibility controls. */
  ceiling: number;
  release: number;
  lookahead: number;
  /** Official Maximizer lookahead switch. */
  lookaheadEnabled?: boolean;
};

export type VocoderModulatorSource =
  | "noise-white"
  | "noise-pink"
  | "noise-brown"
  | "self"
  | "external";

export type VocoderConfig = BaseEffectConfig & {
  type: "vocoder";
  /** Legacy compatibility controls. */
  bands: 8 | 12 | 16;
  modulator: "noise" | "self" | "external";
  carrierGain: number;
  modulatorGain: number;
  noise: number;
  /** Official Vocoder fields. */
  carrierMinFreq?: number;
  carrierMaxFreq?: number;
  modulatorMinFreq?: number;
  modulatorMaxFreq?: number;
  qStart?: number;
  qEnd?: number;
  envAttack?: number;
  envRelease?: number;
  gain?: number;
  mix?: number;
  bandCount?: 8 | 12 | 16;
  modulatorSource?: VocoderModulatorSource;
};

export type NeuralAmpConfig = BaseEffectConfig & {
  type: "neuralAmp";
  modelId: string | null;
  modelUrl: string | null;
  modelName?: string | null;
  modelData?: string | null;
  input: number;
  output: number;
  cabinetEnabled: boolean;
  mono?: boolean;
  mix?: number;
};

export type WerkstattConfig = BaseEffectConfig & {
  type: "werkstatt";
  /** Legacy expression-only processor source. */
  source: string;
  /** Official Werkstatt source and dynamic graph declarations. */
  code?: string;
  parameters: Record<string, number>;
  samples?: Record<string, string>;
};

export const AUTOTUNE_KEYS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export const AUTOTUNE_SCALES = [
  "chromatic",
  "major",
  "minor",
  "majorPentatonic",
  "minorPentatonic",
  "blues",
  "dorian",
  "mixolydian",
] as const;

export type AutotuneScale = (typeof AUTOTUNE_SCALES)[number];

export type AutotuneConfig = BaseEffectConfig & {
  type: "autotune";
  key: string;
  scale: AutotuneScale | "pentatonicMajor" | "pentatonicMinor";
  amount: number;
  /** Legacy compatibility retune time in milliseconds. */
  retune: number;
  shift: number;
  smoothing: number;
  /** Official normalized retune and smooth controls. */
  retuneAmount?: number;
  smooth?: number;
};

export type EffectChainConfig = {
  id: string;
  name: string;
  order: number;
  gain: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  effects: EffectConfig[];
};

export type FxCompositeConfig = BaseEffectConfig & {
  type: "fxComposite";
  chains: EffectChainConfig[];
};

export type StereoSplitConfig = BaseEffectConfig & {
  type: "stereoSplit";
  chains: EffectChainConfig[];
};

export type FrequencySplitConfig = BaseEffectConfig & {
  type: "frequencySplit";
  frequencyBandCount?: 2 | 3 | 4;
  chains: EffectChainConfig[];
  crossoverFrequencies: number[];
};

export type EffectConfig =
  | PlateReverbConfig
  | PitchShifterConfig
  | DelayConfig
  | DistortionConfig
  | CompressorConfig
  | CrusherConfig
  | FoldConfig
  | StereoToolConfig
  | RevampConfig
  | TidalConfig
  | LimiterConfig
  | CheapReverbConfig
  | GateConfig
  | WaveshaperConfig
  | MaximizerConfig
  | VocoderConfig
  | NeuralAmpConfig
  | WerkstattConfig
  | AutotuneConfig
  | FxCompositeConfig
  | StereoSplitConfig
  | FrequencySplitConfig;

/**
 * Stereo channel pair type (openDAW compatible)
 * @see StereoMatrix.Channels from @opendaw/lib-dsp
 */
export type StereoChannels = [Float32Array, Float32Array];

/**
 * Common interface for all effect processors
 *
 * Uses openDAW-compatible signature with stereo channel pairs.
 */
export type EffectProcessor = {
  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void;
  setSidechainInput?(input: StereoChannels | null): void;
  setTempo?(bpm: number): void;
  reset(): void;
};
