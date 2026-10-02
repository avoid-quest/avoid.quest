import { describe, expect, mock, test } from "bun:test";
import { createExternalPlatformSearchWorkflow } from "./search";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createExternalPlatformSearchWorkflow", () => {
  test("interleaves all-platform results and reports provider failures", async () => {
    const reportProviderError = mock(() => undefined);
    const bandcampSearch = mock(async () => [
      {
        artist: "Bandcamp Artist",
        id: "bc-1",
        title: "Bandcamp Track",
        type: "track" as const,
        url: "https://artist.bandcamp.com/track/one",
      },
    ]);
    const youtubeSearch = mock(async () => [
      {
        author: "YouTube Artist",
        title: "YouTube Track",
        videoId: "yt1",
      },
    ]);
    const workflow = createExternalPlatformSearchWorkflow({
      adapters: {
        bandcamp: { search: bandcampSearch },
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
        youtube: { search: youtubeSearch },
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
    expect(results[0]).toMatchObject({ id: "bc-bc-1" });
    expect(results[1]).toMatchObject({ artist: "Tokyo, Japan" });
    expect(results[2]).toMatchObject({
      url: "https://youtube.com/watch?v=yt1",
    });
    expect(bandcampSearch).toHaveBeenCalledWith("ambient", "t");
    expect(youtubeSearch).toHaveBeenCalledWith("ambient", "songs");
    expect(reportProviderError).toHaveBeenCalledWith(
      "soundcloud",
      expect.any(Error)
    );
  });

  test("can append all-platform results by provider completion order", async () => {
    const workflow = createExternalPlatformSearchWorkflow({
      adapters: {
        bandcamp: {
          search: mock(async () => {
            await wait(10);
            return [
              {
                artist: "Bandcamp Artist",
                id: "bc-1",
                title: "Bandcamp Track",
                type: "track" as const,
                url: "https://artist.bandcamp.com/track/one",
              },
            ];
          }),
        },
        radiogarden: { search: mock(async () => []) },
        soundcloud: { search: mock(async () => []) },
        youtube: {
          search: mock(async () => {
            await wait(1);
            return [
              {
                author: "YouTube Artist",
                title: "YouTube Track",
                videoId: "yt1",
              },
            ];
          }),
        },
      },
      allProviderResultsMode: "append-by-completion",
      allProviderSearchParams: {
        bandcamp: { bandcampFilter: "" },
      },
    });

    const results = await workflow.search({
      platform: "all",
      query: "ambient",
    });

    expect(results.map((result) => result.platform)).toEqual([
      "youtube",
      "bandcamp",
    ]);
  });

  test("searches Mixcloud only when an adapter is configured", async () => {
    const emptyAdapters = {
      bandcamp: { search: mock(async () => []) },
      radiogarden: { search: mock(async () => []) },
      soundcloud: { search: mock(async () => []) },
      youtube: { search: mock(async () => []) },
    };
    const withoutMixcloud = createExternalPlatformSearchWorkflow({
      adapters: emptyAdapters,
    });
    await expect(
      withoutMixcloud.search({ platform: "all", query: "jazz" })
    ).resolves.toEqual([]);
    await expect(
      withoutMixcloud.search({ platform: "mixcloud", query: "jazz" })
    ).rejects.toThrow("Mixcloud search is not configured");

    const mixcloudSearch = mock(async () => [
      {
        artist: "dholbach",
        duration: 3723,
        id: "dholbach/cryptkeeper",
        title: "Cryptkeeper",
        url: "https://www.mixcloud.com/dholbach/cryptkeeper/",
      },
    ]);
    const withMixcloud = createExternalPlatformSearchWorkflow({
      adapters: { ...emptyAdapters, mixcloud: { search: mixcloudSearch } },
    });
    await expect(
      withMixcloud.search({ platform: "all", query: "jazz" })
    ).resolves.toEqual([
      {
        artist: "dholbach",
        duration: 3723,
        id: "mc-dholbach/cryptkeeper",
        platform: "mixcloud",
        thumbnail: undefined,
        title: "Cryptkeeper",
        type: "show",
        url: "https://www.mixcloud.com/dholbach/cryptkeeper/",
      },
    ]);
    expect(mixcloudSearch).toHaveBeenCalledWith("jazz");
  });
});
