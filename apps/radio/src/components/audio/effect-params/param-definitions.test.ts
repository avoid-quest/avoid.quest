import { describe, expect, test } from "bun:test";
import { formatParam } from "./param-definitions";

describe("formatParam", () => {
  test("formats both normalized and 0-100 percentages", () => {
    expect(formatParam("percentage", 0.5)).toBe("50%");
    expect(formatParam("percentage100", 50)).toBe("50%");
  });
});
