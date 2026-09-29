import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import { findNextTrack } from "./dj-actions-playlist";

const tracks = [
  { streamUrl: "https://radio.example/1.mp3", title: "One" },
  { streamUrl: "https://radio.example/2.mp3", title: "Two" },
  { streamUrl: "https://radio.example/3.mp3", title: "Three" },
];

function tracklist(platform: string, itemType: string): Radio {
  return {
    id: `${platform}-${itemType}`,
    name: "Tracklist",
    platformMetadata: {
      itemType,
      platform,
      tracks,
      url: `https://${platform}.example/list`,
    } as Radio["platformMetadata"],
    streamUrl: "https://radio.example/2.mp3",
  };
}

describe("findNextTrack", () => {
  test("continues Bandcamp artist and SoundCloud user tracklists", () => {
    for (const [platform, itemType] of [
      ["bandcamp", "artist"],
      ["soundcloud", "user"],
      ["bandcamp", "album"],
    ] as const) {
      expect(findNextTrack(tracklist(platform, itemType))).toMatchObject({
        streamUrl: "https://radio.example/3.mp3",
      });
    }
  });

  test("stops after a single track", () => {
    expect(findNextTrack(tracklist("soundcloud", "track"))).toBeNull();
  });
});
