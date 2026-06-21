/**
 * Declarative Effect Parameter Schema
 *
 * Schema-driven parameter definitions for all effects.
 * Replaces individual param component files with a single declarative structure.
 */

import type { EffectConfig, EffectType } from "./types.js";

export type ParamType = "slider" | "select" | "checkbox" | "group";

export type SliderParamDef = {
  type: "slider";
  key: string;
  label: string;
  formatKey?: string;
  min: number;
  max: number;
  step: number;
  description?: string;
};

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectParamDef = {
  type: "select";
  key: string;
  label: string;
  options: SelectOption[];
  /** If provided, parse value to this type (default: string) */
  valueType?: "string" | "number";
};

export type CheckboxParamDef = {
  type: "checkbox";
  key: string;
  label: string;
  description?: string;
};

export type GroupParamDef = {
  type: "group";
  title: string;
  children: ParamDef[];
  collapsible?: boolean;
  /** Key for enabled toggle that controls collapse state */
  enabledKey?: string;
};

export type ParamDef =
  | SliderParamDef
  | SelectParamDef
  | CheckboxParamDef
  | GroupParamDef;
export type EffectParamDef = Exclude<ParamDef, GroupParamDef>;

export type VisualizationType = "eq-curve" | "compressor-curve" | "none";

export type EngineEffectParamValue = number | string;
export type EngineEffectConfig = Record<string, EngineEffectParamValue>;

export type EffectDefaultConfig<TType extends EffectType = EffectType> = Omit<
  Extract<EffectConfig, { type: TType }>,
  "id" | "order"
>;

export type EffectDefinition<TType extends EffectType = EffectType> = {
  type: TType;
  name: string;
  description: string;
  defaultConfig: EffectDefaultConfig<TType>;
  params: ParamDef[];
  visualization?: VisualizationType;
};

export type EffectDefinitionMap = {
  [TType in EffectType]: EffectDefinition<TType>;
};

export type EffectSchema<TType extends EffectType = EffectType> =
  EffectDefinition<TType>;

export const UNIVERSAL_EFFECT_PARAM_DEFS: readonly SliderParamDef[] = [
  {
    type: "slider",
    key: "dryWet",
    label: "Dry/Wet",
    formatKey: "percentage",
    min: 0,
    max: 1,
    step: 0.01,
    description:
      "Effect Mix: 0% = dry (bypassed), 100% = fully wet (full effect)",
  },
  {
    type: "slider",
    key: "inputGain",
    label: "Input Gain",
    formatKey: "linearGain",
    min: 0,
    max: 4.0,
    step: 0.01,
  },
  {
    type: "slider",
    key: "outputGain",
    label: "Output Gain",
    formatKey: "linearGain",
    min: 0,
    max: 4.0,
    step: 0.01,
  },
];

const UNIVERSAL_EFFECT_PARAM_KEYS = new Set([
  "enabled",
  ...UNIVERSAL_EFFECT_PARAM_DEFS.map((param) => param.key),
]);

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

// Band factory: Bell (freq, gain, q)
function createBellBandGroup(prefix: string, title: string): GroupParamDef {
  const enabledKey = `${prefix}Enabled`;
  return {
    type: "group",
    title,
    collapsible: true,
    enabledKey,
    children: [
      { type: "checkbox", key: enabledKey, label: "Enabled" },
      {
        type: "slider",
        key: `${prefix}Frequency`,
        label: "Frequency",
        formatKey: "frequency",
        min: 20,
        max: 20_000,
        step: 1,
      },
      {
        type: "slider",
        key: `${prefix}Gain`,
        label: "Gain",
        formatKey: "db",
        min: -40,
        max: 40,
        step: 0.1,
      },
      {
        type: "slider",
        key: `${prefix}Q`,
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
function createShelfBandGroup(prefix: string, title: string): GroupParamDef {
  const enabledKey = `${prefix}Enabled`;
  return {
    type: "group",
    title,
    collapsible: true,
    enabledKey,
    children: [
      { type: "checkbox", key: enabledKey, label: "Enabled" },
      {
        type: "slider",
        key: `${prefix}Frequency`,
        label: "Frequency",
        formatKey: "frequency",
        min: 20,
        max: 20_000,
        step: 1,
      },
      {
        type: "slider",
        key: `${prefix}Gain`,
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
function createPassFilterGroup(prefix: string, title: string): GroupParamDef {
  const enabledKey = `${prefix}Enabled`;
  return {
    type: "group",
    title,
    collapsible: true,
    enabledKey,
    children: [
      { type: "checkbox", key: enabledKey, label: "Enabled" },
      {
        type: "slider",
        key: `${prefix}Frequency`,
        label: "Frequency",
        formatKey: "frequency",
        min: 20,
        max: 20_000,
        step: 1,
      },
      {
        type: "slider",
        key: `${prefix}Q`,
        label: "Q",
        formatKey: "q",
        min: 0.1,
        max: 30,
        step: 0.1,
      },
      {
        type: "select",
        key: `${prefix}Order`,
        label: "Slope",
        options: orderOptions,
        valueType: "number",
      },
    ],
  };
}

export const EFFECT_DEFINITIONS = {
  plateReverb: {
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
  },

  pitchShifter: {
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
  },

  delay: {
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
  },

  distortion: {
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
        formatKey: "percentage",
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
  },

  compressor: {
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
  },

  crusher: {
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
  },

  fold: {
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
  },

  stereoTool: {
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
  },

  revamp: {
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
  },

  tidal: {
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
  },

  limiter: {
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
  },
} as const satisfies EffectDefinitionMap;

export const EFFECT_SCHEMAS = EFFECT_DEFINITIONS;

export function getEffectDefinition(
  type: EffectType
): EffectDefinition | undefined {
  return EFFECT_DEFINITIONS[type];
}

export function getEffectSchema(type: EffectType): EffectSchema | undefined {
  return getEffectDefinition(type);
}

export function getEffectDefaultConfig(
  type: EffectType
): EffectDefaultConfig | undefined {
  return getEffectDefinition(type)?.defaultConfig;
}

export function getEffectParamDefs(type: EffectType): EffectParamDef[] {
  return extractParamDefs(EFFECT_DEFINITIONS[type].params);
}

export function getEffectSliderParamDefs(type: EffectType): SliderParamDef[] {
  return getEffectParamDefs(type).filter(
    (param): param is SliderParamDef => param.type === "slider"
  );
}

export function getEffectMidiParamDefs(type: EffectType): SliderParamDef[] {
  return [...getEffectSliderParamDefs(type), ...UNIVERSAL_EFFECT_PARAM_DEFS];
}

/**
 * Extract all parameter keys from a schema's params array (recursive for groups).
 * Used for runtime validation.
 */
function extractParamDefs(params: readonly ParamDef[]): EffectParamDef[] {
  const paramDefs: EffectParamDef[] = [];

  for (const param of params) {
    if (param.type === "group") {
      paramDefs.push(...extractParamDefs(param.children));
    } else {
      paramDefs.push(param);
    }
  }

  return paramDefs;
}

function extractParamKeys(params: ParamDef[]): string[] {
  return extractParamDefs(params).map((param) => param.key);
}

function effectConfigRecord(
  config: EffectConfig | Partial<EffectConfig>
): Record<string, unknown> {
  return config as Record<string, unknown>;
}

function convertBoolean(value: unknown): number | undefined {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "number") {
    return value === 0 ? 0 : 1;
  }
  return;
}

export function convertEffectParamValue(
  param: EffectParamDef,
  value: unknown
): EngineEffectParamValue | undefined {
  switch (param.type) {
    case "checkbox":
      return convertBoolean(value);
    case "slider":
      return typeof value === "number" ? value : undefined;
    case "select":
      if (param.valueType === "number") {
        return typeof value === "number" ? value : undefined;
      }
      return typeof value === "string" ? value : undefined;
    default:
      return;
  }
}

function applyUniversalParams(
  result: EngineEffectConfig,
  config: Record<string, unknown>
): void {
  if (config.enabled !== undefined) {
    const enabled = convertBoolean(config.enabled);
    if (enabled !== undefined) {
      result.enabled = enabled;
    }
  }

  if (typeof config.inputGain === "number") {
    result.inputGain = config.inputGain;
  }

  if (typeof config.outputGain === "number") {
    result.outputGain = config.outputGain;
  }

  if (typeof config.dryWet === "number") {
    result.wet = config.dryWet;
    result.dry = 1 - config.dryWet;
    result.dryWet = config.dryWet;
  }
}

function applyEffectParams(
  result: EngineEffectConfig,
  type: EffectType,
  config: Record<string, unknown>
): void {
  for (const param of getEffectParamDefs(type)) {
    if (config[param.key] === undefined) {
      continue;
    }

    const value = convertEffectParamValue(param, config[param.key]);
    if (value !== undefined) {
      result[param.key] = value;
    }
  }
}

function getKnownEffectParamKeys(): Set<string> {
  const keys = new Set<string>();

  for (const definition of Object.values(EFFECT_DEFINITIONS)) {
    for (const param of extractParamDefs(definition.params)) {
      keys.add(param.key);
    }
  }

  return keys;
}

export function convertEffectConfigToEngine(
  config: EffectConfig
): EngineEffectConfig {
  const result: EngineEffectConfig = {};
  const record = effectConfigRecord(config);

  applyUniversalParams(result, record);
  applyEffectParams(result, config.type, record);

  return result;
}

export function convertPartialEffectConfigToEngine(
  config: Partial<EffectConfig>
): EngineEffectConfig {
  const result: EngineEffectConfig = {};
  const record = effectConfigRecord(config);

  applyUniversalParams(result, record);

  if (config.type) {
    applyEffectParams(result, config.type, record);
    return result;
  }

  const knownParamKeys = getKnownEffectParamKeys();
  for (const [key, value] of Object.entries(record)) {
    if (UNIVERSAL_EFFECT_PARAM_KEYS.has(key) || !knownParamKeys.has(key)) {
      continue;
    }

    if (typeof value === "number" || typeof value === "string") {
      result[key] = value;
    } else if (typeof value === "boolean") {
      result[key] = value ? 1 : 0;
    }
  }

  return result;
}

/**
 * Validate that all schema parameter keys exist in their corresponding config type.
 * Run this in tests or dev mode to catch typos in schema keys.
 *
 * @param configKeys - Map of effect type to array of valid config property names
 * @returns Array of validation errors, empty if all valid
 */
export function validateSchemaKeys(
  configKeys: Record<EffectType, string[]>
): string[] {
  const errors: string[] = [];

  for (const [effectType, schema] of Object.entries(EFFECT_SCHEMAS)) {
    const validKeys = new Set(configKeys[effectType as EffectType] ?? []);
    const schemaKeys = extractParamKeys(schema.params);

    for (const key of schemaKeys) {
      if (!validKeys.has(key)) {
        errors.push(
          `Schema "${effectType}" has invalid key "${key}" - not found in config type`
        );
      }
    }
  }

  return errors;
}
