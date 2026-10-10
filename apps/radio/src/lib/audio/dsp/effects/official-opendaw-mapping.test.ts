import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  canUseOfficialOpenDawRuntime,
  hasEnabledEffects,
  isOfficialOpenDawEffectType,
  MAX_MONITORING_CHANNELS,
  OPENDAW_FACTORY_KEYS,
  radioOnlyFallback,
  selectOfficialEffects,
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
  test("mirrors the installed MonitoringRouter channel limit", () => {
    const coreEntry = createRequire(import.meta.url).resolve(
      "@opendaw/studio-core"
    );
    const router = readFileSync(
      path.join(path.dirname(coreEntry), "MonitoringRouter.js"),
      "utf8"
    );
    expect(router).toContain(
      `const MAX_MONITORING_CHANNELS = ${MAX_MONITORING_CHANNELS};`
    );
    expect(MAX_MONITORING_CHANNELS).toBe(8);
  });

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
    expect(canUseOfficialOpenDawRuntime([])).toBe(false);
    expect(canUseOfficialOpenDawRuntime([effect("delay", "off", false)])).toBe(
      false
    );
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
    expect(selectOfficialEffects(effects).map(({ id }) => id)).toEqual([
      "official",
    ]);
  });

  test("keeps disabled official devices and excludes radio-only descendants of a disabled container", () => {
    const container = createDefaultEffectConfig("fxComposite", "container", 0);
    container.enabled = false;
    container.chains[0].effects = [
      effect("limiter", "legacy", true),
      effect("delay", "nested", false),
    ];
    const configs = [container, effect("cheapReverb", "reverb", true)];
    expect(canUseOfficialOpenDawRuntime(configs)).toBe(true);
    const [selected] = selectOfficialEffects(configs);
    expect(selected.enabled).toBe(false);
    if (!("chains" in selected)) {
      throw new Error("Container missing");
    }
    expect(selected.chains[0].effects.map(({ id }) => id)).toEqual(["nested"]);
  });

  test("an enabled legacy effect selects the compatibility runtime", () => {
    expect(
      canUseOfficialOpenDawRuntime([
        effect("delay", "official", true),
        effect("limiter", "legacy", true),
      ])
    ).toBe(false);
  });

  test("a keyed effect openDAW keys falls back by its configuration, not its type", () => {
    const keyed = (type: "compressor" | "delay") => ({
      ...effect(type, type, true),
      sidechain: { channelId: "key" },
    });
    expect(radioOnlyFallback([keyed("compressor")])).toBeNull();
    expect(radioOnlyFallback([keyed("delay")])).toBe(
      "unsupported-config:delay"
    );
    expect(radioOnlyFallback([effect("limiter", "legacy", true)])).toBe(
      "radio-only:limiter"
    );
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
