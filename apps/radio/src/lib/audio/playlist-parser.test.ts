import { describe, expect, test } from "bun:test";
import { parseM3U, parsePLS, parsePlaylist } from "./playlist-parser";

describe("parseM3U", () => {
  test("parses basic M3U with EXTINF metadata", () => {
    const content = `#EXTM3U
#EXTINF:180,Artist - Track One
https://example.com/track1.mp3
#EXTINF:240,Artist - Track Two
https://example.com/track2.mp3`;

    const result = parseM3U(content);
    expect(result.format).toBe("m3u");
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0]).toEqual({
      duration: 180,
      title: "Artist - Track One",
      url: "https://example.com/track1.mp3",
    });
    expect(result.tracks[1]).toEqual({
      duration: 240,
      title: "Artist - Track Two",
      url: "https://example.com/track2.mp3",
    });
  });

  test("parses M3U without EXTINF (plain URL list)", () => {
    const content = `https://example.com/song1.mp3
https://example.com/song2.ogg`;

    const result = parseM3U(content);
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0].url).toBe("https://example.com/song1.mp3");
    expect(result.tracks[0].title).toBe("song1");
    expect(result.tracks[1].title).toBe("song2");
  });

  test("handles negative duration as undefined", () => {
    const content = `#EXTM3U
#EXTINF:-1,Stream Title
https://example.com/stream`;

    const result = parseM3U(content);
    expect(result.tracks[0].duration).toBeUndefined();
  });

  test("handles non-numeric duration as undefined", () => {
    const content = `#EXTM3U
#EXTINF:abc,Title
https://example.com/track.mp3`;

    const result = parseM3U(content);
    expect(result.tracks[0].duration).toBeUndefined();
    expect(result.tracks[0].title).toBe("Title");
  });

  test("skips comment lines starting with #", () => {
    const content = `#EXTM3U
# This is a comment
#EXTINF:120,Track
https://example.com/track.mp3
# Another comment`;

    const result = parseM3U(content);
    expect(result.tracks).toHaveLength(1);
  });

  test("resolves relative URLs against base URL", () => {
    const content = `#EXTM3U
#EXTINF:120,Track
/audio/track.mp3`;

    const result = parseM3U(content, "https://example.com/playlists/list.m3u");
    expect(result.tracks[0].url).toBe("https://example.com/audio/track.mp3");
  });

  test("preserves absolute URLs when base URL provided", () => {
    const content = `#EXTINF:120,Track
https://other.com/track.mp3`;

    const result = parseM3U(content, "https://example.com/playlist.m3u");
    expect(result.tracks[0].url).toBe("https://other.com/track.mp3");
  });

  test("handles Windows-style line endings", () => {
    const content = "#EXTM3U\r\n#EXTINF:120,Track\r\nhttps://example.com/t.mp3";

    const result = parseM3U(content);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].title).toBe("Track");
  });

  test("handles empty content", () => {
    const result = parseM3U("");
    expect(result.tracks).toHaveLength(0);
    expect(result.format).toBe("m3u");
  });

  test("handles EXTINF without comma (title only)", () => {
    const content = `#EXTINF:Stream Title
https://example.com/stream`;

    const result = parseM3U(content);
    expect(result.tracks[0].title).toBe("Stream Title");
    expect(result.tracks[0].duration).toBeUndefined();
  });

  test("uses filename as fallback title", () => {
    const content = "https://example.com/path/my-cool_track.mp3";

    const result = parseM3U(content);
    expect(result.tracks[0].title).toBe("my cool track");
  });

  test("resets metadata between tracks", () => {
    const content = `#EXTM3U
#EXTINF:120,First Track
https://example.com/first.mp3
https://example.com/second.mp3`;

    const result = parseM3U(content);
    expect(result.tracks[0].title).toBe("First Track");
    expect(result.tracks[0].duration).toBe(120);
    expect(result.tracks[1].title).toBe("second");
    expect(result.tracks[1].duration).toBeUndefined();
  });
});

describe("parsePLS", () => {
  test("parses standard PLS format", () => {
    const content = `[playlist]
File1=https://example.com/track1.mp3
Title1=First Track
Length1=180
File2=https://example.com/track2.mp3
Title2=Second Track
Length2=240
NumberOfEntries=2
Version=2`;

    const result = parsePLS(content);
    expect(result.format).toBe("pls");
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0]).toEqual({
      duration: 180,
      title: "First Track",
      url: "https://example.com/track1.mp3",
    });
    expect(result.tracks[1]).toEqual({
      duration: 240,
      title: "Second Track",
      url: "https://example.com/track2.mp3",
    });
  });

  test("handles entries in non-sequential order", () => {
    const content = `[playlist]
File3=https://example.com/three.mp3
Title3=Three
File1=https://example.com/one.mp3
Title1=One`;

    const result = parsePLS(content);
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0].title).toBe("One");
    expect(result.tracks[1].title).toBe("Three");
  });

  test("skips entries without URLs", () => {
    const content = `[playlist]
Title1=Orphan Title
File2=https://example.com/track.mp3
Title2=Valid Track`;

    const result = parsePLS(content);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].title).toBe("Valid Track");
  });

  test("uses filename as fallback title", () => {
    const content = `[playlist]
File1=https://example.com/my-song.mp3`;

    const result = parsePLS(content);
    expect(result.tracks[0].title).toBe("my song");
  });

  test("handles negative duration as undefined", () => {
    const content = `[playlist]
File1=https://example.com/stream
Title1=Live Stream
Length1=-1`;

    const result = parsePLS(content);
    expect(result.tracks[0].duration).toBeUndefined();
  });

  test("is case-insensitive for keys", () => {
    const content = `[playlist]
FILE1=https://example.com/track.mp3
TITLE1=Uppercase Keys
LENGTH1=120`;

    const result = parsePLS(content);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].title).toBe("Uppercase Keys");
    expect(result.tracks[0].duration).toBe(120);
  });

  test("skips PLS comment lines starting with ;", () => {
    const content = `[playlist]
; This is a comment
File1=https://example.com/track.mp3
Title1=Track`;

    const result = parsePLS(content);
    expect(result.tracks).toHaveLength(1);
  });

  test("resolves relative URLs against base URL", () => {
    const content = `[playlist]
File1=/audio/track.mp3
Title1=Track`;

    const result = parsePLS(content, "https://example.com/playlists/list.pls");
    expect(result.tracks[0].url).toBe("https://example.com/audio/track.mp3");
  });

  test("handles empty content", () => {
    const result = parsePLS("");
    expect(result.tracks).toHaveLength(0);
    expect(result.format).toBe("pls");
  });
});

describe("parsePlaylist", () => {
  test("auto-detects PLS format", () => {
    const content = `[playlist]
File1=https://example.com/track.mp3
Title1=Track`;

    const result = parsePlaylist(content);
    expect(result.format).toBe("pls");
  });

  test("auto-detects PLS case-insensitively", () => {
    const content = `[PLAYLIST]
File1=https://example.com/track.mp3`;

    const result = parsePlaylist(content);
    expect(result.format).toBe("pls");
  });

  test("defaults to M3U for other content", () => {
    const content = `#EXTM3U
#EXTINF:120,Track
https://example.com/track.mp3`;

    const result = parsePlaylist(content);
    expect(result.format).toBe("m3u");
  });

  test("defaults to M3U for plain URL list", () => {
    const content = "https://example.com/track.mp3";

    const result = parsePlaylist(content);
    expect(result.format).toBe("m3u");
    expect(result.tracks).toHaveLength(1);
  });

  test("handles content with leading whitespace", () => {
    const content = `  [playlist]
File1=https://example.com/track.mp3`;

    const result = parsePlaylist(content);
    expect(result.format).toBe("pls");
  });
});
