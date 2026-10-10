import { Curve, clampUnit, linear, ValueMapping } from "@opendaw/lib-std";
import type { ModulationPoint } from "./modulation-schema";

export function createCurve(points: readonly ModulationPoint[]) {
  const segments = points.slice(1).map((right, index) => {
    const left = points[index] as ModulationPoint;
    return {
      slope: linear(1, 0, ValueMapping.bipolar().x(left.bend)),
      steps: right.time - left.time,
      y0: left.value,
      y1: right.value,
    };
  });
  const [first] = points;
  const last = points.at(-1);
  return (position: number): number => {
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
        const segment = segments[index - 1] as Parameters<
          typeof Curve.valueAt
        >[0];
        return Curve.valueAt(
          segment,
          clampUnit((position - left.time) / segment.steps) * segment.steps
        );
      }
    }
    return last.value;
  };
}

export function curveAt(
  points: readonly ModulationPoint[],
  position: number
): number {
  return createCurve(points)(position);
}
