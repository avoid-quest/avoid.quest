import { describe, expect, mock, test } from "bun:test";
import { createExternalPlatformSearchWorkflow } from "./external-platform-search-workflow";

describe("createExternalPlatformSearchWorkflow", () => {
  test("returns successful provider results when one all-platform provider fails", async () => {
    const reportProviderError = mock(() => undefined);
    const workflow = createExternalPlatformSearchWorkflow({
      adapters: {
        bandcamp: {
          search: mock(async () => [
            {
              artist: "Bandcamp Artist",
              id: "bc-1",
              title: "Bandcamp Track",
              type: "track" as const,
              url: "https://artist.bandcamp.com/track/one",
            },
          ]),
        },
        radiogarden: {
          search: mock(async () => [
            {
              channelId: "rg1",
              countryTitle: "Japan",
              placeTitle: "Tokyo",
              subtitle: "Live",
              title: "Garden Radio",
              url: "https://radio.garden/listen/garden/rg1",
            },
          ]),
        },
        soundcloud: {
          search: mock(() =>
            Promise.reject(new Error("SoundCloud unavailable"))
          ),
        },
        youtube: {
          search: mock(async () => [
            {
              author: "YouTube Artist",
              title: "YouTube Track",
              videoId: "yt1",
            },
          ]),
        },
      },
      reportProviderError,
    });

    const results = await workflow.search({
      platform: "all",
      query: "ambient",
    });

    expect(results.map((result) => result.platform)).toEqual([
      "bandcamp",
      "radiogarden",
      "youtube",
    ]);
    expect(results[0]).toMatchObject({
      id: "bc-bc-1",
      title: "Bandcamp Track",
    });
    expect(results[1]).toMatchObject({
      artist: "Tokyo, Japan",
      id: "rg-rg1",
    });
    expect(results[2]).toMatchObject({
      id: "yt-yt1",
      url: "https://youtube.com/watch?v=yt1",
    });
    expect(reportProviderError).toHaveBeenCalledWith(
      "soundcloud",
      expect.any(Error)
    );
  });

  test("passes provider-specific filters to individual provider searches", async () => {
    const bandcampSearch = mock(async () => []);
    const youtubeSearch = mock(async () => []);
    const workflow = createExternalPlatformSearchWorkflow({
      adapters: {
        bandcamp: { search: bandcampSearch },
        radiogarden: { search: mock(async () => []) },
        soundcloud: { search: mock(async () => []) },
        youtube: { search: youtubeSearch },
      },
    });

    await workflow.search({
      bandcampFilter: "a",
      platform: "bandcamp",
      query: " albums ",
    });
    await workflow.search({
      platform: "youtube",
      query: "videos",
      youtubeFilter: "videos",
    });

    expect(bandcampSearch).toHaveBeenCalledWith("albums", "a");
    expect(youtubeSearch).toHaveBeenCalledWith("videos", "videos");
  });

  test("uses all-platform default filters for providers that support filters", async () => {
    const bandcampSearch = mock(async () => []);
    const youtubeSearch = mock(async () => []);
    const workflow = createExternalPlatformSearchWorkflow({
      adapters: {
        bandcamp: { search: bandcampSearch },
        radiogarden: { search: mock(async () => []) },
        soundcloud: { search: mock(async () => []) },
        youtube: { search: youtubeSearch },
      },
    });

    await workflow.search({
      bandcampFilter: "a",
      platform: "all",
      query: " all platforms ",
      youtubeFilter: "videos",
    });

    expect(bandcampSearch).toHaveBeenCalledWith("all platforms", "t");
    expect(youtubeSearch).toHaveBeenCalledWith("all platforms", "songs");
  });

  test("interleaves all-platform results by provider and appends overflow", async () => {
    const workflow = createExternalPlatformSearchWorkflow({
      adapters: {
        bandcamp: {
          search: mock(async () =>
            Array.from({ length: 9 }, (_, index) => ({
              artist: "Bandcamp Artist",
              id: `bc-${index}`,
              title: `Bandcamp ${index}`,
              type: "track" as const,
              url: `https://bandcamp.example/${index}`,
            }))
          ),
        },
        radiogarden: {
          search: mock(async () => [
            {
              channelId: "rg1",
              countryTitle: "Japan",
              placeTitle: "Tokyo",
              subtitle: "Live",
              title: "Garden Radio",
              url: "https://radio.garden/listen/garden/rg1",
            },
          ]),
        },
        soundcloud: {
          search: mock(async () => [
            {
              artist: "Cloud Artist",
              duration: 120,
              id: "sc1",
              title: "Cloud Track",
              url: "https://soundcloud.com/cloud/track",
            },
          ]),
        },
        youtube: {
          search: mock(async () => [
            {
              author: "Video Artist",
              title: "Video Track",
              videoId: "yt1",
            },
          ]),
        },
      },
    });

    const results = await workflow.search({
      platform: "all",
      query: "ambient",
    });

    expect(results.slice(0, 4).map((result) => result.platform)).toEqual([
      "bandcamp",
      "radiogarden",
      "soundcloud",
      "youtube",
    ]);
    expect(results.at(-1)).toMatchObject({
      id: "bc-bc-8",
      platform: "bandcamp",
    });
  });
});
