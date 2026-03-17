/**
 * Declarative Effect Parameter Schema
 *
 * Schema-driven parameter definitions for all effects.
 * Replaces individual param component files with a single declarative structure.
 */

import type { EffectType } from "./types.js";

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

export type VisualizationType = "eq-curve" | "compressor-curve" | "none";

export type EffectSchema = {
  type: EffectType;
  name: string;
  description: string;
  params: ParamDef[];
  visualization?: VisualizationType;
};

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

export const EFFECT_SCHEMAS = {
  plateReverb: {
    type: "plateReverb",
    name: "Plate Reverb",
    description: "Advanced plate reverb with extensive controls",
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
    name: "Pitch Shifter",
    description:
      "Multiple pitch shifting algorithms: Varispeed, OLA Phase Vocoder, PSOLA, and Granular synthesis",
    params: [
      {
        type: "select",
        key: "variant",
        label: "Algorithm",
        options: [
          { value: "ola", label: "OLA Phase Vocoder" },
          { value: "varispeed", label: "Varispeed" },
          { value: "psola", label: "PSOLA" },
          { value: "granular", label: "Granular" },
        ],
        valueType: "string",
      },
      {
        type: "slider",
        key: "pitchFactor",
        label: "Pitch Factor",
        formatKey: "default",
        min: 0.25,
        max: 4.0,
        step: 0.01,
      },
      {
        type: "slider",
        key: "grainSize",
        label: "Grain Size (ms)",
        formatKey: "default",
        min: 10,
        max: 200,
        step: 1,
      },
    ],
  },

  delay: {
    type: "delay",
    name: "Delay",
    description: "Echo/delay effect with feedback control",
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
} as const satisfies Record<EffectType, EffectSchema>;

export function getEffectSchema(type: EffectType): EffectSchema | undefined {
  return EFFECT_SCHEMAS[type];
}

/**
 * Extract all parameter keys from a schema's params array (recursive for groups).
 * Used for runtime validation.
 */
function extractParamKeys(params: ParamDef[]): string[] {
  const keys: string[] = [];
  for (const param of params) {
    if (param.type === "group") {
      keys.push(...extractParamKeys(param.children));
    } else {
      keys.push(param.key);
    }
  }
  return keys;
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
