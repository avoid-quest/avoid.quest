import { describe, expect, test } from "bun:test";
import { MAX_EFFECT_TREE_DEPTH } from "../routing/effect-tree";
import {
  effectConfigSchema,
  MAX_CHAIN_GAIN,
  nodeEffectConfigSchema,
} from "./effect-config-schema";
import { createDefaultEffectConfig } from "./registry";
import {
  EFFECT_TYPES,
  type EffectConfig,
  type FxCompositeConfig,
} from "./types";

const SCHEMAS = { node: nodeEffectConfigSchema, stored: effectConfigSchema };

/** `levels` Splits inside each other, each holding the next in its chain. */
function nestedSplits(levels: number): unknown {
  let inner: unknown = createDefaultEffectConfig("compressor", "leaf", 0);
  for (let level = levels; level > 0; level -= 1) {
    const outer = createDefaultEffectConfig("fxComposite", `split-${level}`, 0);
    inner = {
      ...outer,
      chains: [
        {
          ...outer.chains[0],
          effects: [inner],
          id: `chain-${level}`,
        },
      ],
    };
  }
  return inner;
}

function split(overrides: Partial<FxCompositeConfig> = {}): FxCompositeConfig {
  return {
    ...createDefaultEffectConfig("fxComposite", "split", 0),
    ...overrides,
  };
}

describe.each(Object.entries(SCHEMAS))("%s effect config", (_, schema) => {
  test("accepts every effect's defaults", () => {
    for (const type of EFFECT_TYPES) {
      const config = createDefaultEffectConfig(type, `${type}-1`, 0);
      expect(schema.safeParse(config).success).toBe(true);
    }
  });

  test("refuses a mistyped effect param", () => {
    const config = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      threshold: "bad",
    };
    expect(schema.safeParse(config).success).toBe(false);
  });

  test("refuses a universal param outside its range", () => {
    const base = createDefaultEffectConfig("compressor", "comp", 0);
    for (const patch of [
      { inputGain: 1e12 },
      { outputGain: -1 },
      { dryWet: 2 },
    ]) {
      expect(schema.safeParse({ ...base, ...patch }).success).toBe(false);
    }
  });

  test("refuses effects nested deeper than the engine allows", () => {
    expect(schema.safeParse(nestedSplits(MAX_EFFECT_TREE_DEPTH)).success).toBe(
      true
    );
    expect(
      schema.safeParse(nestedSplits(MAX_EFFECT_TREE_DEPTH + 1)).success
    ).toBe(false);
  });

  test("refuses a hostile nesting without overflowing the stack", () => {
    expect(schema.safeParse(nestedSplits(20_000)).success).toBe(false);
  });
});

describe("effectConfigSchema (stored)", () => {
  test("keeps a compiled Post-FX trim above the slider", () => {
    const config = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      outputGain: 8,
    };
    expect(effectConfigSchema.parse(config).outputGain).toBe(8);
  });

  test("brings a slider back inside its range", () => {
    const config = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      makeup: 1e12,
    };
    expect(effectConfigSchema.parse(config)).toMatchObject({ makeup: 40 });
  });

  test("resets a select that holds none of its options", () => {
    const fold = createDefaultEffectConfig("fold", "fold", 0);
    const distortion = createDefaultEffectConfig("distortion", "dist", 0);
    expect(effectConfigSchema.parse({ ...fold, oversample: 3 })).toMatchObject({
      oversample: fold.oversample,
    });
    expect(
      effectConfigSchema.parse({ ...distortion, oversample: "8x" })
    ).toMatchObject({ oversample: distortion.oversample });
  });
});

describe("nodeEffectConfigSchema", () => {
  const refuses = (config: unknown) =>
    expect(nodeEffectConfigSchema.safeParse(config).success).toBe(false);

  test("refuses a Post-FX trim past its slider", () => {
    refuses({
      ...createDefaultEffectConfig("compressor", "comp", 0),
      outputGain: 8,
    });
  });

  test("refuses a slider outside its range", () => {
    refuses({
      ...createDefaultEffectConfig("compressor", "comp", 0),
      makeup: 1e12,
    });
  });

  test("refuses a select outside its options", () => {
    refuses({ ...createDefaultEffectConfig("fold", "fold", 0), oversample: 3 });
    refuses({
      ...createDefaultEffectConfig("distortion", "dist", 0),
      oversample: "8x",
    });
  });

  test("refuses a branch gain past the Branch gain slider", () => {
    const config = split();
    const [first, second] = config.chains;
    for (const gain of [MAX_CHAIN_GAIN + 0.01, -1, 1e12]) {
      refuses({ ...config, chains: [{ ...first, gain }, second] });
    }
    expect(
      nodeEffectConfigSchema.safeParse({
        ...config,
        chains: [{ ...first, gain: MAX_CHAIN_GAIN }, second],
      }).success
    ).toBe(true);
  });

  test("refuses an effect or chain id used twice in the tree", () => {
    const config = split();
    const [first, second] = config.chains;
    if (!(first && second)) {
      throw new Error("A Split starts with two chains");
    }
    const gain = (id: string): EffectConfig =>
      createDefaultEffectConfig("compressor", id, 0);
    refuses({ ...config, chains: [first, { ...second, id: first.id }] });
    refuses({
      ...config,
      chains: [
        { ...first, effects: [gain("twin")] },
        { ...second, effects: [gain("twin")] },
      ],
    });
    refuses({ ...config, chains: [{ ...first, effects: [gain("split")] }] });
  });
});
