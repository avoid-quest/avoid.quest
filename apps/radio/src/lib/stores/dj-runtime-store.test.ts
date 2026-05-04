import { describe, expect, test } from "bun:test";
import { getDjRuntimeState } from "./dj-runtime-store";

describe("DJ runtime compatibility state", () => {
  test("does not expose channel subscription cleanup internals", () => {
    expect(getDjRuntimeState()).not.toHaveProperty("_subscriptionCleanup");
  });
});
