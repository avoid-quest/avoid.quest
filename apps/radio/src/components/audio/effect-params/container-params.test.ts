import { describe, expect, test } from "bun:test";
import { resizeFrequencyCrossovers } from "./container-params";

describe("Frequency Split band resizing", () => {
  test("preserves applicable crossovers when reducing the band count", () => {
    expect(resizeFrequencyCrossovers([300, 2000, 8000], 3)).toEqual([
      300, 2000,
    ]);
    expect(resizeFrequencyCrossovers([300, 2000], 2)).toEqual([300]);
  });

  test("initializes only newly required crossovers when adding bands", () => {
    expect(resizeFrequencyCrossovers([300], 4)).toEqual([300, 1000, 5000]);
  });

  test("keeps expanded crossovers ordered inside the supported range", () => {
    expect(resizeFrequencyCrossovers([19_990], 4)).toEqual([
      19_960, 19_980, 20_000,
    ]);
    expect(resizeFrequencyCrossovers([Number.NaN], 3)).toEqual([20, 1000]);
  });
});
