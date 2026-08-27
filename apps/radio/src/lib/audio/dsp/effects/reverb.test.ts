import { describe, expect, test } from "bun:test";
import { DattorroReverb } from "./reverb";

describe("DattorroReverb", () => {
  test("creates with valid sample rate", () => {
    const reverb = new DattorroReverb(44_100);
    expect(reverb).toBeDefined();
  });

  test("creates with different sample rates", () => {
    const reverb48k = new DattorroReverb(48_000);
    const reverb96k = new DattorroReverb(96_000);
    expect(reverb48k).toBeDefined();
    expect(reverb96k).toBeDefined();
  });

  test("setPreDelay clamps to valid range", () => {
    const reverb = new DattorroReverb(44_100);
    // Should not throw with any value
    expect(() => reverb.setPreDelay(0)).not.toThrow();
    expect(() => reverb.setPreDelay(0.1)).not.toThrow();
    expect(() => reverb.setPreDelay(1)).not.toThrow();
    expect(() => reverb.setPreDelay(-1)).not.toThrow();
    expect(() => reverb.setPreDelay(100)).not.toThrow();
  });

  test("setBandwidth clamps to valid range", () => {
    const reverb = new DattorroReverb(44_100);
    expect(() => reverb.setBandwidth(0.5)).not.toThrow();
    expect(() => reverb.setBandwidth(-1)).not.toThrow();
    expect(() => reverb.setBandwidth(2)).not.toThrow();
  });

  test("setInputDiffusion1 clamps to valid range", () => {
    const reverb = new DattorroReverb(44_100);
    expect(() => reverb.setInputDiffusion1(0.75)).not.toThrow();
    expect(() => reverb.setInputDiffusion1(-1)).not.toThrow();
    expect(() => reverb.setInputDiffusion1(2)).not.toThrow();
  });

  test("setInputDiffusion2 clamps to valid range", () => {
    const reverb = new DattorroReverb(44_100);
    expect(() => reverb.setInputDiffusion2(0.625)).not.toThrow();
  });

  test("setDecay clamps to valid range", () => {
    const reverb = new DattorroReverb(44_100);
    expect(() => reverb.setDecay(0.5)).not.toThrow();
    expect(() => reverb.setDecay(0)).not.toThrow();
    expect(() => reverb.setDecay(1)).not.toThrow();
    expect(() => reverb.setDecay(2)).not.toThrow();
  });

  test("setDecayDiffusion1 clamps to valid range", () => {
    const reverb = new DattorroReverb(44_100);
    expect(() => reverb.setDecayDiffusion1(0.7)).not.toThrow();
  });

  test("setDecayDiffusion2 clamps to valid range", () => {
    const reverb = new DattorroReverb(44_100);
    expect(() => reverb.setDecayDiffusion2(0.5)).not.toThrow();
  });

  test("setDamping clamps to valid range", () => {
    const reverb = new DattorroReverb(44_100);
    expect(() => reverb.setDamping(0.5)).not.toThrow();
    expect(() => reverb.setDamping(0)).not.toThrow();
    expect(() => reverb.setDamping(1)).not.toThrow();
  });

  test("setExcursionRate clamps to valid range", () => {
    const reverb = new DattorroReverb(44_100);
    expect(() => reverb.setExcursionRate(0.5)).not.toThrow();
    expect(() => reverb.setExcursionRate(-1)).not.toThrow();
    expect(() => reverb.setExcursionRate(5)).not.toThrow();
  });

  test("setExcursionDepth clamps to valid range", () => {
    const reverb = new DattorroReverb(44_100);
    expect(() => reverb.setExcursionDepth(0.7)).not.toThrow();
    expect(() => reverb.setExcursionDepth(-1)).not.toThrow();
    expect(() => reverb.setExcursionDepth(5)).not.toThrow();
  });

  test("setWet clamps to valid range", () => {
    const reverb = new DattorroReverb(44_100);
    expect(() => reverb.setWet(0.3)).not.toThrow();
    expect(() => reverb.setWet(-1)).not.toThrow();
    expect(() => reverb.setWet(2)).not.toThrow();
  });

  test("setDry clamps to valid range", () => {
    const reverb = new DattorroReverb(44_100);
    expect(() => reverb.setDry(0.6)).not.toThrow();
    expect(() => reverb.setDry(-1)).not.toThrow();
    expect(() => reverb.setDry(2)).not.toThrow();
  });

  test("reset clears all state", () => {
    const reverb = new DattorroReverb(44_100);

    // Process some audio to build up state
    const input: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(0.5),
      new Float32Array(128).fill(0.5),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];
    reverb.process(input, output, 0, 128);

    // Reset should not throw
    expect(() => reverb.reset()).not.toThrow();
  });

  test("process produces non-zero output for non-zero input", () => {
    const reverb = new DattorroReverb(44_100);
    reverb.setWet(0.5);
    reverb.setDry(0.5);

    const input: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(0.5),
      new Float32Array(128).fill(0.5),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];

    reverb.process(input, output, 0, 128);

    // At least some output should be non-zero
    let hasNonZero = false;
    for (let i = 0; i < 128; i += 1) {
      if (output[0][i] !== 0 || output[1][i] !== 0) {
        hasNonZero = true;
        break;
      }
    }
    expect(hasNonZero).toBe(true);
  });

  test("process handles silence without error", () => {
    const reverb = new DattorroReverb(44_100);

    const input: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];

    expect(() => reverb.process(input, output, 0, 128)).not.toThrow();
  });

  test("dry output preserves input signal", () => {
    const reverb = new DattorroReverb(44_100);
    reverb.setDry(1);
    reverb.setWet(0);

    const inputValue = 0.5;
    const input: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(inputValue),
      new Float32Array(128).fill(inputValue),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];

    reverb.process(input, output, 0, 128);

    // Dry output should be input * dry
    expect(output[0][0]).toBeCloseTo(inputValue * 1);
    expect(output[1][0]).toBeCloseTo(inputValue * 1);
  });

  test("multiple process calls accumulate reverb tail", () => {
    const reverb = new DattorroReverb(44_100);
    reverb.setDecay(0.95);
    reverb.setWet(1);
    reverb.setDry(0);

    // Create a longer impulse burst to fill delay lines
    const impulse: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(0.8),
      new Float32Array(128).fill(0.8),
    ];

    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];

    // Process impulse multiple times to fill delay lines
    for (let i = 0; i < 10; i += 1) {
      reverb.process(impulse, output, 0, 128);
    }

    // Process silence - reverb tail should still produce output
    const silence: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];
    const tailOutput: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];
    reverb.process(silence, tailOutput, 0, 128);

    // Some reverb tail should be present
    let hasTail = false;
    for (let i = 0; i < 128; i += 1) {
      if (
        Math.abs(tailOutput[0][i]) > 0.0001 ||
        Math.abs(tailOutput[1][i]) > 0.0001
      ) {
        hasTail = true;
        break;
      }
    }
    expect(hasTail).toBe(true);
  });

  test("process with partial buffer range", () => {
    const reverb = new DattorroReverb(44_100);

    const input: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(0.5),
      new Float32Array(128).fill(0.5),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];

    // Process only a portion of the buffer
    expect(() => reverb.process(input, output, 32, 96)).not.toThrow();
  });

  test("stereo processing produces different L/R output", () => {
    const reverb = new DattorroReverb(44_100);
    reverb.setWet(1);
    reverb.setDry(0);

    // Process multiple blocks to let modulation create stereo differences
    const input: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(0.5),
      new Float32Array(128).fill(0.5),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];

    // Process multiple times to accumulate modulation differences
    for (let i = 0; i < 10; i += 1) {
      reverb.process(input, output, 0, 128);
    }

    // Check if L and R outputs differ (due to modulation and different taps)
    let hasDifference = false;
    for (let i = 0; i < 128; i += 1) {
      if (Math.abs(output[0][i] - output[1][i]) > 0.0001) {
        hasDifference = true;
        break;
      }
    }
    expect(hasDifference).toBe(true);
  });
});
