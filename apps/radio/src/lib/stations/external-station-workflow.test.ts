import { describe, expect, mock, test } from "bun:test";
import { createExternalStationResolutionWorkflow } from "./external-station-workflow";

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
