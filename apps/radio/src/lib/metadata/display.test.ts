import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import {
  formatNowPlaying,
  formatRadioDocumentTitle,
  getMediaSessionText,
} from "./display";
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

  test("falls back from empty metadata title to the station name", () => {
    const radio: Radio = {
      name: "Station",
      streamUrl: "https://example.com/radio.mp3",
    };

    expect(
      formatRadioDocumentTitle({
        radio,
        isPlaying: true,
        metadata: nowPlaying({ artist: "Artist", title: "" }),
      })
    ).toBe("Station — radio.avoid.quest");
    expect(
      getMediaSessionText({
        radio,
        metadata: nowPlaying({ artist: null, title: "" }),
      }).title
    ).toBe("Station");
  });

  test("uses station context before repeating the station name as artist", () => {
    const radio: Radio = {
      name: "Station",
      streamUrl: "https://example.com/radio.mp3",
      description: "Independent radio",
      placeTitle: "Torino",
    };

    expect(getMediaSessionText({ radio, metadata: null })).toEqual({
      title: "Station",
      artist: "Independent radio",
    });
  });
});
