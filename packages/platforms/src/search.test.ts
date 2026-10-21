import { describe, expect, mock, test } from "bun:test";
import { createExternalPlatformSearchWorkflow } from "./search";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createExternalPlatformSearchWorkflow", () => {
  test("reports a selected provider failure once and preserves the caller's error", async () => {
    const error = new Error("YouTube unavailable");
    const reportProviderError = mock(() => undefined);
    const workflow = createExternalPlatformSearchWorkflow({
      adapters: {
        bandcamp: { search: mock(async () => []) },
        radiogarden: { search: mock(async () => []) },
        soundcloud: { search: mock(async () => []) },
        youtube: { search: mock(() => Promise.reject(error)) },
      },
      reportProviderError,
    });

    await expect(
      workflow.search({ platform: "youtube", query: "ambient" })
    ).rejects.toBe(error);
    expect(reportProviderError).toHaveBeenCalledTimes(1);
    expect(reportProviderError).toHaveBeenCalledWith("youtube", error);
  });

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
    expect(bandcampSearch).toHaveBeenCalledWith("ambient", "t", undefined);
    expect(youtubeSearch).toHaveBeenCalledWith("ambient", "songs", undefined);
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
            // A timer turn runs after every pending promise callback, so the
            // immediate YouTube results always land first.
            await wait(0);
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
          search: mock(async () => [
            {
              author: "YouTube Artist",
              title: "YouTube Track",
              videoId: "yt1",
            },
          ]),
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
    expect(mixcloudSearch).toHaveBeenCalledWith("jazz", undefined);
  });

  describe("abort signal", () => {
    function never(): Promise<never> {
      return new Promise(() => undefined);
    }

    function setup(mode?: "append-by-completion" | "interleave") {
      const signals: Record<string, AbortSignal | undefined> = {};
      const reportProviderError = mock(() => undefined);
      const adapters = {
        // Ignores its signal, so the workflow itself must stop waiting.
        bandcamp: {
          search: mock(
            (_query: string, _filter: string, signal?: AbortSignal) => {
              signals.bandcamp = signal;
              return never();
            }
          ),
        },
        mixcloud: {
          search: mock((_query: string, signal?: AbortSignal) => {
            signals.mixcloud = signal;
            return never();
          }),
        },
        radiogarden: {
          search: mock((_query: string, signal?: AbortSignal) => {
            signals.radiogarden = signal;
            return Promise.resolve([]);
          }),
        },
        // Fails like fetch does once its request is aborted.
        soundcloud: {
          search: mock((_query: string, signal?: AbortSignal) => {
            signals.soundcloud = signal;
            return new Promise<never>((_, reject) => {
              signal?.addEventListener("abort", () =>
                reject(new TypeError("Failed to fetch"))
              );
            });
          }),
        },
        youtube: {
          search: mock(
            (_query: string, _filter: string, signal?: AbortSignal) => {
              signals.youtube = signal;
              return never();
            }
          ),
        },
      };
      const workflow = createExternalPlatformSearchWorkflow({
        adapters,
        allProviderResultsMode: mode,
        reportProviderError,
      });
      const calls = () =>
        Object.values(adapters).reduce(
          (total, adapter) => total + adapter.search.mock.calls.length,
          0
        );
      return { calls, reportProviderError, signals, workflow };
    }

    test("starts no provider request for an already aborted search", async () => {
      const { calls, reportProviderError, workflow } = setup();
      const controller = new AbortController();
      controller.abort();

      await expect(
        workflow.search(
          { platform: "all", query: "ambient" },
          controller.signal
        )
      ).rejects.toBe(controller.signal.reason);
      await expect(
        workflow.search(
          { platform: "soundcloud", query: "ambient" },
          controller.signal
        )
      ).rejects.toBe(controller.signal.reason);
      expect(calls()).toBe(0);
      expect(reportProviderError).not.toHaveBeenCalled();
    });

    for (const mode of ["interleave", "append-by-completion"] as const) {
      test(`${mode}: aborting stops waiting on every provider without reporting failures`, async () => {
        const { reportProviderError, signals, workflow } = setup(mode);
        const controller = new AbortController();
        const pending = workflow.search(
          { platform: "all", query: "ambient" },
          controller.signal
        );
        await wait(0);
        controller.abort();

        await expect(pending).rejects.toBe(controller.signal.reason);
        expect(signals).toEqual({
          bandcamp: controller.signal,
          mixcloud: controller.signal,
          radiogarden: controller.signal,
          soundcloud: controller.signal,
          youtube: controller.signal,
        });
        expect(reportProviderError).not.toHaveBeenCalled();
      });
    }

    test("an aborted single-provider search rejects as aborted, not as a provider failure", async () => {
      const { reportProviderError, signals, workflow } = setup();
      const controller = new AbortController();
      const pending = workflow.search(
        { platform: "soundcloud", query: "ambient" },
        controller.signal
      );
      await wait(0);
      controller.abort();

      await expect(pending).rejects.toBe(controller.signal.reason);
      expect(signals.soundcloud).toBe(controller.signal);
      await wait(0);
      expect(reportProviderError).not.toHaveBeenCalled();
    });

    test("an aborted search no longer waits for a provider that ignores the signal", async () => {
      const { signals, workflow } = setup();
      const controller = new AbortController();
      const pending = workflow.search(
        { platform: "bandcamp", query: "ambient" },
        controller.signal
      );
      await wait(0);
      controller.abort();

      await expect(pending).rejects.toBe(controller.signal.reason);
      expect(signals.bandcamp).toBe(controller.signal);
    });
  });
});
