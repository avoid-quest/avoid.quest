import { describe, expect, test } from "bun:test";
import { shouldIgnorePlaybackMediaError } from "./html5-audio-player";

describe("shouldIgnorePlaybackMediaError", () => {
  test("ignores errors while source reset is in progress", () => {
    expect(
      shouldIgnorePlaybackMediaError({
        mediaErrorCode: 4,
        currentSrc: "",
        isResettingSource: true,
      })
    ).toBeTrue();
  });

  test("ignores empty-src transport noise", () => {
    expect(
      shouldIgnorePlaybackMediaError({
        mediaErrorCode: 4,
        currentSrc: "   ",
        isResettingSource: false,
      })
    ).toBeTrue();
  });

  test("ignores aborted media errors", () => {
    expect(
      shouldIgnorePlaybackMediaError({
        mediaErrorCode: 1,
        currentSrc: "https://radio.example/live",
        isResettingSource: false,
      })
    ).toBeTrue();
  });

  test("keeps real media failures actionable", () => {
    expect(
      shouldIgnorePlaybackMediaError({
        mediaErrorCode: 2,
        currentSrc: "https://radio.example/live",
        isResettingSource: false,
      })
    ).toBeFalse();
  });
});
