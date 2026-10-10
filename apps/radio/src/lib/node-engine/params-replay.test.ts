import { expect, test } from "bun:test";
import { createDefaultEffectConfig } from "@/lib/audio/dsp/effects/registry";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import { createParameters } from "./params";

function parameters() {
  const configs = ["first", "second"].map((id) => ({
    ...createDefaultEffectConfig("compressor", id, 0),
    signalGain: 1,
  }));
  const values = new Map<string, EffectConfig>();
  let failing = false;
  const owner = createParameters({
    active: () => true,
    audio: {
      getEffectsRuntimeOutcome: () => ({
        backend: "official",
        ready: true,
        status: "ready",
      }),
      getStripNodes: () => null,
      hasEffectModulationField: () => true,
    },
    effects: {
      setEffectFields: (_sound, id, config) => {
        if (failing && id === "first") {
          throw new Error("lost endpoint");
        }
        values.set(id, config);
        return "applied";
      },
    },
    plan: () => ({ backend: "official", effects: configs }),
    soundId: "sound",
  });
  return {
    fail: () => {
      failing = true;
    },
    owner,
    values,
  };
}

test("transient signal gain never becomes negative", () => {
  const { owner, values } = parameters();
  expect(
    owner.set(
      { effectId: "first", field: "signalGain", kind: "effect", laneId: "a" },
      -1
    )
  ).toBe("applied");
  expect(values.get("first")?.signalGain).toBe(0);
});

test("one failed effect replay leaves other effects modulated", () => {
  const { owner, values, fail } = parameters();
  for (const effectId of ["first", "second"]) {
    owner.set(
      { effectId, field: "threshold", kind: "effect", laneId: "a" },
      -12
    );
  }
  values.clear();
  fail();
  owner.reapply();
  expect(Reflect.get(values.get("second") ?? {}, "threshold")).toBe(-12);
});

test("availability rejects Werkstatt, absent authored values and unresolved native fields", () => {
  let fieldsExist = false;
  const compressor = createDefaultEffectConfig("compressor", "comp", 0);
  const owner = createParameters({
    active: () => true,
    audio: {
      getEffectsRuntimeOutcome: () => ({
        backend: "official",
        ready: true,
        status: "ready",
      }),
      getStripNodes: () => null,
      hasEffectModulationField: () => fieldsExist,
    },
    effects: { setEffectFields: () => "applied" },
    plan: () => ({
      backend: "official",
      effects: [
        compressor,
        createDefaultEffectConfig("werkstatt", "script", 1),
      ],
    }),
    soundId: "sound",
  });
  const threshold = {
    effectId: "comp",
    field: "threshold",
    kind: "effect" as const,
    laneId: "a",
  };
  expect(owner.unavailable(threshold)).toBe(
    "openDAW has no control for this here"
  );
  expect(owner.set(threshold, -10)).toBe("unavailable");
  fieldsExist = true;
  expect(owner.unavailable(threshold)).toBeNull();
  expect(owner.unavailable({ ...threshold, field: "missing" })).toBeTruthy();
  expect(owner.unavailable({ ...threshold, effectId: "missing" })).toBeTruthy();
  expect(
    owner.unavailable({ ...threshold, effectId: "script", field: "dryWet" })
  ).toBeTruthy();
});
