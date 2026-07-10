import { describe, expect, test } from "bun:test";
import { resolveInitialTrackStreamUrl } from "./dj-initial-stream-resolution";

const unusedDependencies = {
  reportDjError: () => undefined,
  resolvePlatformStreamUrl: () =>
    Promise.reject(new Error("Unexpected platform resolution")),
};

describe("resolveInitialTrackStreamUrl", () => {
  test("preserves Radio Browser HLS metadata for extensionless streams", async () => {
    const streamUrl = "https://radio.example/live";

    await expect(
      resolveInitialTrackStreamUrl(
        "deck-a",
        {
          name: "HLS station",
          platformMetadata: {
            hls: true,
            itemType: "station",
            platform: "radio-browser",
            stationUuid: "station-id",
            url: streamUrl,
          },
          streamUrl,
        },
        streamUrl,
        unusedDependencies
      )
    ).resolves.toEqual({ streamFormat: "hls", streamUrl });
  });
});
