import { describe, expect, test } from "bun:test";
import { isPlayerMode, normalizePlayerMode } from "./normalize-player-mode";

describe("normalizePlayerMode", () => {
  test("keeps the offered modes", () => {
    expect(normalizePlayerMode("single")).toBe("single");
    expect(normalizePlayerMode("node")).toBe("node");
    expect(normalizePlayerMode("dj")).toBe("dj");
  });

  test("maps multiple to node", () => {
    expect(normalizePlayerMode("multiple")).toBe("node");
  });

  test("falls back to single for anything unknown", () => {
    for (const mode of ["turntable", "", "Node", null, undefined, 3, {}]) {
      expect(normalizePlayerMode(mode)).toBe("single");
    }
  });

  test("no longer offers multiple", () => {
    expect(isPlayerMode("multiple")).toBe(false);
    expect(isPlayerMode("node")).toBe(true);
  });
});
