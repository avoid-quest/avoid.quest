import type { ModulationPoint } from "./modulation-schema";

export function curveAt(
  points: readonly ModulationPoint[],
  position: number
): number {
  const [first] = points;
  const last = points.at(-1);
  if (!(first && last)) {
    return 0;
  }
  if (position <= first.time) {
    return first.value;
  }
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    if (left && right && position <= right.time) {
      const progress = Math.max(
        0,
        Math.min(1, (position - left.time) / (right.time - left.time))
      );
      const shaped = Curve.normalizedAt(progress, (1 - left.bend) * 0.5);
      return left.value + (right.value - left.value) * shaped;
    }
  }
  return last.value;
}

import { Curve } from "@opendaw/lib-std";
