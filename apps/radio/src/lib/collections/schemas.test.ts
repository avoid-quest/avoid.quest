import { describe, expect, test } from "bun:test";
import { platformMetadataSchema } from "./schemas";

describe("platformMetadataSchema", () => {
  test("keeps a saved Spotify album and Mixcloud show", () => {
    const spotify = {
      itemType: "album",
      platform: "spotify",
      spotifyId: "2noRn2Aes5aoNVsU6iWThc",
      tracks: [
        {
          name: "Aerodynamic",
          spotifyId: "1NeLwFETswx8Fzxl2AFl91",
          streamUrl: "spotify:track:1NeLwFETswx8Fzxl2AFl91",
        },
      ],
      url: "https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc",
    };
    const mixcloud = {
      artist: "dholbach",
      itemType: "show",
      platform: "mixcloud",
      url: "https://www.mixcloud.com/dholbach/cryptkeeper/",
    };
    expect(platformMetadataSchema.parse(spotify) as unknown).toEqual(spotify);
    expect(platformMetadataSchema.parse(mixcloud) as unknown).toEqual(mixcloud);
  });

  test("still reads a tab-sharing Spotify source saved before", () => {
    const shared = {
      capture: "display",
      channelCount: 2,
      channelSelection: { left: 0, right: 1 },
      deviceId: "display",
      deviceLabel: "Spotify",
      itemType: "track",
      platform: "device-input",
      sourceUrl: "https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof",
      url: "",
    };
    expect(platformMetadataSchema.parse(shared) as unknown).toEqual(shared);
  });

  test("rejects a Spotify item without its id", () => {
    expect(
      platformMetadataSchema.safeParse({
        itemType: "track",
        platform: "spotify",
        url: "https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof",
      }).success
    ).toBe(false);
  });
});
