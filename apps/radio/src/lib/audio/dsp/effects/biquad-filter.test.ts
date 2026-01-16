import { describe, expect, test } from "bun:test";
import { BiquadFilter } from "./biquad-filter";

describe("BiquadFilter", () => {
  test("creates with default values", () => {
    const filter = new BiquadFilter(44_100);
    expect(filter.type).toBe("lowpass");
    expect(filter.frequency).toBe(350);
    expect(filter.Q).toBe(1);
    expect(filter.gain).toBe(0);
  });

  test("sets and gets type", () => {
    const filter = new BiquadFilter(44_100);
    filter.type = "highpass";
    expect(filter.type).toBe("highpass");

    filter.type = "bandpass";
    expect(filter.type).toBe("bandpass");
  });

  test("sets and gets frequency", () => {
    const filter = new BiquadFilter(44_100);
    filter.frequency = 1000;
    expect(filter.frequency).toBe(1000);
  });

  test("clamps frequency to valid range", () => {
    const filter = new BiquadFilter(44_100);
    filter.frequency = 5;
    expect(filter.frequency).toBe(10); // Min is 10

    filter.frequency = 100_000;
    expect(filter.frequency).toBeLessThan(44_100 / 2); // Max is Nyquist - 1
  });

  test("sets and gets Q", () => {
    const filter = new BiquadFilter(44_100);
    filter.Q = 2.5;
    expect(filter.Q).toBe(2.5);
  });

  test("clamps Q to minimum", () => {
    const filter = new BiquadFilter(44_100);
    filter.Q = -1;
    expect(filter.Q).toBeGreaterThan(0);
  });

  test("sets and gets gain", () => {
    const filter = new BiquadFilter(44_100);
    filter.gain = 6;
    expect(filter.gain).toBe(6);

    filter.gain = -12;
    expect(filter.gain).toBe(-12);
  });

  test("reset clears filter state", () => {
    const filter = new BiquadFilter(44_100);
    // Process some data to create state
    const input: [Float32Array, Float32Array] = [
      new Float32Array([1, 0.5, 0.25]),
      new Float32Array([1, 0.5, 0.25]),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(3),
      new Float32Array(3),
    ];
    filter.process(input, output, 0, 3);

    // Reset and verify no error
    expect(() => filter.reset()).not.toThrow();
  });

  test("process transforms audio", () => {
    const filter = new BiquadFilter(44_100);
    filter.type = "lowpass";
    filter.frequency = 1000;

    const input: [Float32Array, Float32Array] = [
      new Float32Array([1, 0, -1, 0, 1]),
      new Float32Array([1, 0, -1, 0, 1]),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(5),
      new Float32Array(5),
    ];

    filter.process(input, output, 0, 5);

    // Output should be different from input due to filtering
    expect(output[0][0]).not.toBe(0);
    expect(output[1][0]).not.toBe(0);
  });

  test("all filter types are valid", () => {
    const filter = new BiquadFilter(44_100);
    const types = [
      "lowpass",
      "highpass",
      "bandpass",
      "lowshelf",
      "highshelf",
      "peaking",
      "notch",
      "allpass",
    ] as const;

    for (const type of types) {
      filter.type = type;
      expect(filter.type).toBe(type);
    }
  });
});
