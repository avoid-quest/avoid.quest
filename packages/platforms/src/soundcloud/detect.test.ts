import { describe, expect, test } from "bun:test";
import {
  detectSoundCloudItemType,
  isSoundCloudUrl,
  needsResolution,
  normalizeSoundCloudUrl,
} from "./detect";

describe("isSoundCloudUrl", () => {
  test("recognizes standard SoundCloud URLs", () => {
    expect(isSoundCloudUrl("https://soundcloud.com/artist/track")).toBe(true);
    expect(isSoundCloudUrl("https://soundcloud.com/artist")).toBe(true);
    expect(isSoundCloudUrl("https://www.soundcloud.com/artist/track")).toBe(
      true
    );
  });

  test("recognizes SoundCloud short links", () => {
    expect(isSoundCloudUrl("https://on.soundcloud.com/abc123")).toBe(true);
  });

  test("recognizes mobile SoundCloud URLs", () => {
    expect(isSoundCloudUrl("https://m.soundcloud.com/artist/track")).toBe(true);
  });

  test("rejects non-SoundCloud URLs", () => {
    expect(isSoundCloudUrl("https://example.com")).toBe(false);
    expect(isSoundCloudUrl("https://youtube.com/watch?v=abc")).toBe(false);
    expect(isSoundCloudUrl("")).toBe(false);
  });
});

describe("needsResolution", () => {
  test("returns true for short links", () => {
    expect(needsResolution("https://on.soundcloud.com/abc123")).toBe(true);
  });

  test("returns false for standard URLs", () => {
    expect(needsResolution("https://soundcloud.com/artist/track")).toBe(false);
  });
});

describe("normalizeSoundCloudUrl", () => {
  test("converts mobile URL to desktop", () => {
    expect(
      normalizeSoundCloudUrl("https://m.soundcloud.com/artist/track")
    ).toBe("https://soundcloud.com/artist/track");
  });

  test("preserves desktop URLs", () => {
    expect(normalizeSoundCloudUrl("https://soundcloud.com/artist/track")).toBe(
      "https://soundcloud.com/artist/track"
    );
  });
});

describe("detectSoundCloudItemType", () => {
  test("detects playlist/set URLs", () => {
    expect(
      detectSoundCloudItemType("https://soundcloud.com/artist/sets/album-name")
    ).toBe("playlist");
  });

  test("detects track URLs", () => {
    expect(
      detectSoundCloudItemType("https://soundcloud.com/artist/track-name")
    ).toBe("track");
  });

  test("detects user/profile URLs", () => {
    expect(detectSoundCloudItemType("https://soundcloud.com/artist")).toBe(
      "user"
    );
  });

  test("treats bare domain as user", () => {
    expect(detectSoundCloudItemType("https://soundcloud.com")).toBe("user");
  });
});
