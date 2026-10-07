import type {
  EffectParamKey,
  GroupParamDef,
  SelectOption,
} from "./param-types.js";
import {
  AUTOTUNE_KEYS,
  AUTOTUNE_SCALES,
  OPENDAW_DELAY_FRACTIONS,
  OPENDAW_TIDAL_FRACTIONS,
  OPENDAW_WAVESHAPER_EQUATIONS,
} from "./types.js";

// Order options for HP/LP filters: each order cascades one 12 dB/oct biquad.
export const orderOptions: SelectOption[] = [
  { label: "12 dB/oct", value: "1" },
  { label: "24 dB/oct", value: "2" },
  { label: "36 dB/oct", value: "3" },
  { label: "48 dB/oct", value: "4" },
];

// Oversample options for distortion
export const distortionOversampleOptions: SelectOption[] = [
  { label: "None", value: "none" },
  { label: "2x", value: "2x" },
  { label: "4x", value: "4x" },
];

// Oversample options for fold
export const foldOversampleOptions: SelectOption[] = [
  { label: "2x", value: "2" },
  { label: "4x", value: "4" },
  { label: "8x", value: "8" },
];

export const delayFractionOptions: SelectOption[] = OPENDAW_DELAY_FRACTIONS.map(
  (value) => ({ label: value, value })
);

export const tidalFractionOptions: SelectOption[] = OPENDAW_TIDAL_FRACTIONS.map(
  (value) => ({ label: value, value })
);

export const panLawOptions: SelectOption[] = [
  { label: "Linear", value: "linear" },
  { label: "Equal power", value: "equalPower" },
];

export const waveshaperEquationLabels: Record<
  (typeof OPENDAW_WAVESHAPER_EQUATIONS)[number],
  string
> = {
  arctan: "Arctangent",
  asymmetric: "Asymmetric",
  cubicSoft: "Cubic soft",
  hardclip: "Hard clip",
  sigmoid: "Sigmoid",
  tanh: "Tanh",
};

export const waveshaperEquationOptions: SelectOption[] =
  OPENDAW_WAVESHAPER_EQUATIONS.map((value) => ({
    label: waveshaperEquationLabels[value],
    value,
  }));

export const vocoderBandOptions: SelectOption[] = [8, 12, 16].map((value) => ({
  label: `${value} bands`,
  value: String(value),
}));

export const vocoderModulatorOptions: SelectOption[] = [
  { label: "White noise", value: "noise-white" },
  { label: "Pink noise", value: "noise-pink" },
  { label: "Brown noise", value: "noise-brown" },
  { label: "Self", value: "self" },
  { label: "External sidechain", value: "external" },
];

export const autotuneKeyOptions: SelectOption[] = AUTOTUNE_KEYS.map(
  (value) => ({
    label: value,
    value,
  })
);

export const autotuneScaleLabels: Record<
  (typeof AUTOTUNE_SCALES)[number],
  string
> = {
  blues: "Blues",
  chromatic: "Chromatic",
  dorian: "Dorian",
  major: "Major",
  majorPentatonic: "Major pentatonic",
  minor: "Minor",
  minorPentatonic: "Minor pentatonic",
  mixolydian: "Mixolydian",
};

export const autotuneScaleOptions: SelectOption[] = AUTOTUNE_SCALES.map(
  (value) => ({
    label: autotuneScaleLabels[value],
    value,
  })
);

type BellBandPrefix = "lowBell" | "midBell" | "highBell";
type ShelfBandPrefix = "lowShelf" | "highShelf";
type PassFilterPrefix = "highPass" | "lowPass";
type RevampParamKey = EffectParamKey<"revamp">;

// Band factory: Bell (freq, gain, q)
export function createBellBandGroup(
  prefix: BellBandPrefix,
  title: string
): GroupParamDef<RevampParamKey> {
  const enabledKey = `${prefix}Enabled` as RevampParamKey;
  const frequencyKey = `${prefix}Frequency` as RevampParamKey;
  const gainKey = `${prefix}Gain` as RevampParamKey;
  const qKey = `${prefix}Q` as RevampParamKey;

  return {
    children: [
      { key: enabledKey, label: "Enabled", type: "checkbox" },
      {
        formatKey: "frequency",
        key: frequencyKey,
        label: "Frequency",
        max: 20_000,
        min: 20,
        step: 1,
        type: "slider",
      },
      {
        formatKey: "db",
        key: gainKey,
        label: "Gain",
        max: 40,
        min: -40,
        step: 0.1,
        type: "slider",
      },
      {
        formatKey: "q",
        key: qKey,
        label: "Q",
        max: 30,
        min: 0.1,
        step: 0.1,
        type: "slider",
      },
    ],
    collapsible: true,
    enabledKey,
    title,
    type: "group",
  };
}

// Band factory: Shelf (freq, gain)
export function createShelfBandGroup(
  prefix: ShelfBandPrefix,
  title: string
): GroupParamDef<RevampParamKey> {
  const enabledKey = `${prefix}Enabled` as RevampParamKey;
  const frequencyKey = `${prefix}Frequency` as RevampParamKey;
  const gainKey = `${prefix}Gain` as RevampParamKey;

  return {
    children: [
      { key: enabledKey, label: "Enabled", type: "checkbox" },
      {
        formatKey: "frequency",
        key: frequencyKey,
        label: "Frequency",
        max: 20_000,
        min: 20,
        step: 1,
        type: "slider",
      },
      {
        formatKey: "db",
        key: gainKey,
        label: "Gain",
        max: 40,
        min: -40,
        step: 0.1,
        type: "slider",
      },
    ],
    collapsible: true,
    enabledKey,
    title,
    type: "group",
  };
}

// Band factory: Pass filter (freq, q, order)
export function createPassFilterGroup(
  prefix: PassFilterPrefix,
  title: string
): GroupParamDef<RevampParamKey> {
  const enabledKey = `${prefix}Enabled` as RevampParamKey;
  const frequencyKey = `${prefix}Frequency` as RevampParamKey;
  const qKey = `${prefix}Q` as RevampParamKey;
  const orderKey = `${prefix}Order` as RevampParamKey;

  return {
    children: [
      { key: enabledKey, label: "Enabled", type: "checkbox" },
      {
        formatKey: "frequency",
        key: frequencyKey,
        label: "Frequency",
        max: 20_000,
        min: 20,
        step: 1,
        type: "slider",
      },
      {
        formatKey: "q",
        key: qKey,
        label: "Q",
        max: 30,
        min: 0.1,
        step: 0.1,
        type: "slider",
      },
      {
        key: orderKey,
        label: "Slope",
        options: orderOptions,
        type: "select",
        valueType: "number",
      },
    ],
    collapsible: true,
    enabledKey,
    title,
    type: "group",
  };
}
