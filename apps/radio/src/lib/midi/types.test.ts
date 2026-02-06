import { describe, expect, test } from "bun:test";
import { applyTransform, DEFAULT_TRANSFORM } from "./types";

describe("applyTransform", () => {
  test("linear identity (default transform)", () => {
    expect(applyTransform(0, {})).toBe(0);
    expect(applyTransform(0.5, {})).toBe(0.5);
    expect(applyTransform(1, {})).toBe(1);
  });

  test("invert", () => {
    expect(applyTransform(0, { invert: true })).toBe(1);
    expect(applyTransform(1, { invert: true })).toBe(0);
    expect(applyTransform(0.25, { invert: true })).toBe(0.75);
  });

  test("range mapping: min/max", () => {
    expect(applyTransform(0, { min: 0, max: 100 })).toBe(0);
    expect(applyTransform(0.5, { min: 0, max: 100 })).toBe(50);
    expect(applyTransform(1, { min: 0, max: 100 })).toBe(100);
  });

  test("range mapping with non-zero min", () => {
    expect(applyTransform(0, { min: 20, max: 80 })).toBe(20);
    expect(applyTransform(0.5, { min: 20, max: 80 })).toBe(50);
    expect(applyTransform(1, { min: 20, max: 80 })).toBe(80);
  });

  test("inverted range (min > max) still clamps correctly", () => {
    const result = applyTransform(0, { min: 1, max: 0 });
    expect(result).toBe(1);
    const result2 = applyTransform(1, { min: 1, max: 0 });
    expect(result2).toBe(0);
  });

  test("log curve: endpoints preserved (0->0, 1->1)", () => {
    expect(applyTransform(0, { curve: "log" })).toBe(0);
    expect(applyTransform(1, { curve: "log" })).toBeCloseTo(1, 10);
  });

  test("log curve: midpoint has logarithmic response", () => {
    const linear = applyTransform(0.5, { curve: "linear" });
    const log = applyTransform(0.5, { curve: "log" });
    // Log curve should be above linear at midpoint
    expect(log).toBeGreaterThan(linear);
  });

  test("exp curve: endpoints preserved (0->0, 1->1)", () => {
    expect(applyTransform(0, { curve: "exp" })).toBeCloseTo(0, 10);
    expect(applyTransform(1, { curve: "exp" })).toBeCloseTo(1, 10);
  });

  test("exp curve: midpoint has exponential response", () => {
    const linear = applyTransform(0.5, { curve: "linear" });
    const exp = applyTransform(0.5, { curve: "exp" });
    // Exp curve should be below linear at midpoint
    expect(exp).toBeLessThan(linear);
  });

  test("log and exp are complementary curves", () => {
    const log = applyTransform(0.5, { curve: "log" });
    const exp = applyTransform(0.5, { curve: "exp" });
    // They should be on opposite sides of 0.5
    expect(log).toBeGreaterThan(0.5);
    expect(exp).toBeLessThan(0.5);
  });

  test("combined: invert + range", () => {
    // invert 0 -> 1, then map 1 * 100 = 100
    expect(applyTransform(0, { invert: true, min: 0, max: 100 })).toBe(100);
    // invert 1 -> 0, then map 0 * 100 = 0
    expect(applyTransform(1, { invert: true, min: 0, max: 100 })).toBe(0);
  });

  test("combined: log curve + range", () => {
    const result = applyTransform(1, { curve: "log", min: 0, max: 127 });
    expect(result).toBeCloseTo(127, 5);
    expect(applyTransform(0, { curve: "log", min: 0, max: 127 })).toBe(0);
  });

  test("clamping: values beyond range are clamped", () => {
    // Input > 1 should be clamped to max
    expect(applyTransform(1.5, { min: 0, max: 1 })).toBe(1);
    // Input < 0 with invert could produce values out of range
    expect(applyTransform(-0.5, { min: 0, max: 1 })).toBe(0);
  });

  test("partial transform uses defaults for missing fields", () => {
    // Only providing curve, rest should be default
    const result = applyTransform(0.5, { curve: "linear" });
    expect(result).toBe(0.5);
  });

  test("DEFAULT_TRANSFORM has expected values", () => {
    expect(DEFAULT_TRANSFORM).toEqual({
      invert: false,
      min: 0,
      max: 1,
      curve: "linear",
    });
  });
});
