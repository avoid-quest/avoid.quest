import { describe, expect, test } from "bun:test";
import { Distortion } from "./distortion";

describe("Distortion Effect", () => {
  test("creates with default values", () => {
    const distortion = new Distortion(44_100);
    expect(distortion.getAmount()).toBe(0);
  });

  test("setAmount/getAmount roundtrip at 0", () => {
    const distortion = new Distortion(44_100);
    distortion.setAmount(0);
    expect(distortion.getAmount()).toBeCloseTo(0, 5);
  });

  test("setAmount/getAmount roundtrip at 100", () => {
    const distortion = new Distortion(44_100);
    distortion.setAmount(100);
    expect(distortion.getAmount()).toBeCloseTo(100, 5);
  });

  test("setAmount/getAmount roundtrip at 50", () => {
    const distortion = new Distortion(44_100);
    distortion.setAmount(50);
    expect(distortion.getAmount()).toBeCloseTo(50, 5);
  });

  test("setAmount/getAmount roundtrip at 25", () => {
    const distortion = new Distortion(44_100);
    distortion.setAmount(25);
    expect(distortion.getAmount()).toBeCloseTo(25, 5);
  });

  test("setAmount/getAmount roundtrip at 75", () => {
    const distortion = new Distortion(44_100);
    distortion.setAmount(75);
    expect(distortion.getAmount()).toBeCloseTo(75, 5);
  });

  test("setAmount clamps values below 0", () => {
    const distortion = new Distortion(44_100);
    distortion.setAmount(-10);
    expect(distortion.getAmount()).toBeCloseTo(0, 5);
  });

  test("setAmount clamps values above 100", () => {
    const distortion = new Distortion(44_100);
    distortion.setAmount(150);
    expect(distortion.getAmount()).toBeCloseTo(100, 5);
  });

  test("reset does not throw", () => {
    const distortion = new Distortion(44_100);
    distortion.setAmount(50);
    expect(() => distortion.reset()).not.toThrow();
  });

  test("setOversample accepts valid values", () => {
    const distortion = new Distortion(44_100);
    expect(() => distortion.setOversample("none")).not.toThrow();
    expect(() => distortion.setOversample("2x")).not.toThrow();
    expect(() => distortion.setOversample("4x")).not.toThrow();
  });
});
