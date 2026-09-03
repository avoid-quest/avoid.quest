import { describe, expect, test } from "bun:test";
import { Limiter } from "./limiter";

describe("Limiter Effect", () => {
  const SAMPLE_RATE = 44_100;

  test("creates with default threshold of 0dB (1.0 linear)", () => {
    const limiter = new Limiter(SAMPLE_RATE);
    // No gain reduction when signal is below threshold
    expect(limiter.getGainReductionDb()).toBe(0);
  });

  test("setThreshold converts dB to linear correctly", () => {
    const limiter = new Limiter(SAMPLE_RATE);

    // At -6dB threshold, linear should be ~0.5
    limiter.setThreshold(-6);
    // Feed a signal at 1.0 (0dB) which exceeds -6dB threshold
    // Use enough samples for envelope to respond
    const blockSize = 128;
    const input: [Float32Array, Float32Array] = [
      new Float32Array(blockSize).fill(1.0),
      new Float32Array(blockSize).fill(1.0),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(blockSize),
      new Float32Array(blockSize),
    ];
    limiter.process(input, output, 0, blockSize);

    // Should have gain reduction since signal exceeds threshold
    expect(limiter.getGainReductionDb()).toBeLessThan(0);
  });

  test("passes through signal below threshold unchanged", () => {
    const limiter = new Limiter(SAMPLE_RATE);
    limiter.setThreshold(0); // 0dB = 1.0 linear

    // Signal at 0.5 (-6dB) is below 0dB threshold
    const input: [Float32Array, Float32Array] = [
      new Float32Array([0.5]),
      new Float32Array([0.5]),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(1),
      new Float32Array(1),
    ];

    limiter.process(input, output, 0, 1);

    // Output should equal input (no limiting)
    expect(output[0][0]).toBe(0.5);
    expect(output[1][0]).toBe(0.5);
    expect(limiter.getGainReductionDb()).toBe(0);
  });

  test("reduces gain when signal exceeds threshold", () => {
    const limiter = new Limiter(SAMPLE_RATE);
    limiter.setThreshold(-6); // ~0.5 linear

    // Create a longer signal to allow envelope to respond
    const blockSize = 128;
    const input: [Float32Array, Float32Array] = [
      new Float32Array(blockSize).fill(1.0), // 0dB signal
      new Float32Array(blockSize).fill(1.0),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(blockSize),
      new Float32Array(blockSize),
    ];

    limiter.process(input, output, 0, blockSize);

    // Output should be reduced (limiting active)
    // After attack time, output should approach threshold
    const lastSample = output[0][blockSize - 1];
    expect(lastSample).toBeLessThan(1.0);
    expect(lastSample).toBeGreaterThan(0);

    // Gain reduction should be negative (in dB)
    expect(limiter.getGainReductionDb()).toBeLessThan(0);
  });

  test("getGainReductionDb returns 0 when below threshold", () => {
    const limiter = new Limiter(SAMPLE_RATE);
    limiter.setThreshold(0); // 0dB = 1.0 linear

    const input: [Float32Array, Float32Array] = [
      new Float32Array([0.1, 0.2, 0.3]),
      new Float32Array([0.1, 0.2, 0.3]),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(3),
      new Float32Array(3),
    ];

    limiter.process(input, output, 0, 3);

    expect(limiter.getGainReductionDb()).toBe(0);
  });

  test("reset clears envelope state", () => {
    const limiter = new Limiter(SAMPLE_RATE);
    limiter.setThreshold(-12);

    // Process loud signal to build up envelope
    const input: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(1.0),
      new Float32Array(128).fill(1.0),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];
    limiter.process(input, output, 0, 128);

    // Envelope should be non-zero
    expect(limiter.getEnvelope()).toBeGreaterThan(0);

    // Reset should clear it
    limiter.reset();
    expect(limiter.getEnvelope()).toBe(0);
  });

  test("getEnvelope returns current envelope value", () => {
    const limiter = new Limiter(SAMPLE_RATE);
    expect(limiter.getEnvelope()).toBe(0);

    // Process signal to update envelope
    const input: [Float32Array, Float32Array] = [
      new Float32Array([0.8, 0.9, 1.0]),
      new Float32Array([0.8, 0.9, 1.0]),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(3),
      new Float32Array(3),
    ];
    limiter.process(input, output, 0, 3);

    // Envelope should have tracked the peak
    expect(limiter.getEnvelope()).toBeGreaterThan(0);
  });

  test("handles stereo signals correctly", () => {
    const limiter = new Limiter(SAMPLE_RATE);
    limiter.setThreshold(-6);

    // Left channel loud, right channel quiet
    const input: [Float32Array, Float32Array] = [
      new Float32Array(64).fill(1.0), // Loud
      new Float32Array(64).fill(0.1), // Quiet
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(64),
      new Float32Array(64),
    ];

    limiter.process(input, output, 0, 64);

    // Both channels should be affected by the louder channel
    // (limiter uses max of both channels for detection)
    const [outputL, outputR] = output;
    const lastL = outputL.at(-1);
    const lastR = outputR.at(-1);

    expect(lastL).toBeLessThan(1.0); // Limited
    expect(lastR).toBeLessThan(0.1); // Also reduced due to shared gain
  });

  test("processes with fromIndex and toIndex", () => {
    const limiter = new Limiter(SAMPLE_RATE);

    const input: [Float32Array, Float32Array] = [
      new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]),
      new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(5),
      new Float32Array(5),
    ];

    // Process only middle samples (index 1 to 4)
    limiter.process(input, output, 1, 4);

    // Index 0 should be untouched (0)
    expect(output[0][0]).toBe(0);
    // Index 1-3 should be processed
    expect(output[0][1]).toBeCloseTo(0.2);
    expect(output[0][2]).toBeCloseTo(0.3);
    expect(output[0][3]).toBeCloseTo(0.4);
    // Index 4 should be untouched
    expect(output[0][4]).toBe(0);
  });

  test("handles different sample rates", () => {
    const limiter48k = new Limiter(48_000);
    const limiter96k = new Limiter(96_000);

    // Both should create without error and have different envelope coefficients
    // We can't directly test the coefficients, but we can verify they work
    expect(limiter48k.getEnvelope()).toBe(0);
    expect(limiter96k.getEnvelope()).toBe(0);
  });

  test("produces no NaN or Infinity in output", () => {
    const limiter = new Limiter(SAMPLE_RATE);
    limiter.setThreshold(-20);

    const input: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(2.0), // Clipping level signal
      new Float32Array(128).fill(2.0),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];

    limiter.process(input, output, 0, 128);

    for (let i = 0; i < 128; i += 1) {
      expect(Number.isFinite(output[0][i])).toBe(true);
      expect(Number.isFinite(output[1][i])).toBe(true);
    }
  });
});
