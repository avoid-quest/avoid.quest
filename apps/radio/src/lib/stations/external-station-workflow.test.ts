import { describe, expect, mock, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import type { RadioRecord } from "@/lib/collections";
import {
  createStationIntake,
  findLiveStation,
  isSameStation,
  type StationIntakeDependencies,
} from "./external-station-workflow";

function createHarness(options?: {
  adapters?: StationIntakeDependencies["adapters"];
  saved?: RadioRecord[];
  session?: Radio[];
}) {
  const saved = [...(options?.saved ?? [])];
  const session = [...(options?.session ?? [])];
  const addSaved = mock((radio: Omit<RadioRecord, "id">) => {
    const id = `saved-${saved.length + 1}`;
    saved.push({ id, ...radio });
    return id;
  });
  const updateSaved = mock(
    (id: string, updates: Partial<Omit<RadioRecord, "id" | "order">>) => {
      const radio = saved.find((candidate) => candidate.id === id);
      if (radio) {
        Object.assign(radio, updates);
      }
    }
  );
  const addSession = mock((radio: Radio) => {
    const index = session.findIndex((candidate) => candidate.id === radio.id);
    if (index === -1) {
      session.unshift(radio);
    } else {
      session[index] = radio;
    }
  });
  const removeSession = mock((id: string | number) => {
    const index = session.findIndex((radio) => radio.id === id);
    if (index !== -1) {
      session.splice(index, 1);
    }
  });

  return {
    addSaved,
    addSession,
    intake: createStationIntake({
      adapters: options?.adapters ?? {},
      saved: {
        add: addSaved,
        getAll: () => saved,
        update: updateSaved,
      },
      session: {
        add: addSession,
        getAll: () => session,
        remove: removeSession,
      },
    }),
    removeSession,
    saved,
    session,
  };
}

describe("createStationIntake", () => {
  test("rejects invalid candidates without changing Saved or Session stations", async () => {
    const harness = createHarness();

    const result = await harness.intake.prepare({
      fields: {
        name: "   ",
        streamUrl: "not a URL",
      },
      origin: "manual",
    });

    expect(result).toMatchObject({
      error: {
        code: "INVALID_STATION_CANDIDATE",
        message: "Name and Stream URL are required",
      },
      ok: false,
    });
    expect(harness.saved).toEqual([]);
    expect(harness.session).toEqual([]);
  });

  test("rejects malformed stream URLs", async () => {
    const harness = createHarness();

    const result = await harness.intake.prepare({
      fields: {
        name: "Invalid stream",
        streamUrl: "not a URL",
      },
      origin: "website",
    });

    expect(result).toMatchObject({
      error: {
        code: "INVALID_STATION_CANDIDATE",
        message: "Stream URL must be a valid URL",
      },
      ok: false,
    });
  });

  test("creates a normalized Session station from unified discovery", async () => {
    const harness = createHarness();

    const result = await harness.intake.createSession({
      origin: "discovery",
      radio: {
        description: "  Local station  ",
        id: "rb_station-1",
        name: "  Browser Radio  ",
        platformMetadata: {
          hls: false,
          itemType: "station",
          platform: "radio-browser",
          stationUuid: " station-1 ",
          url: " https://radio.example/live ",
        },
        streamUrl: " https://cdn.radio.example/live.mp3 ",
      },
    });

    expect(result).toEqual({
      data: {
        radio: {
          description: "Local station",
          enabled: true,
          id: "rb_station-1",
          isSystem: false,
          name: "Browser Radio",
          platformMetadata: {
            hls: false,
            itemType: "station",
            platform: "radio-browser",
            stationUuid: "station-1",
            url: "https://radio.example/live",
          },
          streamUrl: "https://cdn.radio.example/live.mp3",
        },
      },
      ok: true,
    });
    if (result.ok) {
      expect(harness.session).toEqual([result.data.radio]);
    }
    expect(harness.saved).toEqual([]);
  });

  test("replaces a Session station with the same provider identity", async () => {
    const harness = createHarness({
      session: [
        {
          id: "rb_station-1",
          name: "Old name",
          platformMetadata: {
            hls: false,
            itemType: "station",
            platform: "radio-browser",
            stationUuid: "station-1",
            url: "https://radio.example/live",
          },
          streamUrl: "https://cdn.radio.example/old.mp3",
        },
      ],
    });

    await harness.intake.createSession({
      origin: "discovery",
      radio: {
        id: "caller-provided-id",
        name: "Fresh name",
        platformMetadata: {
          hls: false,
          itemType: "station",
          platform: "radio-browser",
          stationUuid: "station-1",
          url: "https://radio.example/live",
        },
        streamUrl: "https://cdn.radio.example/new.mp3",
      },
    });

    expect(harness.session).toHaveLength(1);
    expect(harness.session[0]).toMatchObject({
      id: "rb_station-1",
      name: "Fresh name",
      streamUrl: "https://cdn.radio.example/new.mp3",
    });
  });

  test("reports cleanup pending when Session replacement commits but stale cleanup fails", async () => {
    const staleSession = {
      id: "rb_stale",
      name: "Stale Session station",
      streamUrl: "https://radio.example/shared-stream",
    };
    const replacement = {
      id: "rg_replacement",
      name: "Replacement Session station",
      streamUrl: staleSession.streamUrl,
    };
    const harness = createHarness({ session: [staleSession] });
    harness.removeSession.mockImplementationOnce(() => {
      throw new Error("Session cleanup unavailable");
    });

    const result = await harness.intake.createSession({
      origin: "discovery",
      radio: replacement,
    });

    expect(result).toEqual({
      data: {
        radio: expect.objectContaining({ id: "rg_replacement" }),
        sessionCleanupPending: true,
      },
      ok: true,
    });
    expect(harness.session).toHaveLength(2);
    expect(harness.session).toContainEqual(
      expect.objectContaining({ id: "rg_replacement" })
    );
    expect(harness.session).toContainEqual(staleSession);
  });

  test("retries stale Session cleanup when the committed replacement is newest", async () => {
    const staleSession = {
      id: "rb_stale",
      name: "Stale Session station",
      streamUrl: "https://radio.example/shared-stream",
    };
    const replacement = {
      id: "rg_replacement",
      name: "Replacement Session station",
      streamUrl: staleSession.streamUrl,
    };
    const harness = createHarness({ session: [staleSession] });
    harness.removeSession.mockImplementationOnce(() => {
      throw new Error("Session cleanup unavailable");
    });

    const first = await harness.intake.createSession({
      origin: "discovery",
      radio: replacement,
    });
    const second = await harness.intake.createSession({
      origin: "discovery",
      radio: replacement,
    });

    expect(first).toEqual({
      data: {
        radio: expect.any(Object),
        sessionCleanupPending: true,
      },
      ok: true,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.data.sessionCleanupPending).toBeUndefined();
    }
    expect(harness.session).toEqual([
      expect.objectContaining({ id: "rg_replacement" }),
    ]);
    expect(harness.addSession).toHaveBeenCalledTimes(2);
    expect(harness.removeSession).toHaveBeenCalledTimes(2);
  });

  test("removes every matching Session station after saving", async () => {
    const staleSession = {
      id: "rb_stale",
      name: "Stale Session station",
      streamUrl: "https://radio.example/shared-stream",
    };
    const replacement = {
      id: "rg_replacement",
      name: "Replacement Session station",
      streamUrl: staleSession.streamUrl,
    };
    const harness = createHarness({ session: [staleSession] });
    harness.removeSession.mockImplementationOnce(() => {
      throw new Error("Session cleanup unavailable");
    });

    const created = await harness.intake.createSession({
      origin: "discovery",
      radio: replacement,
    });
    const saved = await harness.intake.save({
      origin: "discovery",
      radio: replacement,
    });

    expect(created).toEqual({
      data: {
        radio: expect.any(Object),
        sessionCleanupPending: true,
      },
      ok: true,
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.data.sessionCleanupPending).toBeUndefined();
    }
    expect(harness.session).toEqual([]);
  });

  test("saves a normalized Station at the next Saved station order", async () => {
    const harness = createHarness({
      saved: [
        {
          enabled: true,
          id: "saved-1",
          isSystem: false,
          name: "First",
          order: 2,
          streamUrl: "https://radio.example/first",
        },
        {
          enabled: true,
          id: "saved-2",
          isSystem: false,
          name: "Second",
          order: 6,
          streamUrl: "https://radio.example/second",
        },
      ],
    });

    const result = await harness.intake.save({
      fields: {
        description: "  New station  ",
        name: "  New Radio  ",
        streamUrl: " https://radio.example/new ",
      },
      origin: "manual",
    });

    expect(result).toEqual({
      data: {
        order: 7,
        radio: {
          description: "New station",
          enabled: true,
          id: "saved-3",
          isSystem: false,
          name: "New Radio",
          streamUrl: "https://radio.example/new",
        },
      },
      ok: true,
    });
    expect(harness.saved.at(-1)).toMatchObject({
      name: "New Radio",
      order: 7,
      streamUrl: "https://radio.example/new",
    });
  });

  test("makes repeated saves idempotent by normalized stream identity", async () => {
    const harness = createHarness();

    await harness.intake.save({
      fields: {
        name: "First name",
        streamUrl: "https://radio.example/live/",
      },
      origin: "manual",
    });
    await harness.intake.save({
      fields: {
        name: "Repeated name",
        streamUrl: "https://radio.example/live/#now-playing",
      },
      origin: "website",
    });

    expect(harness.addSaved).toHaveBeenCalledTimes(1);
    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0]?.name).toBe("First name");
  });

  test("re-enables a disabled Saved station when saving the same station", async () => {
    const harness = createHarness({
      saved: [
        {
          enabled: false,
          id: "saved-disabled",
          isSystem: false,
          name: "Disabled station",
          order: 3,
          streamUrl: "https://radio.example/disabled",
        },
      ],
    });

    const result = await harness.intake.save({
      fields: {
        name: "Disabled station",
        streamUrl: "https://radio.example/disabled",
      },
      origin: "manual",
    });

    expect(result).toEqual({
      data: {
        order: 3,
        radio: expect.objectContaining({
          enabled: true,
          id: "saved-disabled",
        }),
      },
      ok: true,
    });
    expect(harness.saved[0]?.enabled).toBe(true);
  });

  test("refreshes a Saved provider station when its resolved stream changes", async () => {
    const harness = createHarness({
      saved: [
        {
          enabled: true,
          id: "saved-provider",
          isSystem: false,
          name: "Custom saved name",
          order: 4,
          platformMetadata: {
            hls: false,
            itemType: "station",
            platform: "radio-browser",
            stationUuid: "station-1",
            url: "https://radio.example/canonical",
          },
          streamFormat: "progressive",
          streamUrl: "https://radio.example/old-stream",
        },
      ],
    });

    const result = await harness.intake.save({
      origin: "discovery",
      radio: {
        id: "rb_station-1",
        name: "Directory name",
        platformMetadata: {
          hls: true,
          itemType: "station",
          platform: "radio-browser",
          stationUuid: "station-1",
          url: "https://radio.example/canonical",
        },
        streamFormat: "hls",
        streamUrl: "https://radio.example/new-stream",
      },
    });

    expect(result).toEqual({
      data: {
        order: 4,
        radio: expect.objectContaining({
          id: "saved-provider",
          name: "Custom saved name",
          streamFormat: "hls",
          streamUrl: "https://radio.example/new-stream",
        }),
      },
      ok: true,
    });
    expect(harness.saved[0]).toMatchObject({
      id: "saved-provider",
      name: "Custom saved name",
      order: 4,
      streamFormat: "hls",
      streamUrl: "https://radio.example/new-stream",
    });
  });

  test("promotes the matching Session station and removes it after saving", async () => {
    const harness = createHarness({
      saved: [
        {
          enabled: true,
          id: "saved-1",
          isSystem: false,
          name: "Saved",
          order: 4,
          streamUrl: "https://radio.example/saved",
        },
      ],
      session: [
        {
          id: "rb_station-1",
          name: "Fresh Session station",
          platformMetadata: {
            hls: false,
            itemType: "station",
            platform: "radio-browser",
            stationUuid: "station-1",
            url: "https://radio.example/canonical",
          },
          streamUrl: "https://radio.example/fresh",
        },
      ],
    });

    const result = await harness.intake.save({
      origin: "discovery",
      radio: {
        id: "rb_station-1",
        name: "Directory result",
        platformMetadata: {
          hls: false,
          itemType: "station",
          platform: "radio-browser",
          stationUuid: "station-1",
          url: "https://radio.example/canonical",
        },
        streamUrl: "https://radio.example/stale",
      },
    });

    expect(result.ok).toBe(true);
    expect(harness.saved.at(-1)).toMatchObject({
      name: "Fresh Session station",
      order: 5,
      streamUrl: "https://radio.example/fresh",
    });
    expect(harness.session).toEqual([]);
    expect(harness.removeSession).toHaveBeenCalledWith("rb_station-1");
  });

  test("preserves submitted fields when saving over a matching Session station", async () => {
    const harness = createHarness({
      session: [
        {
          description: "Old description",
          id: "session-station",
          logoUrl: "https://radio.example/old.png",
          name: "Old Session name",
          streamUrl: "https://radio.example/shared",
          websiteUrl: "https://radio.example/old",
        },
      ],
    });

    const result = await harness.intake.save({
      fields: {
        description: "Submitted description",
        logoUrl: "https://radio.example/submitted.png",
        name: "Submitted name",
        streamUrl: "https://radio.example/shared",
        websiteUrl: "https://radio.example/submitted",
      },
      origin: "manual",
    });

    expect(result).toEqual({
      data: {
        order: 1,
        radio: expect.objectContaining({
          description: "Submitted description",
          logoUrl: "https://radio.example/submitted.png",
          name: "Submitted name",
          websiteUrl: "https://radio.example/submitted",
        }),
      },
      ok: true,
    });
    expect(harness.saved[0]).toMatchObject({
      description: "Submitted description",
      logoUrl: "https://radio.example/submitted.png",
      name: "Submitted name",
      websiteUrl: "https://radio.example/submitted",
    });
    expect(harness.session).toEqual([]);
  });

  test("resolves and prepares a Radio Garden candidate", async () => {
    const resolveStream = mock(() =>
      Promise.resolve({
        data: {
          format: "hls" as const,
          streamUrl: " https://stream.example/live ",
        },
        ok: true as const,
      })
    );
    const harness = createHarness({
      adapters: { radioGarden: { resolveStream } },
    });

    const result = await harness.intake.prepare({
      name: "  Edited Garden  ",
      origin: "radio-garden",
      result: {
        channelId: "garden-1",
        countryTitle: "Italy",
        placeTitle: "Rome",
        subtitle: "Live",
        title: "Garden",
        url: "https://radio.garden/listen/garden/garden-1",
        website: "https://garden.example",
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.radio).toMatchObject({
        id: "rg_garden-1",
        name: "Edited Garden",
        streamFormat: "hls",
        streamUrl: "https://stream.example/live",
      });
    }
    expect(resolveStream).toHaveBeenCalledWith(
      "garden-1",
      "https://radio.garden/listen/garden/garden-1"
    );
  });

  test("prepares an already resolved Radio Garden candidate without resolving again", async () => {
    const resolveStream = mock(() =>
      Promise.reject(new Error("the resolved stream should be reused"))
    );
    const harness = createHarness({
      adapters: { radioGarden: { resolveStream } },
    });

    const result = await harness.intake.prepare({
      origin: "radio-garden",
      resolved: {
        format: "progressive",
        streamUrl: " https://stream.example/probed ",
      },
      result: {
        channelId: "garden-1",
        countryTitle: "Italy",
        placeTitle: "Rome",
        subtitle: "Live",
        title: "Garden",
        url: "https://radio.garden/listen/garden/garden-1",
        website: "https://garden.example",
      },
    });

    expect(result).toEqual({
      data: {
        radio: expect.objectContaining({
          id: "rg_garden-1",
          streamFormat: "progressive",
          streamUrl: "https://stream.example/probed",
        }),
      },
      ok: true,
    });
    expect(resolveStream).not.toHaveBeenCalled();
  });

  test("promotes a matching Radio Garden Session stream without resolving again", async () => {
    const sessionRadio = {
      id: "rg_garden-1",
      name: "Session Garden",
      platformMetadata: {
        channelId: "garden-1",
        itemType: "channel" as const,
        platform: "radiogarden" as const,
        url: "https://radio.garden/listen/garden/garden-1",
      },
      streamFormat: "hls" as const,
      streamUrl: "https://stream.example/session",
    };
    const resolveStream = mock(() =>
      Promise.reject(new Error("Radio Garden is unavailable"))
    );
    const harness = createHarness({
      adapters: { radioGarden: { resolveStream } },
      session: [sessionRadio],
    });

    const result = await harness.intake.save({
      name: "Edited Garden",
      origin: "radio-garden",
      result: {
        channelId: "garden-1",
        countryTitle: "Italy",
        placeTitle: "Rome",
        subtitle: "Live",
        title: "Garden",
        url: "https://radio.garden/listen/garden/garden-1",
        website: "https://garden.example",
      },
    });

    expect(result).toEqual({
      data: {
        order: 1,
        radio: expect.objectContaining({
          name: "Edited Garden",
          streamFormat: "hls",
          streamUrl: "https://stream.example/session",
        }),
      },
      ok: true,
    });
    expect(resolveStream).not.toHaveBeenCalled();
    expect(harness.session).toEqual([]);
  });

  test("prepares a Radio Browser candidate with canonical identity", async () => {
    const harness = createHarness();

    const result = await harness.intake.prepare({
      origin: "radio-browser",
      station: {
        bitrate: 192,
        codec: "MP3",
        country: " Italy ",
        favicon: " https://radio.example/logo.png ",
        hls: false,
        homepage: " https://radio.example ",
        lastCheckOk: true,
        lastCheckTime: "2026-08-24T00:00:00Z",
        name: " Browser Radio ",
        state: " Lazio ",
        stationUuid: " station-1 ",
        tags: ["electronic"],
        url: " https://radio.example/live ",
        urlResolved: " https://cdn.radio.example/live.mp3 ",
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.radio).toMatchObject({
        id: "rb_station-1",
        name: "Browser Radio",
        // Kept for the channel strip's stream details.
        platformMetadata: { bitrate: 192, codec: "MP3" },
        streamUrl: "https://cdn.radio.example/live.mp3",
      });
    }
  });

  test("keeps the Session station when promotion cannot save", async () => {
    const sessionRadio = {
      id: "rg_garden-1",
      name: "Garden",
      platformMetadata: {
        channelId: "garden-1",
        itemType: "channel" as const,
        platform: "radiogarden" as const,
        url: "https://radio.garden/listen/garden/garden-1",
      },
      streamUrl: "https://stream.example/live",
    };
    const harness = createHarness({ session: [sessionRadio] });
    harness.addSaved.mockImplementationOnce(() => {
      throw new Error("Storage unavailable");
    });

    const result = await harness.intake.save({
      origin: "discovery",
      radio: sessionRadio,
    });

    expect(result).toMatchObject({
      error: {
        code: "SAVED_STATION_SAVE_FAILED",
        message: "Storage unavailable",
      },
      ok: false,
    });
    expect(harness.session).toEqual([sessionRadio]);
    expect(harness.removeSession).not.toHaveBeenCalled();
  });

  test("reports cleanup pending after a new Saved station commits", async () => {
    const sessionRadio = {
      id: "rg_cleanup-pending",
      name: "Cleanup pending",
      streamUrl: "https://stream.example/cleanup-pending",
    };
    const harness = createHarness({ session: [sessionRadio] });
    harness.removeSession.mockImplementationOnce(() => {
      throw new Error("Session storage unavailable");
    });

    const result = await harness.intake.save({
      origin: "discovery",
      radio: sessionRadio,
    });

    expect(result).toEqual({
      data: {
        order: 1,
        radio: expect.objectContaining({
          id: "saved-1",
          name: "Cleanup pending",
        }),
        sessionCleanupPending: true,
      },
      ok: true,
    });
    expect(harness.saved).toHaveLength(1);
    expect(harness.session).toEqual([sessionRadio]);
  });

  test("retries pending cleanup on repeated save without duplicating the Saved station", async () => {
    const sessionRadio = {
      id: "rg_retry-cleanup",
      name: "Retry cleanup",
      streamUrl: "https://stream.example/retry-cleanup",
    };
    const harness = createHarness({ session: [sessionRadio] });
    harness.removeSession.mockImplementationOnce(() => {
      throw new Error("Session storage unavailable");
    });

    const first = await harness.intake.save({
      origin: "discovery",
      radio: sessionRadio,
    });
    const second = await harness.intake.save({
      origin: "discovery",
      radio: sessionRadio,
    });

    expect(first).toEqual({
      data: {
        order: 1,
        radio: expect.any(Object),
        sessionCleanupPending: true,
      },
      ok: true,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.data.sessionCleanupPending).toBeUndefined();
    }
    expect(harness.addSaved).toHaveBeenCalledTimes(1);
    expect(harness.saved).toHaveLength(1);
    expect(harness.session).toEqual([]);
    expect(harness.removeSession).toHaveBeenCalledTimes(2);
  });

  test("reports cleanup pending when the Saved station already exists", async () => {
    const sessionRadio = {
      id: "rg_existing-cleanup",
      name: "Existing cleanup",
      streamUrl: "https://stream.example/existing-cleanup",
    };
    const harness = createHarness({
      saved: [
        {
          enabled: true,
          id: "saved-existing",
          isSystem: false,
          name: "Already saved",
          order: 8,
          streamUrl: sessionRadio.streamUrl,
        },
      ],
      session: [sessionRadio],
    });
    harness.removeSession.mockImplementationOnce(() => {
      throw new Error("Session storage unavailable");
    });

    const result = await harness.intake.save({
      origin: "discovery",
      radio: sessionRadio,
    });

    expect(result).toEqual({
      data: {
        order: 8,
        radio: expect.objectContaining({ id: "saved-existing" }),
        sessionCleanupPending: true,
      },
      ok: true,
    });
    expect(harness.addSaved).not.toHaveBeenCalled();
    expect(harness.session).toEqual([sessionRadio]);
  });

  test("returns the Saved record id when promoting a discovered Session station", async () => {
    const sessionRadio = {
      id: "rb_station-1",
      name: "Browser Radio",
      platformMetadata: {
        hls: false,
        itemType: "station" as const,
        platform: "radio-browser" as const,
        stationUuid: "station-1",
        url: "https://radio.example/canonical",
      },
      streamUrl: "https://radio.example/live",
    };
    const harness = createHarness({ session: [sessionRadio] });

    const result = await harness.intake.save({
      origin: "discovery",
      radio: sessionRadio,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.radio.id).toBe("saved-1");
      expect(harness.saved.map((radio) => radio.id)).toEqual(["saved-1"]);
    }
    expect(harness.session).toEqual([]);
  });
});

describe("findLiveStation", () => {
  const stored = {
    id: "rb_station-1",
    name: "Old name",
    platformMetadata: {
      hls: false,
      itemType: "station" as const,
      platform: "radio-browser" as const,
      stationUuid: "station-1",
      url: "https://radio.example/canonical",
    },
    streamUrl: "https://radio.example/live",
  };

  test("prefers the record with the same id", () => {
    const renamed = { ...stored, name: "New name" };
    const other = { ...stored, id: "saved-1" };

    expect(findLiveStation([other, renamed], stored)).toBe(renamed);
  });

  test("falls back to another record of the same Station", () => {
    const saved = {
      ...stored,
      id: "saved-1",
      streamUrl: "https://radio.example/live/",
    };

    expect(findLiveStation([saved], stored)).toBe(saved);
    expect(isSameStation(stored, saved)).toBe(true);
  });

  test("finds nothing once the Station is gone", () => {
    const unrelated = {
      id: "saved-2",
      name: "Unrelated",
      streamUrl: "https://radio.example/other",
    };

    expect(findLiveStation([unrelated], stored)).toBeUndefined();
    expect(isSameStation(stored, unrelated)).toBe(false);
  });
});
