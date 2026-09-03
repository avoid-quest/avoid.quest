import { describe, expect, test } from "bun:test";
import { EFFECT_DEFINITIONS } from "./effect-definitions";
import { getEffectParamDefs } from "./param-traversal";
import {
  EFFECT_PARAMETER_ROLE_MAP,
  UNIVERSAL_EFFECT_PARAMETER_ROLES,
} from "./parameter-roles";
import { EFFECT_TYPES } from "./types";
import { UNIVERSAL_EFFECT_PARAM_DEFS } from "./universal-params";

describe("effect parameter roles", () => {
  test("explicitly covers every effect type and universal wrapper control", () => {
    expect(Object.keys(EFFECT_PARAMETER_ROLE_MAP).sort()).toEqual(
      [...EFFECT_TYPES].sort()
    );

    for (const type of EFFECT_TYPES) {
      expect(EFFECT_PARAMETER_ROLE_MAP[type]).toMatchObject(
        UNIVERSAL_EFFECT_PARAMETER_ROLES
      );
    }
  });

  test("only assigns roles to declared, structural, or universal fields", () => {
    for (const type of EFFECT_TYPES) {
      const declared = new Set([
        ...Object.keys(EFFECT_DEFINITIONS[type].defaultConfig),
        ...getEffectParamDefs(type).map(({ key }) => key),
        "sidechain",
      ]);
      for (const key of Object.keys(EFFECT_PARAMETER_ROLE_MAP[type])) {
        expect(declared.has(key)).toBe(true);
      }
    }
  });

  test("distinguishes every native control that resembles a wrapper control", () => {
    const expectedNativeRoles = {
      plateReverb: ["dry", "wet"],
      delay: ["dry", "wet"],
      compressor: ["inputgain", "makeup", "automakeup", "mix"],
      crusher: ["boost", "autoGain"],
      fold: ["amount", "volume", "autoGain"],
      stereoTool: ["volume"],
      cheapReverb: ["dry", "wet"],
      waveshaper: ["deviceInputGain", "deviceOutputGain", "mix"],
      vocoder: ["gain", "mix"],
      neuralAmp: ["input", "output", "mix"],
      fxComposite: ["chains"],
      stereoSplit: ["chains"],
      frequencySplit: ["chains"],
    } as const;

    for (const [type, keys] of Object.entries(expectedNativeRoles)) {
      for (const key of keys) {
        expect(
          EFFECT_PARAMETER_ROLE_MAP[
            type as keyof typeof EFFECT_PARAMETER_ROLE_MAP
          ]
        ).toHaveProperty(key);
      }
    }
  });

  test("uses consistent wrapper labels and signal-flow descriptions", () => {
    expect(
      UNIVERSAL_EFFECT_PARAM_DEFS.map(({ key, label }) => ({ key, label }))
    ).toEqual([
      { key: "dryWet", label: "Effect Mix" },
      { key: "inputGain", label: "Pre-FX Trim" },
      { key: "outputGain", label: "Post-FX Trim" },
    ]);
    for (const param of UNIVERSAL_EFFECT_PARAM_DEFS) {
      expect(param.description?.length).toBeGreaterThan(20);
    }
  });
});
