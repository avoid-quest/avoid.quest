import { describe, expect, test } from "bun:test";
import {
  detectPlayablePlatformFromUrl,
  getFilenameFromUrl,
  isAudioUrl,
  isPlaylistUrl,
} from "./detect";

const SCRIPT_MODULE = /\.(?:[cm]?js|ts)$/;
const HTML_PARSER_MODULE = /\/(?:cheerio|parse5|htmlparser2)\//;
const PROVIDER_RESOLVER_MODULE =
  /\/(?:bandcamp|mixcloud|radiogarden|soundcloud|spotify|youtube)\/index\.ts$/;

describe("pure playable platform detection", () => {
  test.each([
    ["https://artist.bandcamp.com/track/song.mp3", "bandcamp"],
    ["https://www.mixcloud.com/user/show/", "mixcloud"],
    ["https://radio.garden/listen/foo/abc123", "radiogarden"],
    ["https://soundcloud.com/artist/song", "soundcloud"],
    ["spotify:track:4cOdK2wGLETKBW3PvgPWqT", "spotify"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://example.com/live.m3u8", "static-audio"],
    ["https://example.com/Mix-01.MP3?download=1", "static-audio"],
    ["https://example.com/page", null],
    ["https://bandcamp.com.evil.example/track/song", null],
    ["https://soundcloud.com@evil.example/artist/song", null],
    ["", null],
    ["not a url", null],
  ] as const)("detects %s as %s", (url, platform) => {
    expect(detectPlayablePlatformFromUrl(url)).toBe(platform);
  });

  test("exposes the static audio helpers without URL resolution", () => {
    expect(isAudioUrl("https://example.com/Mix-01.MP3?download=1")).toBe(true);
    expect(isPlaylistUrl("https://example.com/live/radio.m3u8")).toBe(true);
    expect(getFilenameFromUrl("https://example.com/deep_mix-01.mp3")).toBe(
      "deep mix 01"
    );
  });

  test("bundles for browsers without provider resolvers or HTML parsers", async () => {
    const modules: string[] = [];
    const result = await Bun.build({
      entrypoints: [import.meta.resolveSync("./detect.ts")],
      plugins: [
        {
          name: "record-detection-import-graph",
          setup(build) {
            build.onLoad({ filter: SCRIPT_MODULE }, (args) => {
              modules.push(args.path);
            });
          },
        },
      ],
      target: "browser",
    });

    expect(result.success).toBe(true);
    expect(modules).toContain(import.meta.resolveSync("./detect.ts"));
    expect(modules.filter((file) => HTML_PARSER_MODULE.test(file))).toEqual([]);
    expect(
      modules.filter((file) => PROVIDER_RESOLVER_MODULE.test(file))
    ).toEqual([]);
  });
});
