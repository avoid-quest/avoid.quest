import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import {
  createStationDiscovery,
  type StationDiscoveryCandidate,
  type StationDiscoverySnapshot,
} from "./station-discovery";

const SEARCH_DELAY_MS = 320;

function radio(
  name: string,
  streamUrl = `https://audio.example/${name.toLocaleLowerCase()}`
): Radio {
  return { name, streamUrl };
}

function candidate(
  source: "radio-browser" | "radio-garden",
  name: string,
  overrides: Partial<StationDiscoveryCandidate> = {}
): StationDiscoveryCandidate {
  return {
    country: "Italy",
    key: `${source}:${name}`,
    location: "Rome",
    radio: radio(name),
    source,
    ...overrides,
  };
}

async function waitForSearch(): Promise<void> {
  await Bun.sleep(SEARCH_DELAY_MS);
}

describe("StationDiscovery", () => {
  test("returns Radio Garden results when Radio Browser fails", async () => {
    const snapshots: StationDiscoverySnapshot[] = [];
    const discovery = createStationDiscovery({
      radioBrowser: {
        search: () => Promise.reject(new Error("Radio Browser unavailable")),
      },
      radioGarden: {
        search: () =>
          Promise.resolve([candidate("radio-garden", "Garden Radio")]),
      },
      streamProbe: {
        prepare: (entry) => Promise.resolve(entry),
      },
    });

    discovery.search({ knownStations: [], query: "garden" }, (snapshot) =>
      snapshots.push(snapshot)
    );
    await waitForSearch();

    expect(snapshots.at(-1)).toMatchObject({
      duplicateCount: 0,
      isSearching: false,
      results: [
        {
          action: {
            radio: { name: "Garden Radio" },
            type: "radio-garden",
          },
          name: "Garden Radio",
          sources: ["radio-garden"],
        },
      ],
    });
  });

  test("cancels discovery before its debounce starts provider work", async () => {
    const providerQueries: string[] = [];
    const discovery = createStationDiscovery({
      radioBrowser: {
        search: (query) => {
          providerQueries.push(query);
          return Promise.resolve([]);
        },
      },
      radioGarden: {
        search: (query) => {
          providerQueries.push(query);
          return Promise.resolve([]);
        },
      },
      streamProbe: {
        prepare: (entry) => Promise.resolve(entry),
      },
    });

    const cancel = discovery.search(
      { knownStations: [], query: "ambient" },
      () => undefined
    );
    cancel();
    await waitForSearch();

    expect(providerQueries).toEqual([]);
  });

  test("never publishes an older query after a newer query starts", async () => {
    let resolveOlder: (value: StationDiscoveryCandidate[]) => void = () =>
      undefined;
    const snapshots: StationDiscoverySnapshot[] = [];
    const discovery = createStationDiscovery({
      radioBrowser: {
        search: (query) =>
          query === "older"
            ? new Promise((resolve) => {
                resolveOlder = resolve;
              })
            : Promise.resolve([candidate("radio-browser", "Newer Radio")]),
      },
      radioGarden: { search: () => Promise.resolve([]) },
      streamProbe: {
        prepare: (entry) => Promise.resolve(entry),
      },
    });

    discovery.search({ knownStations: [], query: "older" }, (snapshot) =>
      snapshots.push(snapshot)
    );
    await waitForSearch();
    discovery.search({ knownStations: [], query: "newer" }, (snapshot) =>
      snapshots.push(snapshot)
    );
    await waitForSearch();
    resolveOlder([candidate("radio-browser", "Older Radio")]);
    await Promise.resolve();

    expect(snapshots.at(-1)?.results.map((result) => result.name)).toEqual([
      "Newer Radio",
    ]);
    expect(
      snapshots.flatMap((snapshot) =>
        snapshot.results.map((result) => result.name)
      )
    ).not.toContain("Older Radio");
  });

  test("keeps known Stations while buffering and resumes remote discovery when healthy", async () => {
    const providerQueries: string[] = [];
    const snapshots: StationDiscoverySnapshot[] = [];
    const discovery = createStationDiscovery({
      radioBrowser: {
        search: (query) => {
          providerQueries.push(query);
          return Promise.resolve([
            candidate("radio-browser", "Rome Directory Radio"),
          ]);
        },
      },
      radioGarden: { search: () => Promise.resolve([]) },
      streamProbe: {
        prepare: (entry) => Promise.resolve(entry),
      },
    });
    const knownStation = radio("Rome Saved Radio");

    discovery.search(
      {
        knownStations: [knownStation],
        playbackNeedsNetwork: true,
        query: "rome",
      },
      (snapshot) => snapshots.push(snapshot)
    );
    await waitForSearch();

    expect(providerQueries).toEqual([]);
    expect(snapshots.at(-1)).toMatchObject({
      isSearching: false,
      results: [{ action: { radio: knownStation, type: "local" } }],
    });

    discovery.search(
      {
        knownStations: [knownStation],
        playbackNeedsNetwork: false,
        query: "rome",
      },
      (snapshot) => snapshots.push(snapshot)
    );
    await waitForSearch();

    expect(providerQueries).toEqual(["rome"]);
    expect(snapshots.at(-1)?.results.map((result) => result.name)).toEqual([
      "Rome Saved Radio",
      "Rome Directory Radio",
    ]);
  });

  test("shares a two-probe limit across Radio Browser and Radio Garden", async () => {
    let activeProbes = 0;
    let peakActiveProbes = 0;
    const discovery = createStationDiscovery({
      radioBrowser: {
        search: () =>
          Promise.resolve(
            Array.from({ length: 4 }, (_, index) =>
              candidate("radio-browser", `Browser Radio ${index}`)
            )
          ),
      },
      radioGarden: {
        search: () =>
          Promise.resolve(
            Array.from({ length: 4 }, (_, index) =>
              candidate("radio-garden", `Garden Radio ${index}`)
            )
          ),
      },
      streamProbe: {
        prepare: async (entry) => {
          activeProbes += 1;
          peakActiveProbes = Math.max(peakActiveProbes, activeProbes);
          await Bun.sleep(5);
          activeProbes -= 1;
          return entry;
        },
      },
    });

    discovery.search({ knownStations: [], query: "radio" }, () => undefined);
    await waitForSearch();
    await Bun.sleep(30);

    expect(peakActiveProbes).toBe(2);
  });

  test("drops unsafe and unreadable streams before publishing results", async () => {
    const probedNames: string[] = [];
    const snapshots: StationDiscoverySnapshot[] = [];
    const discovery = createStationDiscovery({
      radioBrowser: {
        search: () =>
          Promise.resolve([
            candidate("radio-browser", "Safe Radio"),
            candidate("radio-browser", "HTTP Radio", {
              radio: radio("HTTP Radio", "http://audio.example/live"),
            }),
            candidate("radio-browser", "Credential Radio", {
              radio: radio(
                "Credential Radio",
                "https://user:password@audio.example/live"
              ),
            }),
            candidate("radio-browser", "Unreadable Radio"),
          ]),
      },
      radioGarden: { search: () => Promise.resolve([]) },
      streamProbe: {
        prepare: (entry) => {
          probedNames.push(entry.radio.name);
          return entry.radio.name === "Unreadable Radio"
            ? Promise.reject(new TypeError("CORS blocked"))
            : Promise.resolve(entry);
        },
      },
    });

    discovery.search({ knownStations: [], query: "radio" }, (snapshot) =>
      snapshots.push(snapshot)
    );
    await waitForSearch();

    expect(probedNames).toEqual(["Safe Radio", "Unreadable Radio"]);
    expect(snapshots.at(-1)?.results.map((result) => result.name)).toEqual([
      "Safe Radio",
    ]);
  });

  test("keeps stable source ordering and applies relevance before the result limit", async () => {
    const snapshots: StationDiscoverySnapshot[] = [];
    const discovery = createStationDiscovery({
      radioBrowser: {
        search: () =>
          Promise.resolve(
            Array.from({ length: 5 }, (_, index) =>
              candidate("radio-browser", `Fango Browser Radio ${index}`)
            )
          ),
      },
      radioGarden: {
        search: () =>
          Promise.resolve([
            candidate("radio-garden", "Fano Radio"),
            ...Array.from({ length: 5 }, (_, index) =>
              candidate("radio-garden", `Fango Garden Radio ${index}`)
            ),
          ]),
      },
      streamProbe: {
        prepare: (entry) => Promise.resolve(entry),
      },
    });

    discovery.search(
      {
        knownStations: [radio("Fango Saved Radio")],
        query: "fango radio",
      },
      (snapshot) => snapshots.push(snapshot)
    );
    await waitForSearch();

    expect(snapshots.at(-1)?.results.map((result) => result.name)).toEqual([
      "Fango Saved Radio",
      "Fango Browser Radio 0",
      "Fango Browser Radio 1",
      "Fango Browser Radio 2",
      "Fango Browser Radio 3",
      "Fango Browser Radio 4",
      "Fango Garden Radio 0",
      "Fango Garden Radio 1",
    ]);
  });

  test("deduplicates Station identity while preserving provenance and action priority", async () => {
    const snapshots: StationDiscoverySnapshot[] = [];
    const savedStation = radio("Saved Radio", "https://audio.example/shared/");
    const discovery = createStationDiscovery({
      radioBrowser: {
        search: () =>
          Promise.resolve([
            candidate("radio-browser", "Browser Copy Radio", {
              radio: radio(
                "Browser Copy Radio",
                "https://audio.example/shared#now"
              ),
            }),
            candidate("radio-browser", "City Radio", {
              key: "radio-browser:city",
              radio: radio("City Radio", "https://audio.example/city-rb"),
            }),
          ]),
      },
      radioGarden: {
        search: () =>
          Promise.resolve([
            candidate("radio-garden", "City Radio", {
              key: "radio-garden:city",
              radio: radio("City Radio", "https://audio.example/city-rg"),
            }),
          ]),
      },
      streamProbe: {
        prepare: (entry) => Promise.resolve(entry),
      },
    });

    discovery.search(
      { knownStations: [savedStation], query: "radio" },
      (snapshot) => snapshots.push(snapshot)
    );
    await waitForSearch();

    expect(snapshots.at(-1)).toMatchObject({
      duplicateCount: 2,
      results: [
        {
          action: { radio: savedStation, type: "local" },
          sources: ["local", "radio-browser"],
        },
        {
          action: { type: "radio-browser" },
          name: "City Radio",
          sources: ["radio-browser", "radio-garden"],
        },
      ],
    });
  });

  test("releases shared probe capacity when canceled probes ignore their signals", async () => {
    const snapshots: StationDiscoverySnapshot[] = [];
    const discovery = createStationDiscovery({
      radioBrowser: {
        search: (query) =>
          Promise.resolve(
            query === "older"
              ? [
                  candidate("radio-browser", "Older Radio 1"),
                  candidate("radio-browser", "Older Radio 2"),
                ]
              : [candidate("radio-browser", "Newer Radio")]
          ),
      },
      radioGarden: { search: () => Promise.resolve([]) },
      streamProbe: {
        prepare: (entry) =>
          entry.radio.name.startsWith("Older")
            ? new Promise(() => undefined)
            : Promise.resolve(entry),
      },
    });

    discovery.search({ knownStations: [], query: "older" }, () => undefined);
    await waitForSearch();
    discovery.search({ knownStations: [], query: "newer" }, (snapshot) =>
      snapshots.push(snapshot)
    );
    await waitForSearch();
    await Promise.resolve();

    expect(snapshots.at(-1)?.results.map((result) => result.name)).toEqual([
      "Newer Radio",
    ]);
  });
});
