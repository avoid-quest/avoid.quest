import { expect, test } from "bun:test";
import type { StaticAudioMetadata } from "@/lib/platform-types";
import { installBrowser } from "./fake-media-browser.js";
import { assertSupportedRadioGraph } from "./playback-source-factory.js";
import type { Radio } from "./types.js";

const safari = "AppleWebKit/605.1.15 Version/27.0 Safari/605.1.15";
const station: Radio = {
  name: "Radio",
  streamUrl: "https://radio.example/live.mp3",
};
const fileMetadata: StaticAudioMetadata = {
  displayName: "Track",
  duration: 180,
  fileName: "track.mp3",
  fileSize: 1024,
  isLocal: false,
  itemType: "track",
  mimeType: "audio/mpeg",
  platform: "static-audio",
  streamUrl: station.streamUrl,
  url: station.streamUrl,
};
const file: Radio = { ...station, platformMetadata: fileMetadata };
// Provider metadata marks an HLS track whatever its URL says.
const playlist: Radio = {
  ...station,
  platformMetadata: {
    ...fileMetadata,
    tracks: [{ format: "hls", streamUrl: station.streamUrl, title: "Track" }],
  },
};

test.each([
  [safari, station, true],
  ["AppleWebKit/605.1.15 CriOS/139.0 Mobile/15E148", station, true],
  ["AppleWebKit/537.36 Chrome/139.0", station, false],
  ["Gecko/20100101 Firefox/140.0", station, false],
  [safari, { ...file, streamFormat: "hls" }, true],
  [
    safari,
    {
      ...station,
      platformMetadata: {
        itemType: "track",
        platform: "soundcloud",
        url: "https://soundcloud.com/artist/track",
      },
      streamFormat: "hls",
    },
    true,
  ],
  [
    safari,
    {
      ...station,
      platformMetadata: {
        itemType: "show",
        platform: "mixcloud",
        url: "https://www.mixcloud.com/artist/show/",
      },
      streamUrl: "https://aod.mixcloud.stream/show/index.m3u8",
    },
    true,
  ],
  [safari, { ...file, streamUrl: "https://radio.example/live.m3u8" }, true],
  [safari, playlist, true],
  [safari, file, false],
] as const)("%s / %j blocked=%s", (userAgent, radio, blocked) => {
  const browser = installBrowser();
  Object.defineProperty(navigator, "userAgent", { value: userAgent });
  try {
    const assert = () => assertSupportedRadioGraph(radio);
    if (blocked) {
      expect(assert).toThrow("Safari plays live radio and HLS only in Single");
    } else {
      expect(assert).not.toThrow();
    }
  } finally {
    browser.restore();
  }
});

test.each([
  [station, "media", false],
  [file, "station", false],
  [
    {
      ...station,
      platformMetadata: {
        itemType: "track",
        platform: "bandcamp",
        url: "https://artist.bandcamp.com/track/song",
      },
    },
    "station",
    false,
  ],
  [
    {
      ...station,
      platformMetadata: {
        hls: false,
        itemType: "station",
        platform: "radio-browser",
        stationUuid: "station",
        url: station.streamUrl,
      },
    },
    "media",
    true,
  ],
  [{ ...station, streamFormat: "hls" }, "media", true],
  [playlist, "media", true],
] as const)(
  "Safari honors known source provenance %j / %s blocked=%s",
  (radio, sourceKind, blocked) => {
    const browser = installBrowser();
    Object.defineProperty(navigator, "userAgent", { value: safari });
    try {
      const assert = () => assertSupportedRadioGraph(radio, sourceKind);
      if (blocked) {
        expect(assert).toThrow(
          "Safari plays live radio and HLS only in Single"
        );
      } else {
        expect(assert).not.toThrow();
      }
    } finally {
      browser.restore();
    }
  }
);
