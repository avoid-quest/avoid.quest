import { describe, expect, test } from "bun:test";
import { Delay } from "./delay";

describe("Delay Effect", () => {
  const SAMPLE_RATE = 44_100;

  test("creates with default values", () => {
    const delay = new Delay(SAMPLE_RATE);
    // Should not throw
    expect(delay).toBeDefined();
  });

  test("setDelayTime clamps to minimum of 1 sample", () => {
    const delay = new Delay(SAMPLE_RATE);

    // Setting 0 seconds should clamp to at least 1 sample
    delay.setDelayTime(0);

    // Process and verify it doesn't crash
    const input: [Float32Array, Float32Array] = [
      new Float32Array([1, 2, 3]),
      new Float32Array([1, 2, 3]),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(3),
      new Float32Array(3),
    ];

    expect(() => delay.process(input, output, 0, 3)).not.toThrow();
  });

  test("setDelayTime clamps to maximum buffer size", () => {
    const delay = new Delay(SAMPLE_RATE);

    // Try to set delay longer than 2 second max
    delay.setDelayTime(10); // 10 seconds

    // Should still work (clamped to max)
    const input: [Float32Array, Float32Array] = [
      new Float32Array([1, 2, 3]),
      new Float32Array([1, 2, 3]),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(3),
      new Float32Array(3),
    ];

    expect(() => delay.process(input, output, 0, 3)).not.toThrow();
  });

  test("setFeedback clamps to 0.95 maximum", () => {
    const delay = new Delay(SAMPLE_RATE);

    // Set feedback higher than max
    delay.setFeedback(1.5);

    // Should be clamped - verify by processing
    // Excessive feedback would cause runaway gain, clamping prevents this
    const input: [Float32Array, Float32Array] = [
      new Float32Array(1000).fill(1),
      new Float32Array(1000).fill(1),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(1000),
      new Float32Array(1000),
    ];

    delay.setDelayTime(0.01); // 10ms delay
    delay.process(input, output, 0, 1000);

    // Output should not explode (no runaway gain)
    for (let i = 0; i < 1000; i++) {
      expect(Number.isFinite(output[0][i])).toBe(true);
      expect(Math.abs(output[0][i])).toBeLessThan(100); // Reasonable bound
    }
  });

  test("setFeedback clamps to 0 minimum", () => {
    const delay = new Delay(SAMPLE_RATE);

    // Set negative feedback
    delay.setFeedback(-0.5);

    // Should work without issues
    const input: [Float32Array, Float32Array] = [
      new Float32Array([1, 2, 3]),
      new Float32Array([1, 2, 3]),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(3),
      new Float32Array(3),
    ];

    expect(() => delay.process(input, output, 0, 3)).not.toThrow();
  });

  test("produces delayed output", () => {
    const delay = new Delay(SAMPLE_RATE);

    // Set a short delay (10ms = 441 samples at 44.1kHz)
    const delayTimeMs = 10;
    const delaySamples = Math.round((delayTimeMs / 1000) * SAMPLE_RATE);
    delay.setDelayTime(delayTimeMs / 1000);
    delay.setFeedback(0); // No feedback for simple test

    // Create input with impulse at start
    const blockSize = delaySamples + 100;
    const input: [Float32Array, Float32Array] = [
      new Float32Array(blockSize),
      new Float32Array(blockSize),
    ];
    input[0][0] = 1.0; // Impulse
    input[1][0] = 1.0;

    const output: [Float32Array, Float32Array] = [
      new Float32Array(blockSize),
      new Float32Array(blockSize),
    ];

    delay.process(input, output, 0, blockSize);

    // Output should be silent initially (before delay time)
    expect(output[0][0]).toBe(0);

    // Delayed impulse should appear after delaySamples
    // The delay reads from buffer, so the impulse appears at delaySamples
    expect(output[0][delaySamples]).toBe(1.0);
  });

  test("buffer wraparound works correctly", () => {
    const delay = new Delay(SAMPLE_RATE);

    // Use a delay time that will cause wraparound after several blocks
    delay.setDelayTime(0.5); // 500ms
    delay.setFeedback(0.5);

    // Process multiple blocks to exercise wraparound
    const blockSize = 128;
    const input: [Float32Array, Float32Array] = [
      new Float32Array(blockSize),
      new Float32Array(blockSize),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(blockSize),
      new Float32Array(blockSize),
    ];

    // Process many blocks (more than buffer length)
    for (let block = 0; block < 1000; block++) {
      input[0].fill(0.1);
      input[1].fill(0.1);

      expect(() => delay.process(input, output, 0, blockSize)).not.toThrow();

      // Output should be finite
      for (let i = 0; i < blockSize; i++) {
        expect(Number.isFinite(output[0][i])).toBe(true);
        expect(Number.isFinite(output[1][i])).toBe(true);
      }
    }
  });

  test("reset clears buffer", () => {
    const delay = new Delay(SAMPLE_RATE);
    delay.setDelayTime(0.01); // 10ms
    delay.setFeedback(0.5);

    // Fill buffer with signal
    const input: [Float32Array, Float32Array] = [
      new Float32Array(1000).fill(0.5),
      new Float32Array(1000).fill(0.5),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(1000),
      new Float32Array(1000),
    ];
    delay.process(input, output, 0, 1000);

    // Reset
    delay.reset();

    // Process silence - output should be silent (buffer cleared)
    const silentInput: [Float32Array, Float32Array] = [
      new Float32Array(1000).fill(0),
      new Float32Array(1000).fill(0),
    ];
    const silentOutput: [Float32Array, Float32Array] = [
      new Float32Array(1000),
      new Float32Array(1000),
    ];
    delay.process(silentInput, silentOutput, 0, 1000);

    // All output should be silent or near-silent
    for (let i = 0; i < 1000; i++) {
      expect(Math.abs(silentOutput[0][i])).toBeLessThan(0.001);
      expect(Math.abs(silentOutput[1][i])).toBeLessThan(0.001);
    }
  });

  test("handles stereo correctly", () => {
    const delay = new Delay(SAMPLE_RATE);
    delay.setDelayTime(0.01); // 10ms
    delay.setFeedback(0);

    // Different signals on L/R
    const delaySamples = Math.round(0.01 * SAMPLE_RATE);
    const blockSize = delaySamples + 10;
    const input: [Float32Array, Float32Array] = [
      new Float32Array(blockSize),
      new Float32Array(blockSize),
    ];
    input[0][0] = 1.0; // Left impulse
    input[1][0] = 0.5; // Right impulse (different amplitude)

    const output: [Float32Array, Float32Array] = [
      new Float32Array(blockSize),
      new Float32Array(blockSize),
    ];

    delay.process(input, output, 0, blockSize);

    // Delayed outputs should match their respective inputs
    expect(output[0][delaySamples]).toBeCloseTo(1.0);
    expect(output[1][delaySamples]).toBeCloseTo(0.5);
  });

  test("process handles fromIndex and toIndex", () => {
    const delay = new Delay(SAMPLE_RATE);
    delay.setDelayTime(0.001); // 1ms (very short)

    const input: [Float32Array, Float32Array] = [
      new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]),
      new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(5),
      new Float32Array(5),
    ];

    // Process only middle indices
    delay.process(input, output, 1, 4);

    // Index 0 should be untouched (0)
    expect(output[0][0]).toBe(0);
    // Index 4 should be untouched (0)
    expect(output[0][4]).toBe(0);
  });

  test("feedback creates repeating echoes", () => {
    const delay = new Delay(SAMPLE_RATE);
    delay.setDelayTime(0.01); // 10ms
    delay.setFeedback(0.5); // 50% feedback

    const delaySamples = Math.round(0.01 * SAMPLE_RATE);
    const blockSize = delaySamples * 5; // Enough for multiple echoes

    // Single impulse input
    const input: [Float32Array, Float32Array] = [
      new Float32Array(blockSize),
      new Float32Array(blockSize),
    ];
    input[0][0] = 1.0;
    input[1][0] = 1.0;

    const output: [Float32Array, Float32Array] = [
      new Float32Array(blockSize),
      new Float32Array(blockSize),
    ];

    delay.process(input, output, 0, blockSize);

    // First echo
    expect(output[0][delaySamples]).toBeCloseTo(1.0);
    // Second echo is reduced by feedback and the feedback-path low-pass filter.
    const secondEcho = output[0][delaySamples * 2] ?? 0;
    expect(secondEcho).toBeGreaterThan(0.35);
    expect(secondEcho).toBeLessThan(0.5);
    // Third echo (further reduced)
    const thirdEcho = output[0][delaySamples * 3] ?? 0;
    expect(thirdEcho).toBeGreaterThan(0.1);
    expect(thirdEcho).toBeLessThan(secondEcho);
  });

  test("produces no NaN or Infinity", () => {
    const delay = new Delay(SAMPLE_RATE);
    delay.setDelayTime(0.1);
    delay.setFeedback(0.9); // High feedback

    const input: [Float32Array, Float32Array] = [
      new Float32Array(10_000).fill(0.5),
      new Float32Array(10_000).fill(0.5),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(10_000),
      new Float32Array(10_000),
    ];

    delay.process(input, output, 0, 10_000);

    for (let i = 0; i < 10_000; i++) {
      expect(Number.isFinite(output[0][i])).toBe(true);
      expect(Number.isFinite(output[1][i])).toBe(true);
    }
  });

  test("handles different sample rates", () => {
    const delay48k = new Delay(48_000);
    const delay96k = new Delay(96_000);

    // Both should work correctly
    delay48k.setDelayTime(0.1);
    delay96k.setDelayTime(0.1);

    const input: [Float32Array, Float32Array] = [
      new Float32Array(1000).fill(0.5),
      new Float32Array(1000).fill(0.5),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(1000),
      new Float32Array(1000),
    ];

    expect(() => delay48k.process(input, output, 0, 1000)).not.toThrow();
    expect(() => delay96k.process(input, output, 0, 1000)).not.toThrow();
  });
});
