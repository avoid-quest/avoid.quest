import { describe, expect, test } from "bun:test";
import { calculateDjCrossfadeVolumes } from "./dj-crossfade";

describe("DJ equal-power crossfade", () => {
  test.each([
    [0, 0.8, 0.6, 0.8, 0],
    [0.5, 0.8, 0.6, 0.8 * Math.SQRT1_2, 0.6 * Math.SQRT1_2],
    [1, 0.8, 0.6, 0, 0.6],
  ])(
    "calculates deck gains at position %p",
    (position, leftVolume, rightVolume, expectedLeft, expectedRight) => {
      const [left, right] = calculateDjCrossfadeVolumes(
        position,
        leftVolume,
        rightVolume
      );

      expect(left).toBeCloseTo(expectedLeft);
      expect(right).toBeCloseTo(expectedRight);
    }
  );
});
