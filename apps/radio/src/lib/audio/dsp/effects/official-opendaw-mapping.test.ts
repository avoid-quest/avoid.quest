import { describe, expect, test } from "bun:test";
import {
  canUseOfficialOpenDawRuntime,
  hasEnabledEffects,
  isOfficialOpenDawEffectType,
  OPENDAW_FACTORY_KEYS,
  selectEnabledEffects,
} from "./official-opendaw-mapping";
import { createDefaultEffectConfig } from "./registry";
import {
  type EffectConfig,
  OPENDAW_EFFECT_TYPES,
  RADIO_EFFECT_TYPES,
} from "./types";

const effect = (
  type: EffectConfig["type"],
  id: string,
  enabled: boolean
): EffectConfig =>
  ({
    dryWet: 1,
    enabled,
    id,
    inputGain: 1,
    order: 0,
    outputGain: 1,
    type,
  }) as EffectConfig;

describe("official openDAW runtime selection", () => {
  test("maps every official effect exactly once and no radio-only effect", () => {
    expect(Object.keys(OPENDAW_FACTORY_KEYS).sort()).toEqual(
      [...OPENDAW_EFFECT_TYPES].sort()
    );
    expect(new Set(Object.values(OPENDAW_FACTORY_KEYS)).size).toBe(
      OPENDAW_EFFECT_TYPES.length
    );
    expect(
      RADIO_EFFECT_TYPES.every((type) => !isOfficialOpenDawEffectType(type))
    ).toBe(true);
  });

  test("does not initialize an effect runtime for an empty or disabled chain", () => {
    expect(hasEnabledEffects([])).toBe(false);
    expect(hasEnabledEffects([effect("pitchShifter", "legacy", false)])).toBe(
      false
    );
  });

  test("disabled legacy records do not pin an enabled official chain", () => {
    const effects = [
      effect("pitchShifter", "legacy", false),
      effect("delay", "official", true),
    ];

    expect(canUseOfficialOpenDawRuntime(effects)).toBe(true);
    expect(selectEnabledEffects(effects).map(({ id }) => id)).toEqual([
      "official",
    ]);
  });

  test("an enabled legacy effect selects the compatibility runtime", () => {
    expect(
      canUseOfficialOpenDawRuntime([
        effect("delay", "official", true),
        effect("limiter", "legacy", true),
      ])
    ).toBe(false);
  });

  test("an enabled nested legacy effect keeps the chain compatible", () => {
    const container = createDefaultEffectConfig("fxComposite", "container", 0);
    const legacy = createDefaultEffectConfig("limiter", "nested-legacy", 0);
    container.enabled = true;
    legacy.enabled = true;
    const [chain] = container.chains;
    if (!chain) {
      throw new Error("Composite effect requires a chain");
    }
    chain.effects = [legacy];

    expect(canUseOfficialOpenDawRuntime([container])).toBe(false);
  });
});
