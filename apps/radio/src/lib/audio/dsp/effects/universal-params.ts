import type { SliderParamDef, UniversalEffectParamKey } from "./param-types.js";

export const UNIVERSAL_EFFECT_PARAM_DEFS: readonly SliderParamDef<
  Exclude<UniversalEffectParamKey, "enabled">
>[] = [
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

export const UNIVERSAL_EFFECT_PARAM_KEYS: ReadonlySet<string> = new Set([
  "enabled",
  ...UNIVERSAL_EFFECT_PARAM_DEFS.map((param) => param.key),
]);
