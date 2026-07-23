import { describe, expect, test } from "bun:test";
import {
  canUseOfficialOpenDawRuntime,
  OPENDAW_FACTORY_KEYS,
} from "./official-opendaw-mapping";
import { createDefaultEffectConfig } from "./registry";
import { OPENDAW_EFFECT_TYPES } from "./types";

describe("official openDAW effect mapping", () => {
  test("maps every current openDAW effect to its published factory key", () => {
    expect(Object.keys(OPENDAW_FACTORY_KEYS)).toEqual([
      ...OPENDAW_EFFECT_TYPES,
    ]);
    expect(new Set(Object.values(OPENDAW_FACTORY_KEYS))).toHaveLength(19);
  });

  test("rejects radio-only effects at any container depth", () => {
    const composite = createDefaultEffectConfig("fxComposite", "fx", 0);
    composite.enabled = true;
    expect(canUseOfficialOpenDawRuntime([composite])).toBe(true);

    composite.chains[0]?.effects.push(
      createDefaultEffectConfig("pitchShifter", "pitch", 0)
    );
    expect(canUseOfficialOpenDawRuntime([composite])).toBe(false);
  });

  test("does not switch audio engines for an entirely bypassed stock chain", () => {
    const delay = createDefaultEffectConfig("delay", "delay", 0);
    delay.enabled = false;

    expect(canUseOfficialOpenDawRuntime([delay])).toBe(false);

    delay.enabled = true;
    expect(canUseOfficialOpenDawRuntime([delay])).toBe(true);
  });
});
