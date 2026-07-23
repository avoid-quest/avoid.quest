import type {
  EffectDefinitionMap,
  EffectParamKey,
  GroupParamDef,
  SelectOption,
} from "./param-types.js";
import { defineEffect } from "./param-types.js";
import {
  AUTOTUNE_KEYS,
  AUTOTUNE_SCALES,
  OPENDAW_DELAY_FRACTIONS,
  OPENDAW_TIDAL_FRACTIONS,
  OPENDAW_WAVESHAPER_EQUATIONS,
} from "./types.js";
import { DEFAULT_WERKSTATT_SOURCE } from "./werkstatt-presets.js";

// Order options for HP/LP filters
const orderOptions: SelectOption[] = [
  { value: "1", label: "6 dB/oct" },
  { value: "2", label: "12 dB/oct" },
  { value: "3", label: "18 dB/oct" },
  { value: "4", label: "24 dB/oct" },
];

// Oversample options for distortion
const distortionOversampleOptions: SelectOption[] = [
  { value: "none", label: "None" },
  { value: "2x", label: "2x" },
  { value: "4x", label: "4x" },
];

// Oversample options for fold
const foldOversampleOptions: SelectOption[] = [
  { value: "2", label: "2x" },
  { value: "4", label: "4x" },
  { value: "8", label: "8x" },
];

const delayFractionOptions: SelectOption[] = OPENDAW_DELAY_FRACTIONS.map(
  (value) => ({ value, label: value })
);

const tidalFractionOptions: SelectOption[] = OPENDAW_TIDAL_FRACTIONS.map(
  (value) => ({ value, label: value })
);

const panLawOptions: SelectOption[] = [
  { value: "linear", label: "Linear" },
  { value: "equalPower", label: "Equal power" },
];

const waveshaperEquationLabels: Record<
  (typeof OPENDAW_WAVESHAPER_EQUATIONS)[number],
  string
> = {
  hardclip: "Hard clip",
  cubicSoft: "Cubic soft",
  tanh: "Tanh",
  sigmoid: "Sigmoid",
  arctan: "Arctangent",
  asymmetric: "Asymmetric",
};

const waveshaperEquationOptions: SelectOption[] =
  OPENDAW_WAVESHAPER_EQUATIONS.map((value) => ({
    value,
    label: waveshaperEquationLabels[value],
  }));

const vocoderBandOptions: SelectOption[] = [8, 12, 16].map((value) => ({
  value: String(value),
  label: `${value} bands`,
}));

const vocoderModulatorOptions: SelectOption[] = [
  { value: "noise-white", label: "White noise" },
  { value: "noise-pink", label: "Pink noise" },
  { value: "noise-brown", label: "Brown noise" },
  { value: "self", label: "Self" },
  { value: "external", label: "External sidechain" },
];

const autotuneKeyOptions: SelectOption[] = AUTOTUNE_KEYS.map((value) => ({
  value,
  label: value,
}));

const autotuneScaleLabels: Record<(typeof AUTOTUNE_SCALES)[number], string> = {
  chromatic: "Chromatic",
  major: "Major",
  minor: "Minor",
  majorPentatonic: "Major pentatonic",
  minorPentatonic: "Minor pentatonic",
  blues: "Blues",
  dorian: "Dorian",
  mixolydian: "Mixolydian",
};

const autotuneScaleOptions: SelectOption[] = AUTOTUNE_SCALES.map((value) => ({
  value,
  label: autotuneScaleLabels[value],
}));

type BellBandPrefix = "lowBell" | "midBell" | "highBell";
type ShelfBandPrefix = "lowShelf" | "highShelf";
type PassFilterPrefix = "highPass" | "lowPass";
type RevampParamKey = EffectParamKey<"revamp">;

// Band factory: Bell (freq, gain, q)
function createBellBandGroup(
  prefix: BellBandPrefix,
  title: string
): GroupParamDef<RevampParamKey> {
  const enabledKey = `${prefix}Enabled` as RevampParamKey;
  const frequencyKey = `${prefix}Frequency` as RevampParamKey;
  const gainKey = `${prefix}Gain` as RevampParamKey;
  const qKey = `${prefix}Q` as RevampParamKey;

  return {
    type: "group",
    title,
    collapsible: true,
    enabledKey,
    children: [
      { type: "checkbox", key: enabledKey, label: "Enabled" },
      {
        type: "slider",
        key: frequencyKey,
        label: "Frequency",
        formatKey: "frequency",
        min: 20,
        max: 20_000,
        step: 1,
      },
      {
        type: "slider",
        key: gainKey,
        label: "Gain",
        formatKey: "db",
        min: -40,
        max: 40,
        step: 0.1,
      },
      {
        type: "slider",
        key: qKey,
        label: "Q",
        formatKey: "q",
        min: 0.1,
        max: 30,
        step: 0.1,
      },
    ],
  };
}

// Band factory: Shelf (freq, gain)
function createShelfBandGroup(
  prefix: ShelfBandPrefix,
  title: string
): GroupParamDef<RevampParamKey> {
  const enabledKey = `${prefix}Enabled` as RevampParamKey;
  const frequencyKey = `${prefix}Frequency` as RevampParamKey;
  const gainKey = `${prefix}Gain` as RevampParamKey;

  return {
    type: "group",
    title,
    collapsible: true,
    enabledKey,
    children: [
      { type: "checkbox", key: enabledKey, label: "Enabled" },
      {
        type: "slider",
        key: frequencyKey,
        label: "Frequency",
        formatKey: "frequency",
        min: 20,
        max: 20_000,
        step: 1,
      },
      {
        type: "slider",
        key: gainKey,
        label: "Gain",
        formatKey: "db",
        min: -40,
        max: 40,
        step: 0.1,
      },
    ],
  };
}

// Band factory: Pass filter (freq, q, order)
function createPassFilterGroup(
  prefix: PassFilterPrefix,
  title: string
): GroupParamDef<RevampParamKey> {
  const enabledKey = `${prefix}Enabled` as RevampParamKey;
  const frequencyKey = `${prefix}Frequency` as RevampParamKey;
  const qKey = `${prefix}Q` as RevampParamKey;
  const orderKey = `${prefix}Order` as RevampParamKey;

  return {
    type: "group",
    title,
    collapsible: true,
    enabledKey,
    children: [
      { type: "checkbox", key: enabledKey, label: "Enabled" },
      {
        type: "slider",
        key: frequencyKey,
        label: "Frequency",
        formatKey: "frequency",
        min: 20,
        max: 20_000,
        step: 1,
      },
      {
        type: "slider",
        key: qKey,
        label: "Q",
        formatKey: "q",
        min: 0.1,
        max: 30,
        step: 0.1,
      },
      {
        type: "select",
        key: orderKey,
        label: "Slope",
        options: orderOptions,
        valueType: "number",
      },
    ],
  };
}

export const EFFECT_DEFINITIONS = {
  plateReverb: defineEffect({
    type: "plateReverb",
    name: "Dattorro Reverb",
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
      wet: 0,
      dry: -72,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
    params: [
      {
        type: "group",
        title: "Pre-Delay & Bandwidth",
        children: [
          {
            type: "slider",
            key: "preDelay",
            label: "Pre-Delay",
            formatKey: "milliseconds",
            min: 0,
            max: 1000,
            step: 1,
          },
          {
            type: "slider",
            key: "bandwidth",
            label: "Bandwidth",
            formatKey: "default",
            min: 0,
            max: 1,
            step: 0.0001,
          },
        ],
      },
      {
        type: "group",
        title: "Input Diffusion",
        children: [
          {
            type: "slider",
            key: "inputDiffusion1",
            label: "Input Diffusion 1",
            formatKey: "default",
            min: 0,
            max: 1,
            step: 0.01,
          },
          {
            type: "slider",
            key: "inputDiffusion2",
            label: "Input Diffusion 2",
            formatKey: "default",
            min: 0,
            max: 1,
            step: 0.01,
          },
        ],
      },
      {
        type: "group",
        title: "Decay",
        children: [
          {
            type: "slider",
            key: "decay",
            label: "Decay",
            formatKey: "default",
            min: 0,
            max: 1,
            step: 0.01,
          },
          {
            type: "slider",
            key: "decayDiffusion1",
            label: "Decay Diffusion 1",
            formatKey: "default",
            min: 0,
            max: 0.999_999,
            step: 0.001,
          },
          {
            type: "slider",
            key: "decayDiffusion2",
            label: "Decay Diffusion 2",
            formatKey: "default",
            min: 0,
            max: 0.999_999,
            step: 0.001,
          },
        ],
      },
      {
        type: "group",
        title: "Modulation",
        children: [
          {
            type: "slider",
            key: "damping",
            label: "Damping",
            formatKey: "default",
            min: 0,
            max: 1,
            step: 0.001,
          },
          {
            type: "slider",
            key: "excursionRate",
            label: "Excursion Rate",
            formatKey: "default",
            min: 0,
            max: 2,
            step: 0.01,
          },
          {
            type: "slider",
            key: "excursionDepth",
            label: "Excursion Depth",
            formatKey: "default",
            min: 0,
            max: 2,
            step: 0.01,
          },
        ],
      },
      {
        type: "group",
        title: "Mix",
        children: [
          {
            type: "slider",
            key: "dry",
            label: "Device Dry",
            description:
              "Native dry level inside the reverb; independent of the outer Effect Mix.",
            formatKey: "db",
            min: -72,
            max: 12,
            step: 0.1,
          },
          {
            type: "slider",
            key: "wet",
            label: "Device Wet",
            description:
              "Native reverb-return level before the outer Effect Mix.",
            formatKey: "db",
            min: -72,
            max: 12,
            step: 0.1,
          },
        ],
      },
    ],
  }),

  pitchShifter: defineEffect({
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
    params: [
      {
        type: "group",
        title: "Pitch",
        children: [
          {
            type: "slider",
            key: "pitchFactor",
            label: "Pitch Factor",
            formatKey: "default",
            min: 0.25,
            max: 4.0,
            step: 0.01,
          },
        ],
      },
    ],
  }),

  delay: defineEffect({
    type: "delay",
    name: "Delay",
    description: "Tempo-syncable stereo delay with filtering and modulation",
    defaultConfig: {
      type: "delay",
      enabled: false,
      delayMusical: "1/4",
      delayMillis: 0,
      delayTime: 0.3,
      feedback: 0.5,
      cross: 1,
      filter: 0,
      wet: 0,
      dry: -72,
      preSyncTimeLeft: "1/16",
      preMillisTimeLeft: 0,
      preSyncTimeRight: "Off",
      preMillisTimeRight: 0,
      lfoSpeed: 0.1,
      lfoDepth: 0,
      tempoSync: false,
      tempoDivision: "1/4",
      preDelay: 0,
      crossFeedback: 0,
      filterFrequency: 12_000,
      lfoRate: 0,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
    params: [
      {
        type: "group",
        title: "Main Delay",
        children: [
          {
            type: "select",
            key: "delayMusical",
            label: "Musical delay",
            options: delayFractionOptions,
          },
          {
            type: "slider",
            key: "delayMillis",
            label: "Additional delay",
            formatKey: "milliseconds",
            min: 0,
            max: 1000,
            step: 0.1,
          },
        ],
      },
      {
        type: "group",
        title: "Pre-delay",
        children: [
          {
            type: "select",
            key: "preSyncTimeLeft",
            label: "Left sync",
            options: delayFractionOptions,
          },
          {
            type: "slider",
            key: "preMillisTimeLeft",
            label: "Left milliseconds",
            formatKey: "milliseconds",
            min: 0,
            max: 1000,
            step: 0.1,
          },
          {
            type: "select",
            key: "preSyncTimeRight",
            label: "Right sync",
            options: delayFractionOptions,
          },
          {
            type: "slider",
            key: "preMillisTimeRight",
            label: "Right milliseconds",
            formatKey: "milliseconds",
            min: 0,
            max: 1000,
            step: 0.1,
          },
        ],
      },
      {
        type: "slider",
        key: "feedback",
        label: "Feedback",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        type: "slider",
        key: "cross",
        label: "Cross-feedback",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        type: "slider",
        key: "filter",
        label: "Filter",
        formatKey: "percentage",
        min: -1,
        max: 1,
        step: 0.01,
      },
      {
        type: "group",
        title: "Modulation",
        children: [
          {
            type: "slider",
            key: "lfoSpeed",
            label: "LFO rate",
            formatKey: "hz",
            min: 0.1,
            max: 5,
            step: 0.01,
          },
          {
            type: "slider",
            key: "lfoDepth",
            label: "LFO depth",
            formatKey: "milliseconds",
            min: 0,
            max: 50,
            step: 0.1,
          },
        ],
      },
      {
        type: "group",
        title: "Mix",
        children: [
          {
            type: "slider",
            key: "dry",
            label: "Device Dry",
            description:
              "Native dry level inside the delay; independent of the outer Effect Mix.",
            formatKey: "db",
            min: -72,
            max: 12,
            step: 0.1,
          },
          {
            type: "slider",
            key: "wet",
            label: "Device Wet",
            description:
              "Native delay-return level before the outer Effect Mix.",
            formatKey: "db",
            min: -72,
            max: 12,
            step: 0.1,
          },
        ],
      },
    ],
  }),

  distortion: defineEffect({
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
    params: [
      {
        type: "slider",
        key: "amount",
        label: "Amount",
        formatKey: "percentage100",
        min: 0,
        max: 100,
        step: 1,
      },
      {
        type: "select",
        key: "oversample",
        label: "Oversample",
        options: distortionOversampleOptions,
        valueType: "string",
      },
    ],
  }),

  compressor: defineEffect({
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
      lookahead: false,
      autoAttack: false,
      autoRelease: false,
      autoMakeup: true,
      inputgain: 0,
      automakeup: true,
      autoattack: false,
      autorelease: false,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
    visualization: "compressor-curve",
    params: [
      {
        type: "group",
        title: "Threshold & Ratio",
        children: [
          {
            type: "slider",
            key: "threshold",
            label: "Threshold",
            formatKey: "db",
            min: -60,
            max: 0,
            step: 0.5,
          },
          {
            type: "slider",
            key: "ratio",
            label: "Ratio",
            formatKey: "ratio",
            min: 1,
            max: 24,
            step: 0.1,
          },
        ],
      },
      {
        type: "group",
        title: "Timing",
        children: [
          {
            type: "slider",
            key: "attack",
            label: "Attack",
            formatKey: "milliseconds",
            min: 0,
            max: 100,
            step: 0.1,
          },
          {
            type: "slider",
            key: "release",
            label: "Release",
            formatKey: "milliseconds",
            min: 5,
            max: 1500,
            step: 1,
          },
        ],
      },
      {
        type: "slider",
        key: "knee",
        label: "Knee",
        formatKey: "db",
        min: 0,
        max: 24,
        step: 0.5,
      },
      {
        type: "slider",
        key: "makeup",
        label: "Device Makeup Gain",
        description:
          "Gain applied by the compressor after reduction and before the wrapper.",
        formatKey: "db",
        min: -40,
        max: 40,
        step: 0.5,
      },
      {
        type: "slider",
        key: "mix",
        label: "Device Mix",
        description:
          "Parallel blend inside the compressor; Effect Mix remains the outer wrapper blend.",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        type: "slider",
        key: "inputgain",
        label: "Device Input Gain",
        description:
          "Drives the compressor detector and processor before the wrapper mix.",
        formatKey: "db",
        min: -30,
        max: 30,
        step: 0.1,
      },
      {
        type: "group",
        title: "Auto Controls",
        children: [
          {
            type: "checkbox",
            key: "lookahead",
            label: "Lookahead (5ms)",
            description: "Enable lookahead for better transient handling",
          },
          {
            type: "checkbox",
            key: "autoattack",
            label: "Auto Attack",
            description: "Automatically adjust attack based on crest factor",
          },
          {
            type: "checkbox",
            key: "autorelease",
            label: "Auto Release",
            description: "Automatically adjust release based on crest factor",
          },
          {
            type: "checkbox",
            key: "automakeup",
            label: "Auto Makeup",
            description: "Automatically compensate for gain reduction",
          },
        ],
      },
    ],
  }),

  crusher: defineEffect({
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
    params: [
      {
        type: "slider",
        key: "crush",
        label: "Crush",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        type: "slider",
        key: "bitDepth",
        label: "Bit Depth",
        formatKey: "bits",
        min: 1,
        max: 16,
        step: 1,
      },
      {
        type: "slider",
        key: "boost",
        label: "Device Boost",
        description:
          "Native crusher boost; Auto Gain may compensate it before Post-FX Trim.",
        formatKey: "db",
        min: -40,
        max: 40,
        step: 0.1,
      },
      {
        type: "checkbox",
        key: "autoGain",
        label: "Auto Gain",
        description: "Automatically compensate for boost",
      },
    ],
  }),

  fold: defineEffect({
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
    params: [
      {
        type: "slider",
        key: "amount",
        label: "Amount",
        formatKey: "db",
        min: -40,
        max: 40,
        step: 0.1,
      },
      {
        type: "slider",
        key: "volume",
        label: "Device Volume",
        description:
          "Native fold output level before the outer wrapper and Post-FX Trim.",
        formatKey: "db",
        min: -40,
        max: 40,
        step: 0.1,
      },
      {
        type: "select",
        key: "oversample",
        label: "Oversample",
        options: foldOversampleOptions,
        valueType: "number",
      },
      {
        type: "checkbox",
        key: "autoGain",
        label: "Auto Gain",
        description: "Automatically compensate for amount",
      },
    ],
  }),

  stereoTool: defineEffect({
    type: "stereoTool",
    name: "Stereo Tool",
    description: "Stereo manipulation with volume, width, and channel controls",
    defaultConfig: {
      type: "stereoTool",
      enabled: false,
      volume: 0,
      stereo: 0,
      panning: 0,
      panLaw: "equalPower",
      invertL: false,
      invertR: false,
      swap: false,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
    params: [
      {
        type: "slider",
        key: "volume",
        label: "Device Volume",
        description:
          "Native stereo-device level before the outer wrapper and Post-FX Trim.",
        formatKey: "db",
        min: -40,
        max: 40,
        step: 0.1,
      },
      {
        type: "slider",
        key: "stereo",
        label: "Stereo Width",
        formatKey: "percentage",
        min: -1,
        max: 1,
        step: 0.01,
      },
      {
        type: "slider",
        key: "panning",
        label: "Panning",
        formatKey: "pan",
        min: -1,
        max: 1,
        step: 0.01,
      },
      {
        type: "select",
        key: "panLaw",
        label: "Pan law",
        options: panLawOptions,
      },
      {
        type: "group",
        title: "Channel Options",
        children: [
          {
            type: "checkbox",
            key: "invertL",
            label: "Invert Left",
          },
          {
            type: "checkbox",
            key: "invertR",
            label: "Invert Right",
          },
          {
            type: "checkbox",
            key: "swap",
            label: "Swap Channels",
          },
        ],
      },
    ],
  }),

  revamp: defineEffect({
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
    visualization: "eq-curve",
    params: [
      createPassFilterGroup("highPass", "High Pass"),
      createShelfBandGroup("lowShelf", "Low Shelf"),
      createBellBandGroup("lowBell", "Low Bell"),
      createBellBandGroup("midBell", "Mid Bell"),
      createBellBandGroup("highBell", "High Bell"),
      createShelfBandGroup("highShelf", "High Shelf"),
      createPassFilterGroup("lowPass", "Low Pass"),
    ],
  }),

  tidal: defineEffect({
    type: "tidal",
    name: "Tidal",
    description:
      "Rhythm shaping effect with rate, depth, slope, symmetry, and phase controls",
    defaultConfig: {
      type: "tidal",
      enabled: false,
      rate: 1.0,
      rateDivision: "1/4",
      tempoSync: true,
      tempoDivision: "1/4",
      depth: 0.75,
      slope: -0.25,
      symmetry: 0.5,
      offset: 0,
      channelOffset: 0,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
    params: [
      {
        type: "select",
        key: "rateDivision",
        label: "Rate",
        options: tidalFractionOptions,
      },
      {
        type: "slider",
        key: "depth",
        label: "Depth",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        type: "slider",
        key: "slope",
        label: "Slope",
        formatKey: "percentage",
        min: -1,
        max: 1,
        step: 0.01,
      },
      {
        type: "slider",
        key: "symmetry",
        label: "Symmetry",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        type: "group",
        title: "Phase",
        children: [
          {
            type: "slider",
            key: "offset",
            label: "Offset",
            formatKey: "degrees",
            min: -180,
            max: 180,
            step: 1,
          },
          {
            type: "slider",
            key: "channelOffset",
            label: "Channel Offset",
            formatKey: "degrees",
            min: -180,
            max: 180,
            step: 1,
          },
        ],
      },
    ],
  }),

  cheapReverb: defineEffect({
    type: "cheapReverb",
    name: "Free Reverb",
    description: "Lightweight FreeVerb-style room reverb",
    defaultConfig: {
      type: "cheapReverb",
      enabled: false,
      roomSize: 0.5,
      damping: 0.5,
      width: 1,
      decay: 0.5,
      preDelay: 0.001,
      damp: 0.5,
      filter: 0,
      wet: 0,
      dry: -72,
      dryWet: 0.35,
      inputGain: 1,
      outputGain: 1,
    },
    params: [
      {
        type: "slider",
        key: "decay",
        label: "Decay",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        type: "slider",
        key: "preDelay",
        label: "Pre-delay",
        formatKey: "time",
        min: 0.001,
        max: 0.5,
        step: 0.001,
      },
      {
        type: "slider",
        key: "damp",
        label: "Damp",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        type: "slider",
        key: "filter",
        label: "Filter",
        formatKey: "percentage",
        min: -1,
        max: 1,
        step: 0.01,
      },
      {
        type: "group",
        title: "Mix",
        children: [
          {
            type: "slider",
            key: "dry",
            label: "Device Dry",
            description:
              "Native dry level inside the reverb; independent of the outer Effect Mix.",
            formatKey: "db",
            min: -72,
            max: 12,
            step: 0.1,
          },
          {
            type: "slider",
            key: "wet",
            label: "Device Wet",
            description:
              "Native reverb-return level before the outer Effect Mix.",
            formatKey: "db",
            min: -72,
            max: 12,
            step: 0.1,
          },
        ],
      },
    ],
  }),

  gate: defineEffect({
    type: "gate",
    name: "Gate",
    description: "Noise gate with hold, floor, inverse, and sidechain support",
    defaultConfig: {
      type: "gate",
      enabled: false,
      threshold: -6,
      return: 0,
      attack: 1,
      hold: 50,
      release: 100,
      floor: -72,
      inverse: false,
      dryWet: 1,
      inputGain: 1,
      outputGain: 1,
    },
    params: [
      {
        type: "slider",
        key: "threshold",
        label: "Threshold",
        formatKey: "db",
        min: -80,
        max: 0,
        step: 0.5,
      },
      {
        type: "slider",
        key: "return",
        label: "Return",
        formatKey: "db",
        min: 0,
        max: 24,
        step: 0.1,
      },
      {
        type: "group",
        title: "Envelope",
        children: [
          {
            type: "slider",
            key: "attack",
            label: "Attack",
            formatKey: "milliseconds",
            min: 0,
            max: 1000,
            step: 0.1,
          },
          {
            type: "slider",
            key: "hold",
            label: "Hold",
            formatKey: "milliseconds",
            min: 0,
            max: 500,
            step: 1,
          },
          {
            type: "slider",
            key: "release",
            label: "Release",
            formatKey: "milliseconds",
            min: 1,
            max: 2000,
            step: 1,
          },
        ],
      },
      {
        type: "slider",
        key: "floor",
        label: "Floor",
        formatKey: "db",
        min: -72,
        max: 0,
        step: 0.5,
      },
      {
        type: "checkbox",
        key: "inverse",
        label: "Inverse",
        description: "Duck the signal when the detector opens",
      },
    ],
  }),

  waveshaper: defineEffect({
    type: "waveshaper",
    name: "Waveshaper",
    description: "Six selectable transfer curves with drive and output trim",
    defaultConfig: {
      type: "waveshaper",
      enabled: false,
      curve: "tanh",
      drive: 0,
      output: 0,
      equation: "hardclip",
      deviceInputGain: 0,
      deviceOutputGain: 0,
      mix: 1,
      dryWet: 1,
      inputGain: 1,
      outputGain: 1,
    },
    params: [
      {
        type: "select",
        key: "equation",
        label: "Equation",
        options: waveshaperEquationOptions,
      },
      {
        type: "slider",
        key: "deviceInputGain",
        label: "Device Input Gain",
        description:
          "Drive applied immediately before the shaping curve, after Pre-FX Trim.",
        formatKey: "db",
        min: 0,
        max: 40,
        step: 0.1,
      },
      {
        type: "slider",
        key: "deviceOutputGain",
        label: "Device Output Gain",
        description:
          "Native level after the shaping curve and before the wrapper.",
        formatKey: "db",
        min: -24,
        max: 24,
        step: 0.1,
      },
      {
        type: "slider",
        key: "mix",
        label: "Device Mix",
        description:
          "Blend inside the waveshaper; Effect Mix remains the outer wrapper blend.",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  }),

  maximizer: defineEffect({
    type: "maximizer",
    name: "Maximizer",
    description: "Lookahead brickwall limiter with automatic makeup",
    defaultConfig: {
      type: "maximizer",
      enabled: false,
      threshold: -6,
      ceiling: -0.1,
      release: 100,
      lookahead: 5,
      lookaheadEnabled: true,
      dryWet: 1,
      inputGain: 1,
      outputGain: 1,
    },
    params: [
      {
        type: "slider",
        key: "threshold",
        label: "Threshold",
        formatKey: "db",
        min: -24,
        max: 0,
        step: 0.1,
      },
      {
        type: "checkbox",
        key: "lookaheadEnabled",
        label: "Lookahead",
      },
    ],
  }),

  vocoder: defineEffect({
    type: "vocoder",
    name: "Vocoder",
    description: "Multiband vocoder with noise, self, or external modulator",
    defaultConfig: {
      type: "vocoder",
      enabled: false,
      bands: 16,
      modulator: "self",
      carrierGain: 1,
      modulatorGain: 1,
      noise: 0,
      carrierMinFreq: 100,
      carrierMaxFreq: 12_000,
      modulatorMinFreq: 100,
      modulatorMaxFreq: 12_000,
      qStart: 20,
      qEnd: 2,
      envAttack: 5,
      envRelease: 30,
      gain: 0,
      mix: 1,
      bandCount: 16,
      modulatorSource: "noise-pink",
      dryWet: 1,
      inputGain: 1,
      outputGain: 1,
    },
    params: [
      {
        type: "select",
        key: "bandCount",
        label: "Bands",
        options: vocoderBandOptions,
        valueType: "number",
      },
      {
        type: "select",
        key: "modulatorSource",
        label: "Modulator",
        options: vocoderModulatorOptions,
      },
      {
        type: "group",
        title: "Carrier range",
        children: [
          {
            type: "slider",
            key: "carrierMinFreq",
            label: "Minimum",
            formatKey: "frequency",
            min: 20,
            max: 20_000,
            step: 1,
          },
          {
            type: "slider",
            key: "carrierMaxFreq",
            label: "Maximum",
            formatKey: "frequency",
            min: 20,
            max: 20_000,
            step: 1,
          },
        ],
      },
      {
        type: "group",
        title: "Modulator range",
        children: [
          {
            type: "slider",
            key: "modulatorMinFreq",
            label: "Minimum",
            formatKey: "frequency",
            min: 20,
            max: 20_000,
            step: 1,
          },
          {
            type: "slider",
            key: "modulatorMaxFreq",
            label: "Maximum",
            formatKey: "frequency",
            min: 20,
            max: 20_000,
            step: 1,
          },
        ],
      },
      {
        type: "group",
        title: "Filter bank",
        children: [
          {
            type: "slider",
            key: "qStart",
            label: "Q start",
            min: 1,
            max: 60,
            step: 0.1,
          },
          {
            type: "slider",
            key: "qEnd",
            label: "Q end",
            min: 1,
            max: 60,
            step: 0.1,
          },
        ],
      },
      {
        type: "group",
        title: "Envelope",
        children: [
          {
            type: "slider",
            key: "envAttack",
            label: "Attack",
            formatKey: "milliseconds",
            min: 0.1,
            max: 100,
            step: 0.1,
          },
          {
            type: "slider",
            key: "envRelease",
            label: "Release",
            formatKey: "milliseconds",
            min: 1,
            max: 1000,
            step: 1,
          },
        ],
      },
      {
        type: "slider",
        key: "gain",
        label: "Device Output Gain",
        description:
          "Native vocoder output level before the outer wrapper and Post-FX Trim.",
        formatKey: "db",
        min: -20,
        max: 20,
        step: 0.1,
      },
      {
        type: "slider",
        key: "mix",
        label: "Device Mix",
        description:
          "Blend inside the vocoder; Effect Mix remains the outer wrapper blend.",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  }),

  neuralAmp: defineEffect({
    type: "neuralAmp",
    name: "Tone3000",
    description:
      "Local amp fallback; NAM model loading is gated and no credentials or models are bundled",
    defaultConfig: {
      type: "neuralAmp",
      enabled: false,
      modelId: null,
      modelUrl: null,
      modelName: null,
      modelData: null,
      input: 0,
      output: 0,
      cabinetEnabled: true,
      mono: true,
      mix: 1,
      dryWet: 1,
      inputGain: 1,
      outputGain: 1,
    },
    params: [
      {
        type: "slider",
        key: "input",
        label: "Device Input Gain",
        description: "Gain that drives the amp model after Pre-FX Trim.",
        formatKey: "db",
        min: -72,
        max: 12,
        step: 0.1,
      },
      {
        type: "slider",
        key: "output",
        label: "Device Output Gain",
        description: "Amp-model output level before the outer wrapper.",
        formatKey: "db",
        min: -72,
        max: 12,
        step: 0.1,
      },
      {
        type: "checkbox",
        key: "mono",
        label: "Mono",
      },
      {
        type: "slider",
        key: "mix",
        label: "Device Mix",
        description:
          "Blend inside Tone3000; Effect Mix remains the outer wrapper blend.",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  }),

  werkstatt: defineEffect({
    type: "werkstatt",
    name: "Werkstatt",
    description:
      "Client-side programmable DSP with declaration-driven controls",
    defaultConfig: {
      type: "werkstatt",
      enabled: false,
      source: "return input;",
      code: DEFAULT_WERKSTATT_SOURCE,
      parameters: {},
      samples: {},
      dryWet: 1,
      inputGain: 1,
      outputGain: 1,
    },
    params: [],
  }),

  autotune: defineEffect({
    type: "autotune",
    name: "Autotune",
    description: "Monophonic pitch correction with key and scale controls",
    defaultConfig: {
      type: "autotune",
      enabled: false,
      key: "C",
      scale: "chromatic",
      amount: 1,
      retune: 40,
      retuneAmount: 0.5,
      shift: 0,
      smoothing: 0.5,
      smooth: 0.6,
      dryWet: 1,
      inputGain: 1,
      outputGain: 1,
    },
    params: [
      {
        type: "select",
        key: "key",
        label: "Key",
        options: autotuneKeyOptions,
      },
      {
        type: "select",
        key: "scale",
        label: "Scale",
        options: autotuneScaleOptions,
      },
      {
        type: "slider",
        key: "amount",
        label: "Amount",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        type: "slider",
        key: "retuneAmount",
        label: "Retune",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        type: "slider",
        key: "shift",
        label: "Manual shift",
        formatKey: "semitones",
        min: -12,
        max: 12,
        step: 0.01,
      },
      {
        type: "slider",
        key: "smooth",
        label: "Smooth",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  }),

  fxComposite: defineEffect({
    type: "fxComposite",
    name: "FX Composite",
    description: "Parallel nested effect chains with branch mixing controls",
    defaultConfig: {
      type: "fxComposite",
      enabled: false,
      chains: [
        {
          id: "chain-a",
          name: "Chain A",
          order: 0,
          gain: Math.SQRT1_2,
          pan: 0,
          muted: false,
          solo: false,
          effects: [],
        },
        {
          id: "chain-b",
          name: "Chain B",
          order: 1,
          gain: Math.SQRT1_2,
          pan: 0,
          muted: false,
          solo: false,
          effects: [],
        },
      ],
      dryWet: 1,
      inputGain: 1,
      outputGain: 1,
    },
    params: [],
  }),

  stereoSplit: defineEffect({
    type: "stereoSplit",
    name: "Stereo Split",
    description: "Separate nested effect chains for left and right channels",
    defaultConfig: {
      type: "stereoSplit",
      enabled: false,
      chains: [
        {
          id: "left",
          name: "Left",
          order: 0,
          gain: 1,
          pan: 0,
          muted: false,
          solo: false,
          effects: [],
        },
        {
          id: "right",
          name: "Right",
          order: 1,
          gain: 1,
          pan: 0,
          muted: false,
          solo: false,
          effects: [],
        },
      ],
      dryWet: 1,
      inputGain: 1,
      outputGain: 1,
    },
    params: [],
  }),

  frequencySplit: defineEffect({
    type: "frequencySplit",
    name: "Frequency Split",
    description: "Linkwitz-Riley multiband routing with one chain per band",
    defaultConfig: {
      type: "frequencySplit",
      enabled: false,
      frequencyBandCount: 4,
      chains: [
        {
          id: "low",
          name: "Low",
          order: 0,
          gain: 1,
          pan: 0,
          muted: false,
          solo: false,
          effects: [],
        },
        {
          id: "low-mid",
          name: "Low Mid",
          order: 1,
          gain: 1,
          pan: 0,
          muted: false,
          solo: false,
          effects: [],
        },
        {
          id: "high-mid",
          name: "High Mid",
          order: 2,
          gain: 1,
          pan: 0,
          muted: false,
          solo: false,
          effects: [],
        },
        {
          id: "high",
          name: "High",
          order: 3,
          gain: 1,
          pan: 0,
          muted: false,
          solo: false,
          effects: [],
        },
      ],
      crossoverFrequencies: [200, 1000, 5000],
      dryWet: 1,
      inputGain: 1,
      outputGain: 1,
    },
    params: [],
  }),

  limiter: defineEffect({
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
    params: [
      {
        type: "group",
        title: "Limiter",
        children: [
          {
            type: "slider",
            key: "threshold",
            label: "Threshold",
            formatKey: "db",
            min: -60,
            max: 0,
            step: 0.1,
          },
        ],
      },
    ],
  }),
} as const satisfies EffectDefinitionMap;

export const EFFECT_SCHEMAS = EFFECT_DEFINITIONS;
