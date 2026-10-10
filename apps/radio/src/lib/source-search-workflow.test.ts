import { expect, mock, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import {
  createStationDiscovery,
  type StationDiscoveryCandidate,
} from "@/lib/stations/station-discovery";
import {
  createSourceSearchWorkflow,
  type SourceSearchResult,
} from "./source-search-workflow";

const radio = (name: string): Radio => ({
  enabled: true,
  name,
  streamUrl: `https://radio.example/${name}`,
});
function setup() {
  const searchPlatform = mock(async ({ platform }: { platform: string }) => [
    {
      artist: platform,
      id: platform,
      platform: platform as "bandcamp",
      title: "Ambient track",
      type: "track" as const,
      url: `https://example.com/${platform}`,
    },
  ]);
  const candidate = (
    source: StationDiscoveryCandidate["source"]
  ): StationDiscoveryCandidate => ({
    key: source,
    radio: radio(`Ambient ${source}`),
    source,
  });
  const radioBrowser = {
    search: mock(async () => [candidate("radio-browser")]),
  };
  const radioGarden = { search: mock(async () => [candidate("radio-garden")]) };
  const streamProbe = {
    prepare: mock(async (value: StationDiscoveryCandidate) => value),
  };
  const workflow = createSourceSearchWorkflow({
    createDiscovery: (platform) =>
      createStationDiscovery({
        radioBrowser:
          platform === "all" || platform === "radio-browser"
            ? radioBrowser
            : { search: async () => [] },
        radioGarden:
          platform === "all" || platform === "radiogarden"
            ? radioGarden
            : { search: async () => [] },
        streamProbe,
      }),
    searchPlatform,
  });
  return { radioBrowser, radioGarden, searchPlatform, streamProbe, workflow };
}

test("All fans out to every searchable source and includes known stations with verified directory radios", async () => {
  const fixture = setup();
  const progress = mock((_results: SourceSearchResult[]) => undefined);
  const saved = radio("Ambient saved");
  const results = await fixture.workflow.search(
    {
      knownStations: [saved],
      onProgress: progress,
      platform: "all",
      query: "Ambient",
    },
    new AbortController().signal
  );
  expect(
    fixture.searchPlatform.mock.calls.map(([params]) => params.platform)
  ).toEqual(["bandcamp", "mixcloud", "soundcloud", "youtube"]);
  expect(fixture.radioBrowser.search).toHaveBeenCalledTimes(1);
  expect(fixture.radioGarden.search).toHaveBeenCalledTimes(1);
  expect(fixture.streamProbe.prepare).toHaveBeenCalledTimes(2);
  expect(new Set(results.map((result) => result.platform))).toEqual(
    new Set([
      "bandcamp",
      "mixcloud",
      "soundcloud",
      "youtube",
      "radiogarden",
      "radio-browser",
      "local",
    ])
  );
  expect(results.find((result) => result.platform === "local")?.radio).toBe(
    saved
  );
  expect(
    progress.mock.calls.some(
      ([partial]) =>
        partial.some((result) => result.platform === "bandcamp") &&
        !partial.some((result) => result.platform === "radio-browser")
    )
  ).toBe(true);
});

test("a directory filter searches only that directory", async () => {
  const fixture = setup();
  const results = await fixture.workflow.search(
    {
      knownStations: [radio("Ambient saved")],
      platform: "radio-browser",
      query: "Ambient",
    },
    new AbortController().signal
  );
  expect(fixture.searchPlatform).not.toHaveBeenCalled();
  expect(fixture.radioGarden.search).not.toHaveBeenCalled();
  expect(results.map((result) => result.platform)).toEqual(["radio-browser"]);
});

test("aborting a search suppresses late platform results and stops directory work", async () => {
  const fixture = setup();
  let finish!: (results: []) => void;
  fixture.searchPlatform.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const controller = new AbortController();
  const progress = mock(() => undefined);
  const pending = fixture.workflow.search(
    { onProgress: progress, platform: "bandcamp", query: "old" },
    controller.signal
  );
  controller.abort();
  finish([]);
  await expect(pending).rejects.toBeDefined();
  expect(progress).not.toHaveBeenCalled();
  expect(fixture.radioBrowser.search).not.toHaveBeenCalled();
});

test("one failing platform preserves other platforms and stations", async () => {
  const fixture = setup();
  const original = fixture.searchPlatform.getMockImplementation();
  if (!original) {
    throw new Error("Missing search implementation");
  }
  fixture.searchPlatform.mockImplementation((params) =>
    params.platform === "bandcamp"
      ? Promise.reject(new Error("offline"))
      : original(params)
  );
  const results = await fixture.workflow.search(
    { platform: "all", query: "Ambient" },
    new AbortController().signal
  );
  expect(results.some((result) => result.platform === "youtube")).toBe(true);
  expect(results.some((result) => result.platform === "radio-browser")).toBe(
    true
  );
});
