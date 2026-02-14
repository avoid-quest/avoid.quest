import { describe, expect, test } from "bun:test";
import {
  buildPlaybackEventKey,
  createDedupeStore,
  shouldCapturePlaybackError,
} from "./playback-errors";

describe("playback telemetry helpers", () => {
  test("captures only actionable error codes", () => {
    expect(shouldCapturePlaybackError("MEDIA_ERROR_4")).toBe(true);
    expect(shouldCapturePlaybackError("SINGLE_PLAY_FAILED")).toBe(true);
    expect(shouldCapturePlaybackError("UNKNOWN")).toBe(false);
  });

  test("builds stable dedupe keys", () => {
    const key = buildPlaybackEventKey({
      mode: "single",
      errorCode: "MEDIA_ERROR_4",
      errorMessage: "Unsupported stream format for this browser",
      streamUrl: "https://example.test/live",
    });

    expect(key).toContain("single");
    expect(key).toContain("MEDIA_ERROR_4");
    expect(key).toContain("https://example.test/live");
  });

  test("dedupe store suppresses repeated events within ttl", () => {
    let now = 1000;
    const dedupe = createDedupeStore(500, () => now);
    const key = "single|MEDIA_ERROR_4|https://example|unsupported";

    expect(dedupe.hasSeen(key)).toBe(false);
    expect(dedupe.hasSeen(key)).toBe(true);

    now = 1700;
    expect(dedupe.hasSeen(key)).toBe(false);
  });
});
