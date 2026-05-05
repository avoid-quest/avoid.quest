import { describe, expect, mock, test } from "bun:test";
import {
  createExternalStationResolutionWorkflow,
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

describe("createExternalStationResolutionWorkflow", () => {
  test("resolves Radio Garden results into session-only radios", async () => {
    const sessionRadios: unknown[] = [];
    const workflow = createExternalStationResolutionWorkflow({
      adapters: {
        radioGarden: {
          resolveStream: mock(() =>
            Promise.resolve({
              ok: true as const,
              data: { streamUrl: "https://stream.example/garden.mp3" },
            })
          ),
        },
      },
      collection: {
        addSavedRadio: mock(() => undefined),
        getSavedRadios: () => [],
      },
      session: {
        addSessionRadio: (radio) => sessionRadios.push(radio),
        getSessionRadios: () => [],
        removeSessionRadio: mock(() => undefined),
      },
    });

    const result = await workflow.resolveRadioGardenToSession({
      channelId: "rg1",
      title: " Garden Radio ",
      subtitle: "Live",
      url: "https://radio.garden/listen/garden/rg1",
      placeTitle: "Tokyo",
      countryTitle: "Japan",
      website: " https://radio.example ",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.radio).toMatchObject({
        id: "rg_rg1",
        name: "Garden Radio",
        streamUrl: "https://stream.example/garden.mp3",
      });
    }
    expect(sessionRadios).toHaveLength(1);
  });

  test("saves existing session-only Radio Garden radios with ordering and cleanup", async () => {
    const saved: unknown[] = [];
    const removed: unknown[] = [];
    const sessionRadio = {
      id: "rg_rg1",
      name: " Session Garden ",
      streamUrl: " https://stream.example/garden.mp3 ",
      description: " ",
      enabled: true,
      platformMetadata: {
        platform: "radiogarden" as const,
        itemType: "channel" as const,
        url: " https://radio.garden/listen/garden/rg1 ",
        channelId: "rg1",
        name: " Session Garden ",
        subtitle: " ",
        placeTitle: " Tokyo ",
        countryTitle: " Japan ",
        website: " ",
      },
    };
    const workflow = createExternalStationResolutionWorkflow({
      adapters: {
        radioGarden: {
          resolveStream: mock(() =>
            Promise.reject(new Error("radio garden should not resolve again"))
          ),
        },
      },
      collection: {
        addSavedRadio: (radio) => saved.push(radio),
        getSavedRadios: () => [{ order: 2 }, { order: 6 }],
      },
      session: {
        addSessionRadio: mock(() => undefined),
        getSessionRadios: () => [sessionRadio],
        removeSessionRadio: (id) => removed.push(id),
      },
    });

    const result = await workflow.resolveRadioGardenToCollection({
      channelId: "rg1",
      title: "Garden Radio",
      subtitle: "Live",
      url: "https://radio.garden/listen/garden/rg1",
      placeTitle: "Tokyo",
      countryTitle: "Japan",
      website: "https://radio.example",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        order: 7,
        radio: sessionRadio,
        removedSessionRadioId: "rg_rg1",
      },
    });
    expect(saved).toEqual([
      {
        countryTitle: undefined,
        description: undefined,
        enabled: true,
        isSystem: false,
        logoUrl: undefined,
        name: "Session Garden",
        order: 7,
        placeTitle: undefined,
        platformMetadata: {
          platform: "radiogarden",
          itemType: "channel",
          url: "https://radio.garden/listen/garden/rg1",
          channelId: "rg1",
          name: "Session Garden",
          placeTitle: "Tokyo",
          countryTitle: "Japan",
        },
        streamUrl: "https://stream.example/garden.mp3",
        websiteUrl: undefined,
      },
    ]);
    expect(removed).toEqual(["rg_rg1"]);
  });

  test("resolves Radio Garden results directly into saved radios when no session radio exists", async () => {
    const saved: unknown[] = [];
    const workflow = createExternalStationResolutionWorkflow({
      adapters: {
        radioGarden: {
          resolveStream: mock(() =>
            Promise.resolve({
              ok: true as const,
              data: { streamUrl: "https://stream.example/garden.mp3" },
            })
          ),
        },
      },
      collection: {
        addSavedRadio: (radio) => saved.push(radio),
        getSavedRadios: () => [{ order: 4 }],
      },
      session: {
        addSessionRadio: mock(() => undefined),
        getSessionRadios: () => [],
        removeSessionRadio: mock(() => undefined),
      },
    });

    const result = await workflow.resolveRadioGardenToCollection(
      {
        channelId: "rg1",
        title: "Garden Radio",
        subtitle: "Live",
        url: "https://radio.garden/listen/garden/rg1",
        placeTitle: "Tokyo",
        countryTitle: "Japan",
        website: "https://radio.example",
      },
      { name: " Saved Garden " }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.order).toBe(5);
      expect(result.data.removedSessionRadioId).toBeUndefined();
    }
    expect(saved).toHaveLength(1);
  });

  test("resolves platform URLs into playable radios and preserves provider failures", async () => {
    const workflow = createExternalStationResolutionWorkflow({
      adapters: {
        platform: {
          resolve: mock((url: string) => {
            if (url.includes("missing")) {
              return Promise.resolve({
                ok: false as const,
                error: {
                  code: "PLATFORM_ITEM_LOAD_FAILED",
                  message: "Failed to load platform item",
                },
              });
            }
            return Promise.resolve({
              ok: true as const,
              data: {
                streamUrl: "https://stream.example/track.mp3",
                metadata: {
                  platform: "soundcloud" as const,
                  itemType: "track" as const,
                  url,
                  name: "Example Track",
                  artist: "Example Artist",
                },
              },
            });
          }),
        },
      },
      collection: {
        addSavedRadio: mock(() => undefined),
        getSavedRadios: () => [],
      },
    });

    const loaded = await workflow.resolvePlatformUrl(
      " https://soundcloud.com/example/track "
    );
    const failed = await workflow.resolvePlatformUrl(
      "https://soundcloud.com/missing"
    );

    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.data.radio.name).toBe("Example Track");
      expect(loaded.data.radio.platformMetadata?.platform).toBe("soundcloud");
    }
    expect(failed).toEqual({
      ok: false,
      error: {
        code: "PLATFORM_ITEM_LOAD_FAILED",
        message: "Failed to load platform item",
      },
    });
  });

  test("saveRadioToCollection removes a session radio when the workflow has session cleanup", () => {
    const saved: unknown[] = [];
    const removed: unknown[] = [];
    const workflow = createExternalStationResolutionWorkflow({
      adapters: {},
      collection: {
        addSavedRadio: (radio) => saved.push(radio),
        getSavedRadios: () => [],
      },
      session: {
        addSessionRadio: mock(() => undefined),
        getSessionRadios: () => [],
        removeSessionRadio: (id) => removed.push(id),
      },
    });

    const radio = {
      id: "rg_rg1",
      name: "Garden Radio",
      streamUrl: "https://stream.example/garden.mp3",
    };
    const result = workflow.saveRadioToCollection(radio, {
      removeSessionRadioId: "rg_rg1",
    });

    expect(result).toEqual({
      order: 1,
      radio,
      removedSessionRadioId: "rg_rg1",
    });
    expect(saved).toHaveLength(1);
    expect(removed).toEqual(["rg_rg1"]);
  });
});
