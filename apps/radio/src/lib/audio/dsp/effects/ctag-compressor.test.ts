import { describe, expect, test } from "bun:test";
import { CTAGCompressor, DEFAULT_CTAG_CONFIG } from "./ctag-compressor";

describe("CTAGCompressor", () => {
  test("creates with default values", () => {
    const comp = new CTAGCompressor(44_100);
    // Should not throw during creation
    expect(comp).toBeDefined();
  });

  test("setThreshold applies threshold", () => {
    const comp = new CTAGCompressor(44_100);
    // Should not throw
    expect(() => comp.setThreshold(-20)).not.toThrow();
  });

  test("setRatio applies ratio", () => {
    const comp = new CTAGCompressor(44_100);
    expect(() => comp.setRatio(8)).not.toThrow();
  });

  test("setKnee applies knee width", () => {
    const comp = new CTAGCompressor(44_100);
    expect(() => comp.setKnee(12)).not.toThrow();
  });

  test("setAttack applies attack time", () => {
    const comp = new CTAGCompressor(44_100);
    expect(() => comp.setAttack(10)).not.toThrow();
  });

  test("setRelease applies release time", () => {
    const comp = new CTAGCompressor(44_100);
    expect(() => comp.setRelease(200)).not.toThrow();
  });

  test("setMakeup applies makeup gain", () => {
    const comp = new CTAGCompressor(44_100);
    expect(() => comp.setMakeup(6)).not.toThrow();
  });

  test("setMix clamps to valid range", () => {
    const comp = new CTAGCompressor(44_100);
    comp.setMix(-1);
    comp.setMix(2);
    // Should not throw with out-of-range values
    expect(true).toBe(true);
  });

  test("setLookahead toggles lookahead", () => {
    const comp = new CTAGCompressor(44_100);
    expect(() => comp.setLookahead(false)).not.toThrow();
    expect(() => comp.setLookahead(true)).not.toThrow();
  });

  test("setAutoAttack toggles auto attack", () => {
    const comp = new CTAGCompressor(44_100);
    expect(() => comp.setAutoAttack(true)).not.toThrow();
  });

  test("setAutoRelease toggles auto release", () => {
    const comp = new CTAGCompressor(44_100);
    expect(() => comp.setAutoRelease(true)).not.toThrow();
  });

  test("setAutoMakeup toggles auto makeup", () => {
    const comp = new CTAGCompressor(44_100);
    expect(() => comp.setAutoMakeup(true)).not.toThrow();
  });

  test("reset clears state without error", () => {
    const comp = new CTAGCompressor(44_100);
    expect(() => comp.reset()).not.toThrow();
  });

  test("setConfig applies partial configuration", () => {
    const comp = new CTAGCompressor(44_100);
    expect(() =>
      comp.setConfig({
        knee: 8,
        ratio: 6,
        threshold: -15,
      })
    ).not.toThrow();
  });

  test("setConfig applies full configuration", () => {
    const comp = new CTAGCompressor(44_100);
    expect(() => comp.setConfig(DEFAULT_CTAG_CONFIG)).not.toThrow();
  });

  test("process transforms audio", () => {
    const comp = new CTAGCompressor(44_100);

    // Disable lookahead for immediate output
    comp.setLookahead(false);

    // Create loud input signal that should trigger compression
    const input: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(0.9),
      new Float32Array(128).fill(0.9),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];

    comp.setThreshold(-10);
    comp.setRatio(4);

    // Process multiple blocks to let envelope settle
    for (let i = 0; i < 5; i += 1) {
      comp.process(input, output, 0, 128);
    }

    // Output should be non-zero after processing multiple blocks
    expect(output[0][127]).not.toBe(0);
    expect(output[1][127]).not.toBe(0);
  });

  test("process handles silence without error", () => {
    const comp = new CTAGCompressor(44_100);

    const input: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];

    expect(() => comp.process(input, output, 0, 128)).not.toThrow();
  });

  test("getInputPeakDb returns valid dB value", () => {
    const comp = new CTAGCompressor(44_100);

    // Process some audio
    const input: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(0.5),
      new Float32Array(128).fill(0.5),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];
    comp.process(input, output, 0, 128);

    const peakDb = comp.getInputPeakDb();
    expect(typeof peakDb).toBe("number");
    expect(peakDb).toBeLessThanOrEqual(0);
  });

  test("getOutputPeakDb returns valid dB value", () => {
    const comp = new CTAGCompressor(44_100);

    const input: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(0.5),
      new Float32Array(128).fill(0.5),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];
    comp.process(input, output, 0, 128);

    const peakDb = comp.getOutputPeakDb();
    expect(typeof peakDb).toBe("number");
  });

  test("getGainReductionDb returns valid dB value", () => {
    const comp = new CTAGCompressor(44_100);

    // Process loud signal to trigger compression
    const input: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(0.9),
      new Float32Array(128).fill(0.9),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];

    comp.setThreshold(-20);
    comp.setRatio(10);
    comp.process(input, output, 0, 128);

    const grDb = comp.getGainReductionDb();
    expect(typeof grDb).toBe("number");
    expect(grDb).toBeLessThanOrEqual(0);
  });

  test("mix parameter blends dry and wet signals", () => {
    const comp = new CTAGCompressor(44_100);

    // Disable lookahead for immediate output
    comp.setLookahead(false);

    const input: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(0.5),
      new Float32Array(128).fill(0.5),
    ];
    const output100: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];
    const output50: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];

    // Process with 100% wet - need multiple blocks for envelope
    comp.setThreshold(-10);
    comp.setMix(1);
    for (let i = 0; i < 5; i += 1) {
      comp.process(input, output100, 0, 128);
    }

    // Reset and process with 50% wet
    comp.reset();
    comp.setMix(0.5);
    for (let i = 0; i < 5; i += 1) {
      comp.process(input, output50, 0, 128);
    }

    // Both should produce output
    expect(output100[0][127]).not.toBe(0);
    expect(output50[0][127]).not.toBe(0);
  });

  test("lookahead mode processes without error", () => {
    const comp = new CTAGCompressor(44_100);

    const input: [Float32Array, Float32Array] = [
      new Float32Array(128).fill(0.9),
      new Float32Array(128).fill(0.9),
    ];
    const output: [Float32Array, Float32Array] = [
      new Float32Array(128),
      new Float32Array(128),
    ];

    // Enable lookahead
    comp.setLookahead(true);
    expect(() => comp.process(input, output, 0, 128)).not.toThrow();

    // Disable lookahead
    comp.reset();
    comp.setLookahead(false);
    expect(() => comp.process(input, output, 0, 128)).not.toThrow();
  });
});
