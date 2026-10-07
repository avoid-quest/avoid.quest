import { ValueMapping } from "@opendaw/lib-std";
import type { SliderParamDef } from "./param-types.js";

/** How a knob spreads its range over its travel. */
export type ParamScale = "linear" | "log";

/**
 * Hearing is logarithmic: a linear 20 Hz..20 kHz sweep packs the bass into
 * a few pixels, so a frequency knob spreads its travel by ratio.
 */
export function sliderScale(
  param: Pick<SliderParamDef, "formatKey" | "min">
): ParamScale {
  return param.formatKey === "frequency" && param.min > 0 ? "log" : "linear";
}

/** A knob's 0..1 travel onto its range, spread the way the knob spreads it. */
export function scaleMapping(
  min: number,
  max: number,
  scale: ParamScale = "linear"
): ValueMapping<number> {
  return scale === "log"
    ? ValueMapping.exponential(min, max)
    : ValueMapping.linear(min, max);
}
