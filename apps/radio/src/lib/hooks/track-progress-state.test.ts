import { describe, expect, test } from "bun:test";
import { getVisibleTrackProgress } from "./track-progress-state";

describe("getVisibleTrackProgress", () => {
  test("hides progress owned by the source that was replaced", () => {
    const previousProgress = {
      duration: 486,
      position: 120,
      soundId: "left_bandcamp",
    };

    expect(
      getVisibleTrackProgress("left_soundcloud", previousProgress)
    ).toEqual({ duration: 0, position: 0 });
    expect(getVisibleTrackProgress("left_bandcamp", previousProgress)).toEqual(
      previousProgress
    );
  });
});
