import { describe, expect, test } from "bun:test";
import type {
  InvidiousAdaptiveFormat,
  InvidiousVideoThumbnail,
} from "./invidious";
import { getBestThumbnail, selectBestAudioStream } from "./invidious";

describe("selectBestAudioStream", () => {
  const makeFormat = (
    overrides: Partial<InvidiousAdaptiveFormat>
  ): InvidiousAdaptiveFormat => ({
    url: "https://rr.googlevideo.com/stream",
    bitrate: "128000",
    type: "audio/webm",
    clen: "1000000",
    container: "webm",
    encoding: "opus",
    ...overrides,
  });

  test("returns null for empty formats", () => {
    expect(selectBestAudioStream([])).toBeNull();
  });

  test("returns null when no audio formats exist", () => {
    const formats = [
      makeFormat({ type: "video/mp4", encoding: "h264", container: "mp4" }),
    ];
    expect(selectBestAudioStream(formats)).toBeNull();
  });

  test("prefers Opus over AAC", () => {
    const formats = [
      makeFormat({
        type: "audio/mp4",
        encoding: "aac",
        container: "m4a",
        bitrate: "256000",
      }),
      makeFormat({
        type: "audio/webm",
        encoding: "opus",
        container: "webm",
        bitrate: "128000",
      }),
    ];
    const result = selectBestAudioStream(formats);
    expect(result?.encoding).toBe("opus");
  });

  test("selects highest bitrate Opus stream", () => {
    const formats = [
      makeFormat({ encoding: "opus", container: "webm", bitrate: "64000" }),
      makeFormat({ encoding: "opus", container: "webm", bitrate: "160000" }),
      makeFormat({ encoding: "opus", container: "webm", bitrate: "128000" }),
    ];
    const result = selectBestAudioStream(formats);
    expect(result?.bitrate).toBe("160000");
  });

  test("falls back to AAC when no Opus available", () => {
    const formats = [
      makeFormat({
        type: "audio/mp4",
        encoding: "aac",
        container: "m4a",
        bitrate: "128000",
      }),
      makeFormat({
        type: "audio/mp4",
        encoding: "aac",
        container: "m4a",
        bitrate: "256000",
      }),
    ];
    const result = selectBestAudioStream(formats);
    expect(result?.encoding).toBe("aac");
    expect(result?.bitrate).toBe("256000");
  });

  test("falls back to any audio when no Opus or AAC", () => {
    const formats = [
      makeFormat({
        type: "audio/ogg",
        encoding: "vorbis",
        container: "ogg",
        bitrate: "128000",
      }),
    ];
    const result = selectBestAudioStream(formats);
    expect(result?.encoding).toBe("vorbis");
  });

  test("filters out video formats", () => {
    const formats = [
      makeFormat({
        type: "video/mp4",
        encoding: "h264",
        container: "mp4",
        bitrate: "5000000",
      }),
      makeFormat({
        type: "audio/webm",
        encoding: "opus",
        container: "webm",
        bitrate: "128000",
      }),
    ];
    const result = selectBestAudioStream(formats);
    expect(result?.type).toStartWith("audio/");
  });
});

describe("getBestThumbnail", () => {
  const makeThumbnail = (
    quality: string,
    url = `/vi/test/${quality}.jpg`
  ): InvidiousVideoThumbnail => ({
    quality,
    url,
    width: 640,
    height: 480,
  });

  test("returns empty string for empty array", () => {
    expect(getBestThumbnail([])).toBe("");
  });

  test("prefers sddefault quality", () => {
    const thumbnails = [
      makeThumbnail("maxresdefault"),
      makeThumbnail("high"),
      makeThumbnail("sddefault"),
      makeThumbnail("medium"),
    ];
    const result = getBestThumbnail(thumbnails);
    expect(result).toContain("sddefault");
  });

  test("falls back to high when sddefault unavailable", () => {
    const thumbnails = [
      makeThumbnail("maxresdefault"),
      makeThumbnail("high"),
      makeThumbnail("medium"),
    ];
    const result = getBestThumbnail(thumbnails);
    expect(result).toContain("high");
  });

  test("falls back to medium when higher qualities unavailable", () => {
    const thumbnails = [
      makeThumbnail("maxresdefault"),
      makeThumbnail("medium"),
    ];
    const result = getBestThumbnail(thumbnails);
    expect(result).toContain("medium");
  });

  test("falls back to maxresdefault as last preferred quality", () => {
    const thumbnails = [makeThumbnail("maxresdefault")];
    const result = getBestThumbnail(thumbnails);
    expect(result).toContain("maxresdefault");
  });

  test("falls back to first available for unknown qualities", () => {
    const thumbnails = [makeThumbnail("custom")];
    const result = getBestThumbnail(thumbnails);
    expect(result).toContain("custom");
  });

  test("prepends default instance URL for relative URLs", () => {
    const thumbnails = [makeThumbnail("sddefault", "/vi/abc/sddefault.jpg")];
    const result = getBestThumbnail(thumbnails);
    expect(result).toBe("https://yt.avoid.quest/vi/abc/sddefault.jpg");
  });

  test("prepends custom instance URL for relative URLs", () => {
    const thumbnails = [makeThumbnail("sddefault", "/vi/abc/sddefault.jpg")];
    const result = getBestThumbnail(thumbnails, "https://my-invidious.com");
    expect(result).toBe("https://my-invidious.com/vi/abc/sddefault.jpg");
  });

  test("preserves absolute URLs", () => {
    const thumbnails = [
      makeThumbnail("sddefault", "https://i.ytimg.com/vi/abc/sddefault.jpg"),
    ];
    const result = getBestThumbnail(thumbnails);
    expect(result).toBe("https://i.ytimg.com/vi/abc/sddefault.jpg");
  });
});
