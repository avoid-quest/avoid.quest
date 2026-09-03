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
    album: null,
    artworkUrl: null,
    bitrate: null,
    expiresAt: 2,
    genre: null,
    itemUrl: null,
    rawTitle: null,
    sampledAt: 1,
    source: "icy",
    stationDescription: null,
    stationName: null,
    streamUrl: "https://example.com/radio.mp3",
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
        isPlaying: true,
        metadata: nowPlaying({ artist: "Artist", title: "" }),
        radio,
      })
    ).toBe("Station — radio.avoid.quest");
    expect(
      getMediaSessionText({
        metadata: nowPlaying({ artist: null, title: "" }),
        radio,
      }).title
    ).toBe("Station");
  });

  test("uses station context before repeating the station name as artist", () => {
    const radio: Radio = {
      description: "Independent radio",
      name: "Station",
      placeTitle: "Torino",
      streamUrl: "https://example.com/radio.mp3",
    };

    expect(getMediaSessionText({ metadata: null, radio })).toEqual({
      artist: "Independent radio",
      title: "Station",
    });
  });
});
