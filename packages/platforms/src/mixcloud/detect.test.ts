import { describe, expect, test } from "bun:test";
import { detectPlatformFromUrl } from "../detect";
import { normalizePlayablePlatformUrl } from "../playable";
import {
  isMixcloudShowUrl,
  isMixcloudUrl,
  normalizeMixcloudUrl,
  parseMixcloudShowUrl,
} from "./detect";

describe("isMixcloudUrl", () => {
  test("recognizes Mixcloud page hosts", () => {
    expect(
      isMixcloudUrl("https://www.mixcloud.com/dholbach/cryptkeeper/")
    ).toBe(true);
    expect(isMixcloudUrl("https://mixcloud.com/dholbach/")).toBe(true);
    expect(isMixcloudUrl("https://m.mixcloud.com/dholbach/cryptkeeper/")).toBe(
      true
    );
  });

  test("rejects lookalike and embedded hosts", () => {
    expect(isMixcloudUrl("https://example.com/mixcloud.com/a/b/")).toBe(false);
    expect(isMixcloudUrl("https://mixcloud.com.evil.test/a/b/")).toBe(false);
    expect(isMixcloudUrl("https://notmixcloud.com/a/b/")).toBe(false);
    expect(isMixcloudUrl("ftp://www.mixcloud.com/a/b/")).toBe(false);
    expect(isMixcloudUrl("")).toBe(false);
  });

  test("is wired into unified platform detection", () => {
    expect(
      detectPlatformFromUrl("https://www.mixcloud.com/dholbach/cryptkeeper/")
    ).toBe("mixcloud");
  });
});

describe("parseMixcloudShowUrl", () => {
  test("parses show URLs on every page host", () => {
    const expected = { slug: "cryptkeeper", username: "dholbach" };
    expect(
      parseMixcloudShowUrl("https://www.mixcloud.com/dholbach/cryptkeeper/")
    ).toEqual(expected);
    expect(
      parseMixcloudShowUrl("http://mixcloud.com/dholbach/cryptkeeper")
    ).toEqual(expected);
    expect(
      parseMixcloudShowUrl(
        "https://M.MIXCLOUD.COM./dholbach/cryptkeeper/?utm_source=x#t=10"
      )
    ).toEqual(expected);
    expect(
      parseMixcloudShowUrl(
        "https://beta.mixcloud.com/RedLightRadio/nosedrip-15-red-light-radio-01-18-2016/"
      )
    ).toEqual({
      slug: "nosedrip-15-red-light-radio-01-18-2016",
      username: "RedLightRadio",
    });
  });

  test("decodes percent-encoded segments", () => {
    expect(
      parseMixcloudShowUrl("https://www.mixcloud.com/user/caf%C3%A9-mix/")
    ).toEqual({ slug: "café-mix", username: "user" });
  });

  test("rejects profiles, profile tabs, playlists and site sections", () => {
    for (const url of [
      "https://www.mixcloud.com/",
      "https://www.mixcloud.com/dholbach/",
      "https://www.mixcloud.com/dholbach/uploads/",
      "https://www.mixcloud.com/dholbach/favorites/",
      "https://www.mixcloud.com/dholbach/listens/",
      "https://www.mixcloud.com/dholbach/playlists/",
      "https://www.mixcloud.com/dholbach/Reposts/",
      "https://www.mixcloud.com/dholbach/stream/",
      "https://www.mixcloud.com/dholbach/playlists/some-list/",
      "https://www.mixcloud.com/discover/jazz/",
      "https://www.mixcloud.com/genres/jazz/",
      "https://www.mixcloud.com/live/NTSRadio/",
      "https://www.mixcloud.com/tag/house/",
    ]) {
      expect(parseMixcloudShowUrl(url)).toBeNull();
    }
  });

  test("rejects other Mixcloud hosts and malformed segments", () => {
    expect(
      parseMixcloudShowUrl("https://api.mixcloud.com/dholbach/cryptkeeper/")
    ).toBeNull();
    expect(
      parseMixcloudShowUrl("https://www.mixcloud.com/dholbach/bad%2Fslug/")
    ).toBeNull();
    expect(
      parseMixcloudShowUrl("https://www.mixcloud.com/dholbach/%E0%A4%A/")
    ).toBeNull();
    expect(isMixcloudShowUrl("https://example.com/dholbach/cryptkeeper/")).toBe(
      false
    );
  });
});

describe("normalizeMixcloudUrl", () => {
  test("canonicalizes show URLs", () => {
    expect(
      normalizeMixcloudUrl("https://m.mixcloud.com/dholbach/cryptkeeper?x=1")
    ).toBe("https://www.mixcloud.com/dholbach/cryptkeeper/");
    expect(
      normalizeMixcloudUrl("https://www.mixcloud.com/user/caf%C3%A9-mix")
    ).toBe("https://www.mixcloud.com/user/caf%C3%A9-mix/");
  });

  test("leaves non-show URLs alone", () => {
    expect(normalizeMixcloudUrl("https://www.mixcloud.com/dholbach/")).toBe(
      "https://www.mixcloud.com/dholbach/"
    );
    expect(normalizeMixcloudUrl("https://example.com/a/b")).toBe(
      "https://example.com/a/b"
    );
  });

  test("runs as part of playable URL normalization", async () => {
    await expect(
      normalizePlayablePlatformUrl(
        " https://mixcloud.com/dholbach/cryptkeeper "
      )
    ).resolves.toBe("https://www.mixcloud.com/dholbach/cryptkeeper/");
  });
});
