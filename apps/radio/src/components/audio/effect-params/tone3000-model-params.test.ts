import { describe, expect, test } from "bun:test";
import { parseNamModel } from "./tone3000-model-params";

describe("parseNamModel", () => {
  test("keeps a valid local NAM JSON model for the official adapter", () => {
    expect(parseNamModel("amp.nam", '{"version":"0.5.2"}')).toEqual({
      modelName: "amp.nam",
      modelData: '{"version":"0.5.2"}',
    });
  });

  test("rejects non-object NAM data", () => {
    expect(() => parseNamModel("amp.nam", "[]")).toThrow(
      "NAM model must contain a JSON object."
    );
  });
});
