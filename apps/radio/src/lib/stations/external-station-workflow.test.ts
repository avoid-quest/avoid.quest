import { describe, expect, test } from "bun:test";
import {
  createImportedStationRadio,
  createRadioGardenRadio,
  getNextSavedRadioOrder,
  resolvePlatformStation,
  resolveRadioGardenStation,
  saveResolvedStationToCollection,
  toSavedRadioRecord,
} from "./external-station-workflow";

describe("createRadioGardenRadio", () => {
  test("normalizes Radio Garden search results into radios", () => {
    const radio = createRadioGardenRadio(
      {
        channelId: "abc123",
        title: "Radio Garden",
        subtitle: "World Radio",
        url: "https://radio.garden/listen/radio-garden/abc123",
        placeTitle: "Rome",
        countryTitle: "Italy",
        website: "https://radio.example",
      },
      "https://stream.example/live.mp3",
      "Renamed Garden"
    );

    expect(radio).toMatchObject({
      id: "rg_abc123",
      name: "Renamed Garden",
      streamUrl: "https://stream.example/live.mp3",
      websiteUrl: "https://radio.example",
    });
    expect(radio.platformMetadata?.platform).toBe("radiogarden");
  });
});

describe("createImportedStationRadio", () => {
  test("normalizes manual station input into a saved-radio shape", () => {
    expect(
      createImportedStationRadio({
        name: " Test Radio ",
        streamUrl: " https://stream.example/live.mp3 ",
        logoUrl: " https://radio.example/logo.png ",
        description: " Example description ",
        websiteUrl: " https://radio.example ",
      })
    ).toEqual({
      name: "Test Radio",
      streamUrl: "https://stream.example/live.mp3",
      logoUrl: "https://radio.example/logo.png",
      description: "Example description",
      websiteUrl: "https://radio.example",
      enabled: true,
      isSystem: false,
    });
  });
});

describe("saved radio persistence", () => {
  test("computes the next order and persists through the shared collection contract", () => {
    const saved: unknown[] = [];
    const result = saveResolvedStationToCollection(
      {
        id: "rg_station",
        name: "Session Radio",
        streamUrl: "https://stream.example/live.mp3",
        enabled: true,
      },
      {
        addSavedRadio: (radio) => saved.push(radio),
        getSavedRadios: () => [{ order: 1 }, { order: 4 }],
        removeSessionRadio: () => undefined,
      },
      { removeSessionRadioId: "rg_station" }
    );

    expect(getNextSavedRadioOrder([{ order: 1 }, { order: 4 }])).toBe(5);
    expect(saved).toEqual([
      toSavedRadioRecord(
        {
          id: "rg_station",
          name: "Session Radio",
          streamUrl: "https://stream.example/live.mp3",
          enabled: true,
        },
        5
      ),
    ]);
    expect(result.removedSessionRadioId).toBe("rg_station");
  });
});

describe("resolveRadioGardenStation", () => {
  test("returns workflow failures unchanged", async () => {
    const result = await resolveRadioGardenStation(
      {
        channelId: "missing",
        title: "Missing",
        subtitle: "",
        url: "https://radio.garden/listen/missing",
        placeTitle: "Nowhere",
        countryTitle: "Nowhere",
        website: "",
      },
      async () => ({
        ok: false,
        error: {
          code: "RADIO_GARDEN_RESOLVE_FAILED",
          message: "No stream found",
        },
      })
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "RADIO_GARDEN_RESOLVE_FAILED",
        message: "No stream found",
      },
    });
  });
});

describe("resolvePlatformStation", () => {
  test("normalizes loaded platform items into radios", async () => {
    const result = await resolvePlatformStation(
      "https://soundcloud.com/example/track",
      async () => ({
        ok: true,
        data: {
          streamUrl: "https://stream.example/track.mp3",
          metadata: {
            platform: "soundcloud",
            itemType: "track",
            url: "https://soundcloud.com/example/track",
            name: "Example Track",
            artist: "Example Artist",
          },
        },
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("Example Track");
      expect(result.data.platformMetadata?.platform).toBe("soundcloud");
    }
  });
});
