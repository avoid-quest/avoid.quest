import type {
  EffectDefinitionMap,
  EffectParamKey,
  GroupParamDef,
  SelectOption,
} from "./param-types.js";
import { defineEffect } from "./param-types.js";

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
    params: [
      {
        type: "group",
        title: "Pre-Delay & Bandwidth",
        children: [
          {
            type: "slider",
            key: "preDelay",
            label: "Pre-Delay",
            formatKey: "samples",
            min: 0,
            max: 47_999,
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
    params: [
      {
        type: "slider",
        key: "delayTime",
        label: "Delay Time",
        formatKey: "time",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        type: "slider",
        key: "feedback",
        label: "Feedback",
        formatKey: "percentage",
        min: 0,
        max: 0.95,
        step: 0.01,
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
      lookahead: true,
      autoAttack: false,
      autoRelease: false,
      autoMakeup: false,
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
            formatKey: "timeMs",
            min: 0.1,
            max: 100,
            step: 0.1,
          },
          {
            type: "slider",
            key: "release",
            label: "Release",
            formatKey: "timeMs",
            min: 10,
            max: 2000,
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
        label: "Makeup Gain",
        formatKey: "db",
        min: -12,
        max: 24,
        step: 0.5,
      },
      {
        type: "slider",
        key: "mix",
        label: "Mix",
        formatKey: "percentage",
        min: 0,
        max: 1,
        step: 0.01,
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
            key: "autoAttack",
            label: "Auto Attack",
            description: "Automatically adjust attack based on crest factor",
          },
          {
            type: "checkbox",
            key: "autoRelease",
            label: "Auto Release",
            description: "Automatically adjust release based on crest factor",
          },
          {
            type: "checkbox",
            key: "autoMakeup",
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
        label: "Boost",
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
        label: "Volume",
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
        label: "Volume",
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
      depth: 0.0,
      slope: 0.0,
      symmetry: 0.0,
      offset: 0,
      channelOffset: 0,
      dryWet: 1.0,
      inputGain: 1.0,
      outputGain: 1.0,
    },
    params: [
      {
        type: "slider",
        key: "rate",
        label: "Rate",
        formatKey: "hz",
        min: 0.1,
        max: 10.0,
        step: 0.01,
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
        min: 0,
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
            min: 0,
            max: 360,
            step: 1,
          },
          {
            type: "slider",
            key: "channelOffset",
            label: "Channel Offset",
            formatKey: "degrees",
            min: 0,
            max: 360,
            step: 1,
          },
        ],
      },
    ],
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
