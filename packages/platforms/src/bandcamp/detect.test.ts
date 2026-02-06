import { describe, expect, test } from "bun:test";
import {
  detectBandcampFromHtml,
  detectBandcampItemType,
  isBandcampUrl,
  normalizeBandcampUrl,
} from "./detect";

describe("isBandcampUrl", () => {
  test("recognizes standard Bandcamp URLs", () => {
    expect(isBandcampUrl("https://artist.bandcamp.com/album/test")).toBe(true);
    expect(isBandcampUrl("https://artist.bandcamp.com/track/test")).toBe(true);
    expect(isBandcampUrl("https://bandcamp.com/username")).toBe(true);
  });

  test("recognizes mobile Bandcamp URLs", () => {
    expect(isBandcampUrl("https://m.bandcamp.com/username")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isBandcampUrl("https://ARTIST.BANDCAMP.COM/album/test")).toBe(true);
  });

  test("rejects non-Bandcamp URLs", () => {
    expect(isBandcampUrl("https://example.com")).toBe(false);
    expect(isBandcampUrl("https://soundcloud.com/artist")).toBe(false);
    expect(isBandcampUrl("")).toBe(false);
  });
});

describe("normalizeBandcampUrl", () => {
  test("converts mobile URL to desktop", () => {
    expect(normalizeBandcampUrl("https://m.bandcamp.com/username")).toBe(
      "https://bandcamp.com/username"
    );
  });

  test("preserves desktop URLs", () => {
    expect(normalizeBandcampUrl("https://artist.bandcamp.com/album/test")).toBe(
      "https://artist.bandcamp.com/album/test"
    );
  });
});

describe("detectBandcampFromHtml", () => {
  test("detects data-tralbum attribute", () => {
    expect(detectBandcampFromHtml('<div data-tralbum="...">')).toBe(true);
  });

  test("detects Bandcamp JS", () => {
    expect(
      detectBandcampFromHtml('<script src="https://bandcamp.com/js/app.js">')
    ).toBe(true);
  });

  test("detects og:site_name meta tag", () => {
    expect(
      detectBandcampFromHtml(
        '<meta property="og:site_name" content="Bandcamp">'
      )
    ).toBe(true);
  });

  test("returns false for non-Bandcamp HTML", () => {
    expect(detectBandcampFromHtml("<html><body>Hello</body></html>")).toBe(
      false
    );
  });
});

describe("detectBandcampItemType", () => {
  test("detects album URLs", () => {
    expect(
      detectBandcampItemType("https://artist.bandcamp.com/album/test-album")
    ).toBe("album");
  });

  test("detects track URLs", () => {
    expect(
      detectBandcampItemType("https://artist.bandcamp.com/track/test-track")
    ).toBe("track");
  });

  test("detects label URLs", () => {
    expect(
      detectBandcampItemType("https://label.bandcamp.com/label/sublabel")
    ).toBe("label");
  });

  test("detects collection URLs", () => {
    expect(detectBandcampItemType("https://bandcamp.com/username")).toBe(
      "collection"
    );
    expect(
      detectBandcampItemType("https://bandcamp.com/username/collection")
    ).toBe("collection");
    expect(
      detectBandcampItemType("https://bandcamp.com/username/wishlist")
    ).toBe("collection");
  });

  test("detects artist pages (subdomain only)", () => {
    expect(detectBandcampItemType("https://artist.bandcamp.com")).toBe(
      "artist"
    );
    expect(detectBandcampItemType("https://artist.bandcamp.com/music")).toBe(
      "artist"
    );
  });

  test("defaults to artist for unrecognized subdomain patterns", () => {
    expect(
      detectBandcampItemType("https://artist.bandcamp.com/other-path")
    ).toBe("artist");
  });
});
