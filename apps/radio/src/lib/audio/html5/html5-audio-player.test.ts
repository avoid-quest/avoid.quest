import { describe, expect, test } from "bun:test";
import { shouldIgnorePlaybackMediaError } from "./html5-audio-player";

describe("shouldIgnorePlaybackMediaError", () => {
  test("ignores errors while source reset is in progress", () => {
    expect(
      shouldIgnorePlaybackMediaError({
        mediaErrorCode: 4,
        mediaErrorMessage: "Empty src attribute",
        currentSrc: "",
        isResettingSource: true,
      })
    ).toBeTrue();
  });

  test("ignores empty-src transport noise", () => {
    expect(
      shouldIgnorePlaybackMediaError({
        mediaErrorCode: 4,
        mediaErrorMessage: "MEDIA_ELEMENT_ERROR: Empty src attribute",
        currentSrc: "   ",
        isResettingSource: false,
      })
    ).toBeTrue();
  });

  test("keeps real media failures actionable", () => {
    expect(
      shouldIgnorePlaybackMediaError({
        mediaErrorCode: 2,
        mediaErrorMessage: "Network error while loading stream",
        currentSrc: "https://radio.example/live",
        isResettingSource: false,
      })
    ).toBeFalse();
  });
});
