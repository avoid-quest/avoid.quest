import { describe, expect, test } from "bun:test";
import type { EffectConfig, EffectProcessor } from "../effects/types";
import { EffectChain } from "./effect-chain";

/**
 * Mock effect processor for testing
 * Multiplies input by a gain factor
 */
class MockGainProcessor implements EffectProcessor {
  private readonly gain: number;

  constructor(gain: number) {
    this.gain = gain;
  }

  process(
    input: [Float32Array, Float32Array],
    output: [Float32Array, Float32Array],
    fromIndex: number,
    toIndex: number
  ): void {
    for (let i = fromIndex; i < toIndex; i += 1) {
      output[0][i] = (input[0][i] ?? 0) * this.gain;
      output[1][i] = (input[1][i] ?? 0) * this.gain;
    }
  }

  reset(): void {
    // No state to reset
  }
}

/**
 * Create a mock effect config
 */
function createMockConfig(
  id: string,
  order: number,
  enabled = true
): EffectConfig {
  return {
    delayTime: 0.5,
    dryWet: 1,
    enabled,
    feedback: 0.3,
    id,
    inputGain: 1,
    order,
    outputGain: 1,
    type: "delay",
  } as EffectConfig;
}

describe("EffectChain", () => {
  test("creates with configuration", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });
    expect(chain).toBeDefined();
    expect(chain.getSampleRate()).toBe(44_100);
  });

  test("creates with custom block size", () => {
    const chain = new EffectChain({ blockSize: 256, sampleRate: 44_100 });
    expect(chain).toBeDefined();
  });

  test("addEffect adds effect to chain", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });
    const processor = new MockGainProcessor(2);
    const config = createMockConfig("effect1", 0);

    chain.addEffect("effect1", "delay", processor, config);

    const effect = chain.getEffect("effect1");
    expect(effect).toBeDefined();
    expect(effect?.id).toBe("effect1");
    expect(effect?.type).toBe("delay");
  });

  test("removeEffect removes effect from chain", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });
    const processor = new MockGainProcessor(2);
    const config = createMockConfig("effect1", 0);

    chain.addEffect("effect1", "delay", processor, config);
    expect(chain.getEffect("effect1")).toBeDefined();

    const removed = chain.removeEffect("effect1");
    expect(removed).toBe(true);
    expect(chain.getEffect("effect1")).toBeUndefined();
  });

  test("removeEffect returns false for non-existent effect", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });
    const removed = chain.removeEffect("nonexistent");
    expect(removed).toBe(false);
  });

  test("updateEffect updates configuration", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });
    const processor = new MockGainProcessor(2);
    const config = createMockConfig("effect1", 0);

    chain.addEffect("effect1", "delay", processor, config);
    const updated = chain.updateEffect("effect1", { dryWet: 0.5 });

    expect(updated).toBe(true);
    expect(chain.getEffect("effect1")?.config.dryWet).toBe(0.5);
  });

  test("updateEffect returns false for non-existent effect", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });
    const updated = chain.updateEffect("nonexistent", { dryWet: 0.5 });
    expect(updated).toBe(false);
  });

  test("setEnabled enables and disables effect", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });
    const processor = new MockGainProcessor(2);
    const config = createMockConfig("effect1", 0);

    chain.addEffect("effect1", "delay", processor, config);

    chain.setEnabled("effect1", false);
    expect(chain.getEffect("effect1")?.enabled).toBe(false);

    chain.setEnabled("effect1", true);
    expect(chain.getEffect("effect1")?.enabled).toBe(true);
  });

  test("setEnabled returns false for non-existent effect", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });
    const result = chain.setEnabled("nonexistent", true);
    expect(result).toBe(false);
  });

  test("getEffectsInOrder returns effects in correct order", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });

    chain.addEffect(
      "c",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("c", 2)
    );
    chain.addEffect(
      "a",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("a", 0)
    );
    chain.addEffect(
      "b",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("b", 1)
    );

    const ordered = chain.getEffectsInOrder();
    expect(ordered.length).toBe(3);
    expect(ordered[0]?.id).toBe("a");
    expect(ordered[1]?.id).toBe("b");
    expect(ordered[2]?.id).toBe("c");
  });

  test("getOrder returns ID list in order", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });

    chain.addEffect(
      "c",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("c", 2)
    );
    chain.addEffect(
      "a",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("a", 0)
    );
    chain.addEffect(
      "b",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("b", 1)
    );

    const order = chain.getOrder();
    expect(order).toEqual(["a", "b", "c"]);
  });

  test("reorderEffects reorders effects", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });

    chain.addEffect(
      "a",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("a", 0)
    );
    chain.addEffect(
      "b",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("b", 1)
    );
    chain.addEffect(
      "c",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("c", 2)
    );

    chain.reorderEffects(["c", "a", "b"]);

    const order = chain.getOrder();
    expect(order).toEqual(["c", "a", "b"]);
  });

  test("reorderEffects ignores non-existent IDs", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });

    chain.addEffect(
      "a",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("a", 0)
    );
    chain.addEffect(
      "b",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("b", 1)
    );

    // Include non-existent ID - should be filtered out
    chain.reorderEffects(["b", "nonexistent", "a"]);

    const order = chain.getOrder();
    expect(order).toEqual(["b", "a"]);
  });

  test("process passes through when no effects", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });

    const inputValue = 0.5;
    const inputL = new Float32Array(128).fill(inputValue);
    const inputR = new Float32Array(128).fill(inputValue);
    const outputL = new Float32Array(128);
    const outputR = new Float32Array(128);

    chain.process(inputL, inputR, outputL, outputR, 0, 128);

    expect(outputL[0]).toBe(inputValue);
    expect(outputR[0]).toBe(inputValue);
  });

  test("process applies single effect", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });
    const gain = 2;
    chain.addEffect(
      "gain",
      "delay",
      new MockGainProcessor(gain),
      createMockConfig("gain", 0)
    );

    const inputValue = 0.3;
    const inputL = new Float32Array(128).fill(inputValue);
    const inputR = new Float32Array(128).fill(inputValue);
    const outputL = new Float32Array(128);
    const outputR = new Float32Array(128);

    chain.process(inputL, inputR, outputL, outputR, 0, 128);

    expect(outputL[0]).toBeCloseTo(inputValue * gain);
    expect(outputR[0]).toBeCloseTo(inputValue * gain);
  });

  test("process applies multiple effects in order", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });

    // First effect: multiply by 2
    chain.addEffect(
      "double",
      "delay",
      new MockGainProcessor(2),
      createMockConfig("double", 0)
    );
    // Second effect: multiply by 3
    chain.addEffect(
      "triple",
      "delay",
      new MockGainProcessor(3),
      createMockConfig("triple", 1)
    );

    const inputValue = 0.1;
    const inputL = new Float32Array(128).fill(inputValue);
    const inputR = new Float32Array(128).fill(inputValue);
    const outputL = new Float32Array(128);
    const outputR = new Float32Array(128);

    chain.process(inputL, inputR, outputL, outputR, 0, 128);

    // 0.1 * 2 * 3 = 0.6
    expect(outputL[0]).toBeCloseTo(inputValue * 2 * 3);
  });

  test("process skips disabled effects", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });

    chain.addEffect(
      "enabled",
      "delay",
      new MockGainProcessor(2),
      createMockConfig("enabled", 0, true)
    );
    chain.addEffect(
      "disabled",
      "delay",
      new MockGainProcessor(10),
      createMockConfig("disabled", 1, false)
    );

    const inputValue = 0.3;
    const inputL = new Float32Array(128).fill(inputValue);
    const inputR = new Float32Array(128).fill(inputValue);
    const outputL = new Float32Array(128);
    const outputR = new Float32Array(128);

    chain.process(inputL, inputR, outputL, outputR, 0, 128);

    // Only first effect (x2) should apply, not the disabled one (x10)
    expect(outputL[0]).toBeCloseTo(inputValue * 2);
  });

  test("process applies dry/wet mix", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });

    const config = createMockConfig("effect", 0);
    config.dryWet = 0.5; // 50% wet, 50% dry
    chain.addEffect("effect", "delay", new MockGainProcessor(2), config);

    const inputValue = 0.4;
    const inputL = new Float32Array(128).fill(inputValue);
    const inputR = new Float32Array(128).fill(inputValue);
    const outputL = new Float32Array(128);
    const outputR = new Float32Array(128);

    chain.process(inputL, inputR, outputL, outputR, 0, 128);

    // 50% dry (0.4) + 50% wet (0.4 * 2 = 0.8) = 0.4 * 0.5 + 0.8 * 0.5 = 0.6
    expect(outputL[0]).toBeCloseTo(inputValue * 0.5 + inputValue * 2 * 0.5);
  });

  test("process applies input gain", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });

    const config = createMockConfig("effect", 0);
    config.inputGain = 2;
    chain.addEffect("effect", "delay", new MockGainProcessor(1), config);

    const inputValue = 0.2;
    const inputL = new Float32Array(128).fill(inputValue);
    const inputR = new Float32Array(128).fill(inputValue);
    const outputL = new Float32Array(128);
    const outputR = new Float32Array(128);

    chain.process(inputL, inputR, outputL, outputR, 0, 128);

    expect(outputL[0]).toBeCloseTo(inputValue * 2);
  });

  test("process applies output gain", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });

    const config = createMockConfig("effect", 0);
    config.outputGain = 0.5;
    chain.addEffect("effect", "delay", new MockGainProcessor(1), config);

    const inputValue = 0.4;
    const inputL = new Float32Array(128).fill(inputValue);
    const inputR = new Float32Array(128).fill(inputValue);
    const outputL = new Float32Array(128);
    const outputR = new Float32Array(128);

    chain.process(inputL, inputR, outputL, outputR, 0, 128);

    expect(outputL[0]).toBeCloseTo(inputValue * 0.5);
  });

  test("reset resets all effects", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });

    chain.addEffect(
      "a",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("a", 0)
    );
    chain.addEffect(
      "b",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("b", 1)
    );

    expect(() => chain.reset()).not.toThrow();
  });

  test("clear removes all effects", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });

    chain.addEffect(
      "a",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("a", 0)
    );
    chain.addEffect(
      "b",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("b", 1)
    );

    chain.clear();

    expect(chain.getOrder()).toEqual([]);
    expect(chain.getEffect("a")).toBeUndefined();
    expect(chain.getEffect("b")).toBeUndefined();
  });

  test("updateEffect re-orders when order changes", () => {
    const chain = new EffectChain({ sampleRate: 44_100 });

    chain.addEffect(
      "a",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("a", 0)
    );
    chain.addEffect(
      "b",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("b", 1)
    );
    chain.addEffect(
      "c",
      "delay",
      new MockGainProcessor(1),
      createMockConfig("c", 2)
    );

    // Move "a" to the end
    chain.updateEffect("a", { order: 3 });

    const order = chain.getOrder();
    expect(order).toEqual(["b", "c", "a"]);
  });
});
