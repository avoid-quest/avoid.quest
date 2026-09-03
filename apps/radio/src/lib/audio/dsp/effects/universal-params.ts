import type { SliderParamDef, UniversalEffectParamKey } from "./param-types.js";

export const UNIVERSAL_EFFECT_PARAM_DEFS: readonly SliderParamDef<
  Exclude<UniversalEffectParamKey, "enabled">
>[] = [
  {
    type: "slider",
    key: "dryWet",
    label: "Effect Mix",
    formatKey: "percentage",
    min: 0,
    max: 1,
    step: 0.01,
    description:
      "Outer wrapper blend: 0% passes the original signal, 100% passes the complete device output.",
  },
  {
    type: "slider",
    key: "inputGain",
    label: "Pre-FX Trim",
    formatKey: "linearGain",
    min: 0,
    max: 4.0,
    step: 0.01,
    description:
      "Linear trim applied before the device, independently of native drive or detector-input controls.",
  },
  {
    type: "slider",
    key: "outputGain",
    label: "Post-FX Trim",
    formatKey: "linearGain",
    min: 0,
    max: 4.0,
    step: 0.01,
    description:
      "Linear trim applied after the wrapper blend, independently of native output or makeup controls.",
  },
];

export const UNIVERSAL_EFFECT_PARAM_KEYS: ReadonlySet<string> = new Set([
  "enabled",
  ...UNIVERSAL_EFFECT_PARAM_DEFS.map((param) => param.key),
]);
