import type { SliderParamDef, UniversalEffectParamKey } from "./param-types.js";

export const UNIVERSAL_EFFECT_PARAM_DEFS: readonly SliderParamDef<
  Exclude<UniversalEffectParamKey, "enabled">
>[] = [
  {
    description:
      "Outer wrapper blend: 0% passes the original signal, 100% passes the complete device output.",
    formatKey: "percentage",
    key: "dryWet",
    label: "Effect Mix",
    max: 1,
    min: 0,
    step: 0.01,
    type: "slider",
  },
  {
    description:
      "Linear trim applied before the device, independently of native drive or detector-input controls.",
    formatKey: "linearGain",
    key: "inputGain",
    label: "Pre-FX Trim",
    max: 4.0,
    min: 0,
    step: 0.01,
    type: "slider",
  },
  {
    description:
      "Linear trim applied after the wrapper blend, independently of native output or makeup controls.",
    formatKey: "linearGain",
    key: "outputGain",
    label: "Post-FX Trim",
    max: 4.0,
    min: 0,
    step: 0.01,
    type: "slider",
  },
];

export const UNIVERSAL_EFFECT_PARAM_KEYS: ReadonlySet<string> = new Set([
  "enabled",
  ...UNIVERSAL_EFFECT_PARAM_DEFS.map((param) => param.key),
]);
