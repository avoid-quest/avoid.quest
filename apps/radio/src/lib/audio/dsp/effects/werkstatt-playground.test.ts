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
        label: "gain",
        defaultValue: 0.5,
        min: 0,
        max: 1,
        mapping: "linear" as const,
        unit: "",
      },
      {
        label: "mode",
        defaultValue: 1,
        min: 0,
        max: 3,
        mapping: "int" as const,
        unit: "",
      },
      {
        label: "active",
        defaultValue: 0,
        min: 0,
        max: 1,
        mapping: "bool" as const,
        unit: "",
      },
    ];

    expect(
      reconcileWerkstattParameters(declarations, {
        gain: 2,
        mode: 1.6,
        active: 0.8,
        removed: 99,
      })
    ).toEqual({ gain: 1, mode: 2, active: 1 });
    expect(
      reconcileWerkstattParameters(
        declarations,
        { gain: 0.9, mode: 3, active: 1 },
        true
      )
    ).toEqual({ gain: 0.5, mode: 1, active: 0 });
  });
});
