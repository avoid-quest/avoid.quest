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

// Order options for HP/LP filters
export const orderOptions: SelectOption[] = [
  { value: "1", label: "6 dB/oct" },
  { value: "2", label: "12 dB/oct" },
  { value: "3", label: "18 dB/oct" },
  { value: "4", label: "24 dB/oct" },
];

// Oversample options for distortion
export const distortionOversampleOptions: SelectOption[] = [
  { value: "none", label: "None" },
  { value: "2x", label: "2x" },
  { value: "4x", label: "4x" },
];

// Oversample options for fold
export const foldOversampleOptions: SelectOption[] = [
  { value: "2", label: "2x" },
  { value: "4", label: "4x" },
  { value: "8", label: "8x" },
];

export const delayFractionOptions: SelectOption[] = OPENDAW_DELAY_FRACTIONS.map(
  (value) => ({ value, label: value })
);

export const tidalFractionOptions: SelectOption[] = OPENDAW_TIDAL_FRACTIONS.map(
  (value) => ({ value, label: value })
);

export const panLawOptions: SelectOption[] = [
  { value: "linear", label: "Linear" },
  { value: "equalPower", label: "Equal power" },
];

export const waveshaperEquationLabels: Record<
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

export const waveshaperEquationOptions: SelectOption[] =
  OPENDAW_WAVESHAPER_EQUATIONS.map((value) => ({
    value,
    label: waveshaperEquationLabels[value],
  }));

export const vocoderBandOptions: SelectOption[] = [8, 12, 16].map((value) => ({
  value: String(value),
  label: `${value} bands`,
}));

export const vocoderModulatorOptions: SelectOption[] = [
  { value: "noise-white", label: "White noise" },
  { value: "noise-pink", label: "Pink noise" },
  { value: "noise-brown", label: "Brown noise" },
  { value: "self", label: "Self" },
  { value: "external", label: "External sidechain" },
];

export const autotuneKeyOptions: SelectOption[] = AUTOTUNE_KEYS.map(
  (value) => ({
    value,
    label: value,
  })
);

export const autotuneScaleLabels: Record<
  (typeof AUTOTUNE_SCALES)[number],
  string
> = {
  chromatic: "Chromatic",
  major: "Major",
  minor: "Minor",
  majorPentatonic: "Major pentatonic",
  minorPentatonic: "Minor pentatonic",
  blues: "Blues",
  dorian: "Dorian",
  mixolydian: "Mixolydian",
};

export const autotuneScaleOptions: SelectOption[] = AUTOTUNE_SCALES.map(
  (value) => ({
    value,
    label: autotuneScaleLabels[value],
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
export function createShelfBandGroup(
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
export function createPassFilterGroup(
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
