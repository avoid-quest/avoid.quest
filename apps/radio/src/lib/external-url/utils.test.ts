import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import {
  createPlatformRadio,
  getPlatformItemTypeLabel,
  PlatformModeError,
  validateRadioForMode,
} from "./utils";

const youtube: Radio = {
  id: "yt-1",
  name: "A video",
  platformMetadata: {
    itemType: "video",
    platform: "youtube",
    url: "https://www.youtube.com/watch?v=abc",
    videoId: "abc",
  },
  streamUrl: "https://media.example/abc.m4a",
};

const station: Radio = {
  id: "kexp",
  name: "KEXP",
  streamUrl: "https://kexp.example/live.mp3",
};

describe("validateRadioForMode", () => {
  test("Single still refuses a platform track", () => {
    expect(() => validateRadioForMode(youtube, "single")).toThrow(
      PlatformModeError
    );
  });

  test("Single refuses Spotify and Mixcloud tracks too", () => {
    const spotify = createPlatformRadio("https://media.example/a.webm", {
      itemType: "track",
      platform: "spotify",
      spotifyId: "2Foc5Q5nqNiosCNqttzHof",
      url: "https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof",
    });
    const mixcloud = createPlatformRadio(
      "https://aod.mixcloud.stream/a/index.m3u8",
      {
        itemType: "show",
        platform: "mixcloud",
        url: "https://www.mixcloud.com/user/show/",
      }
    );
    expect(() => validateRadioForMode(spotify, "single")).toThrow(
      "Spotify tracks play in DJ and Node modes"
    );
    expect(() => validateRadioForMode(mixcloud, "single")).toThrow(
      "Mixcloud tracks play in DJ and Node modes"
    );
  });

  test("DJ and Node play a platform track", () => {
    expect(() => validateRadioForMode(youtube, "dj")).not.toThrow();
    expect(() => validateRadioForMode(youtube, "node")).not.toThrow();
  });

  test("a live station plays in every mode", () => {
    for (const mode of ["single", "dj", "node"] as const) {
      expect(() => validateRadioForMode(station, mode)).not.toThrow();
    }
  });
});

describe("createPlatformRadio", () => {
  test("names and describes Spotify and Mixcloud items", () => {
    const album = createPlatformRadio("https://media.example/a.webm", {
      artist: "Daft Punk",
      artwork: "https://i.scdn.co/image/cover",
      itemType: "album",
      name: "Discovery",
      platform: "spotify",
      spotifyId: "2noRn2Aes5aoNVsU6iWThc",
      url: "https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc",
    });
    expect(album).toMatchObject({
      description: "Daft Punk",
      logoUrl: "https://i.scdn.co/image/cover",
      name: "Discovery",
    });
    const show = createPlatformRadio("https://aod.mixcloud.stream/a.m3u8", {
      itemType: "show",
      name: "Cryptkeeper",
      platform: "mixcloud",
      url: "https://www.mixcloud.com/dholbach/cryptkeeper/",
    });
    expect(show.description).toBe("Mixcloud Show");
    if (!(album.platformMetadata && show.platformMetadata)) {
      throw new Error("Expected platform metadata");
    }
    expect(getPlatformItemTypeLabel(album.platformMetadata)).toBe("Album");
    expect(getPlatformItemTypeLabel(show.platformMetadata)).toBe("Show");
  });
});
