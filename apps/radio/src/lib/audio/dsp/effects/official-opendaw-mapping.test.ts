import { describe, expect, test } from "bun:test";
import {
  canUseOfficialOpenDawRuntime,
  hasEnabledEffects,
  selectEnabledEffects,
} from "./official-opendaw-mapping";
import type { EffectConfig } from "./types";

const effect = (
  type: EffectConfig["type"],
  id: string,
  enabled: boolean
): EffectConfig =>
  ({
    id,
    type,
    enabled,
    order: 0,
    dryWet: 1,
    inputGain: 1,
    outputGain: 1,
  }) as EffectConfig;

describe("official openDAW runtime selection", () => {
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
});
