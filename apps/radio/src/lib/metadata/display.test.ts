import { describe, expect, test } from "bun:test";
import { formatNowPlaying } from "./display";
import type { RadioNowPlaying } from "./types";

function nowPlaying(
  metadata: Pick<RadioNowPlaying, "artist" | "title">
): RadioNowPlaying {
  return {
    streamUrl: "https://example.com/radio.mp3",
    source: "icy",
    rawTitle: null,
    artworkUrl: null,
    stationName: null,
    stationDescription: null,
    genre: null,
    bitrate: null,
    sampledAt: 1,
    expiresAt: 2,
    ...metadata,
  };
}

describe("metadata display formatting", () => {
  test("formats artist and title metadata", () => {
    expect(
      formatNowPlaying(nowPlaying({ artist: "Artist", title: "Title" }))
    ).toBe("Artist - Title");
  });

  test("renders title-only and artist-only metadata", () => {
    expect(formatNowPlaying(nowPlaying({ artist: null, title: "Title" }))).toBe(
      "Title"
    );
    expect(
      formatNowPlaying(nowPlaying({ artist: "Artist", title: null }))
    ).toBe("Artist");
  });
});
