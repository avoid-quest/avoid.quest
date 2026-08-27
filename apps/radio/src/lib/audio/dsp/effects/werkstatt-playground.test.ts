import { describe, expect, test } from "bun:test";
import {
  parseWerkstattDeclarations,
  reconcileWerkstattParameters,
} from "./werkstatt-declarations";
import { WERKSTATT_PRESETS } from "./werkstatt-presets";

describe("Werkstatt playground", () => {
  test("ships pass-through and all six official examples", () => {
    expect(WERKSTATT_PRESETS.map(({ id }) => id)).toEqual([
      "pass-through",
      "hard-clipper",
      "ring-modulator",
      "simple-delay",
      "biquad-lowpass",
      "alienator",
      "beautifier",
    ]);
    for (const preset of WERKSTATT_PRESETS) {
      expect(preset.source).toContain("class Processor");
      expect(preset.source).toContain("// @label");
    }
  });

  test("uses official declarations for typed grouped controls", async () => {
    const declarations = await parseWerkstattDeclarations(`// @label Test
// @group Tone blue
// @param cutoff 1000 20 20000 exp Hz
// @param mode 2 0 3 int
// @group Switches green
// @param active true
// @sample impulse
class Processor {}`);

    expect(declarations.label).toBe("Test");
    expect(declarations.sections.map(({ group }) => group?.label)).toEqual([
      "Tone",
      "Switches",
    ]);
    expect(declarations.params.map(({ mapping }) => mapping)).toEqual([
      "exp",
      "int",
      "bool",
    ]);
    expect(declarations.samples).toEqual(["impulse"]);
  });

  test("rejects duplicate parameter/sample labels", async () => {
    await expect(
      parseWerkstattDeclarations(`// @param drive 0.5
// @sample drive
class Processor {}`)
    ).rejects.toThrow("Duplicate Werkstatt declaration: drive");
  });

  test("preserves, clamps, rounds, and resets persisted values", () => {
    const declarations = [
      {
        defaultValue: 0.5,
        label: "gain",
        mapping: "linear" as const,
        max: 1,
        min: 0,
        unit: "",
      },
      {
        defaultValue: 1,
        label: "mode",
        mapping: "int" as const,
        max: 3,
        min: 0,
        unit: "",
      },
      {
        defaultValue: 0,
        label: "active",
        mapping: "bool" as const,
        max: 1,
        min: 0,
        unit: "",
      },
    ];

    expect(
      reconcileWerkstattParameters(declarations, {
        active: 0.8,
        gain: 2,
        mode: 1.6,
        removed: 99,
      })
    ).toEqual({ active: 1, gain: 1, mode: 2 });
    expect(
      reconcileWerkstattParameters(
        declarations,
        { active: 1, gain: 0.9, mode: 3 },
        true
      )
    ).toEqual({ active: 0, gain: 0.5, mode: 1 });
  });
});
