import { beforeEach, describe, expect, test } from "bun:test";
import { getDjError } from "@/lib/stores/dj-runtime-store";
import { clearDjErrorSurface, reportDjErrorSurface } from "./dj-error-surface";

describe("dj-error-surface", () => {
  beforeEach(() => {
    clearDjErrorSurface();
  });

  test("reports DJ-facing errors through the shared store", () => {
    reportDjErrorSurface(
      "Track resolution failed",
      "DJ_TRACK_RESOLUTION_FAILED"
    );

    expect(getDjError()).toBe("Track resolution failed");
  });

  test("clears the shared DJ error surface", () => {
    reportDjErrorSurface("Playback failed", "DJ_PLAYBACK_FAILED");
    clearDjErrorSurface();

    expect(getDjError()).toBeNull();
  });
});
