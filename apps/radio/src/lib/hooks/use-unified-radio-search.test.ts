import { describe, expect, test } from "bun:test";
import type { RadioBrowserStation } from "@avoid.quest/platforms/radiobrowser";
import type { Radio } from "@/lib/audio";
import { mergeUnifiedRadioResults } from "./use-unified-radio-search";

function radioBrowserStation(
  overrides: Partial<RadioBrowserStation> = {}
): RadioBrowserStation {
  return {
    bitrate: 192,
    codec: "MP3",
    country: "Italy",
    favicon: "",
    homepage: "https://www.fangoradio.com",
    hls: false,
    lastCheckOk: true,
    lastCheckTime: "2026-07-28T00:00:00Z",
    name: "Fango Radio",
    state: "Italy",
    stationUuid: "fango-1",
    tags: ["independent"],
    url: "https://pantano.ovh:8444/pantano",
    urlResolved: "https://pantano.ovh:8444/pantano",
    ...overrides,
  };
}

function radioGardenRadio(overrides: Partial<Radio> = {}): Radio {
  return {
    countryTitle: "Italy",
    description: "Pistoia, Italy",
    id: "rg_3qF-CmzK",
    name: "Fango Radio",
    placeTitle: "Pistoia",
    streamUrl: "https://pantano.ovh:8444/pantano",
    ...overrides,
  };
}

describe("mergeUnifiedRadioResults", () => {
  test("merges duplicate directory entries and prefers the playable Radio Browser action", () => {
    const radioBrowserResults = Array.from({ length: 4 }, (_, index) =>
      radioBrowserStation({ stationUuid: `fango-${index}` })
    );

    const result = mergeUnifiedRadioResults({
      localRadios: [],
      query: "fango radio",
      radioBrowserResults,
      radioGardenResults: [radioGardenRadio()],
    });

    expect(result.duplicateCount).toBe(4);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.action.type).toBe("radio-browser");
    expect(result.results[0]?.sources).toEqual([
      "radio-browser",
      "radio-garden",
    ]);
  });

  test("keeps a collection station as the action when a directory also returns it", () => {
    const localRadio: Radio = {
      countryTitle: "Italy",
      enabled: true,
      id: "saved-fango",
      name: "Fango Radio",
      streamUrl: "https://pantano.ovh:8444/pantano",
    };

    const result = mergeUnifiedRadioResults({
      localRadios: [localRadio],
      query: "fango",
      radioBrowserResults: [radioBrowserStation()],
      radioGardenResults: [],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.action).toEqual({
      radio: localRadio,
      type: "local",
    });
    expect(result.results[0]?.sources).toEqual(["local", "radio-browser"]);
  });

  test("keeps same-named stations with different streams when identity is incomplete", () => {
    const result = mergeUnifiedRadioResults({
      localRadios: [
        {
          id: "network-one",
          name: "Network Radio",
          streamUrl: "https://audio.example/network-one",
        },
        {
          id: "network-two",
          name: "Network Radio",
          streamUrl: "https://audio.example/network-two",
        },
      ],
      query: "network",
      radioBrowserResults: [],
      radioGardenResults: [],
    });

    expect(result.duplicateCount).toBe(0);
    expect(result.results).toHaveLength(2);
  });

  test("merges distinct provider entries with matching name and location", () => {
    const result = mergeUnifiedRadioResults({
      localRadios: [],
      query: "city radio",
      radioBrowserResults: [
        radioBrowserStation({
          country: "Italy",
          name: "City Radio",
          state: "Rome",
          url: "https://audio.example/city-rb",
          urlResolved: "https://audio.example/city-rb",
        }),
      ],
      radioGardenResults: [
        radioGardenRadio({
          countryTitle: "Italy",
          id: "rg_city",
          name: "City Radio",
          placeTitle: "Rome",
          streamUrl: "https://audio.example/city-rg",
        }),
      ],
    });

    expect(result.duplicateCount).toBe(1);
    expect(result.results).toHaveLength(1);
  });

  test("drops provider fuzzy matches when exact significant terms exist", () => {
    const result = mergeUnifiedRadioResults({
      localRadios: [],
      query: "fango radio",
      radioBrowserResults: [radioBrowserStation()],
      radioGardenResults: [
        radioGardenRadio({
          id: "rg_fano",
          name: "Radio Fano FM 101.1",
          placeTitle: "Fano",
          streamUrl: "https://audio.example/fano",
        }),
        radioGardenRadio({
          countryTitle: "United States",
          id: "rg_fargo",
          name: "The Eagle 106.9 FM",
          placeTitle: "Fargo ND",
          streamUrl: "https://audio.example/fargo",
        }),
      ],
    });

    expect(result.results.map((entry) => entry.name)).toEqual(["Fango Radio"]);
  });

  test("does not replace an unavailable exact station with fuzzy alternatives", () => {
    const result = mergeUnifiedRadioResults({
      localRadios: [],
      query: "radio fano fm 101.1",
      radioBrowserResults: [],
      radioGardenResults: [
        radioGardenRadio({
          id: "rg_fan",
          name: "Radio FAN FM 103.9",
          placeTitle: "Buenos Aires",
          streamUrl: "https://audio.example/fan",
        }),
      ],
    });

    expect(result.results).toEqual([]);
  });
});
