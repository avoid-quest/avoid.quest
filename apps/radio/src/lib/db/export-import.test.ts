import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getSettings,
  radiosCollection,
  settingsCollection,
} from "@/lib/collections";
import {
  mergeImportedData,
  previewImportChanges,
  replaceImportedData,
  validateImportData,
} from "./export-import";

const SETTINGS_ID = "app-settings";

async function resetSettings() {
  await settingsCollection.stateWhenReady();

  for (const settingsId of Array.from(settingsCollection.state.keys())) {
    settingsCollection.delete(settingsId);
  }
}

async function resetRadios() {
  await radiosCollection.stateWhenReady();

  for (const radioId of Array.from(radiosCollection.state.keys())) {
    radiosCollection.delete(radioId);
  }
}

beforeEach(async () => {
  await Promise.all([resetSettings(), resetRadios()]);
});

afterEach(async () => {
  await Promise.all([resetSettings(), resetRadios()]);
});

describe("validateImportData", () => {
  test("accepts version 1 exports and drops legacy playerType", () => {
    const imported = validateImportData({
      version: 1,
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [],
      settings: {
        player: {
          mode: "single",
          playerType: "custom",
          restoreStateOnLoad: false,
          single: { transitionDuration: 3456 },
        },
      },
    });

    expect(imported.version).toBe(1);
    expect(imported.settings.player).toEqual({
      mode: "single",
      restoreStateOnLoad: false,
      single: { transitionDuration: 3456 },
    });
    expect("playerType" in imported.settings.player).toBe(false);
  });

  test("preserves omitted restoreStateOnLoad so merge imports can keep local value", () => {
    const imported = validateImportData({
      version: 1,
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [],
      settings: {
        player: {
          mode: "dj",
        },
      },
    });

    expect(imported.settings.player).toEqual({
      mode: "dj",
      restoreStateOnLoad: undefined,
      single: undefined,
    });
  });

  test("preserves omitted mode so merge imports can keep local value", () => {
    const imported = validateImportData({
      version: 1,
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [],
      settings: {
        player: {
          restoreStateOnLoad: false,
        },
      },
    });

    expect(imported.settings.player.mode).toBeUndefined();
    expect(imported.settings.player.restoreStateOnLoad).toBe(false);
    expect(imported.settings.player.single).toBeUndefined();
  });
});

describe("mergeImportedData", () => {
  test("preserves metadataConfig when a legacy import omits it", async () => {
    await radiosCollection.stateWhenReady();

    radiosCollection.insert({
      id: "radio-1",
      name: "Existing",
      streamUrl: "https://radio.example/original.mp3",
      metadataConfig: {
        kind: "airtime-live-info",
        urls: ["https://radio.example/api/live-info"],
      },
      order: 1,
      enabled: true,
    });

    mergeImportedData({
      version: 1,
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [
        {
          id: "legacy-radio",
          name: "Existing",
          streamUrl: "https://radio.example/replaced.mp3",
        },
      ],
      settings: {
        player: {
          mode: "single",
        },
      },
    });

    expect(radiosCollection.state.get("radio-1")).toMatchObject({
      streamUrl: "https://radio.example/replaced.mp3",
      metadataConfig: {
        kind: "airtime-live-info",
        urls: ["https://radio.example/api/live-info"],
      },
    });
  });

  test("does not overwrite restoreStateOnLoad when the import omits it", async () => {
    await settingsCollection.stateWhenReady();

    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode: "single",
        restoreStateOnLoad: false,
      },
    });

    mergeImportedData({
      version: 1,
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [],
      settings: {
        player: {
          mode: "dj",
        },
      },
    });

    expect(getSettings()?.player).toEqual({
      mode: "dj",
      restoreStateOnLoad: false,
      single: undefined,
    });
  });

  test("does not overwrite mode when the import omits it", async () => {
    await settingsCollection.stateWhenReady();

    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode: "multiple",
        restoreStateOnLoad: true,
      },
    });

    mergeImportedData(
      validateImportData({
        version: 1,
        exportDate: "2026-04-16T00:00:00.000Z",
        radios: [],
        settings: {
          player: {
            restoreStateOnLoad: false,
          },
        },
      })
    );

    expect(getSettings()?.player).toEqual({
      mode: "multiple",
      restoreStateOnLoad: false,
      single: undefined,
    });
  });

  test("imports stream formats for existing and new radios", async () => {
    await radiosCollection.stateWhenReady();

    radiosCollection.insert({
      id: "radio-1",
      name: "Existing",
      streamUrl: "https://radio.example/live",
      streamFormat: "progressive",
      order: 1,
      enabled: true,
    });

    mergeImportedData({
      version: 2,
      exportDate: "2026-07-10T00:00:00.000Z",
      radios: [
        {
          id: "imported-existing",
          name: "Existing",
          streamUrl: "https://radio.example/live",
          streamFormat: "hls",
        },
        {
          id: "imported-new",
          name: "New",
          streamUrl: "https://radio.example/new",
          streamFormat: "hls",
        },
      ],
      settings: { player: { mode: "single" } },
    });

    expect(radiosCollection.state.get("radio-1")?.streamFormat).toBe("hls");
    expect(
      Array.from(radiosCollection.state.values()).find(
        (radio) => radio.name === "New"
      )?.streamFormat
    ).toBe("hls");
  });

  test("keeps an existing stream format when a legacy import omits it", async () => {
    await radiosCollection.stateWhenReady();

    radiosCollection.insert({
      id: "radio-1",
      name: "Existing",
      streamUrl: "https://radio.example/original",
      streamFormat: "hls",
      order: 1,
      enabled: true,
    });

    mergeImportedData({
      version: 1,
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [
        {
          id: "legacy-radio",
          name: "Existing",
          streamUrl: "https://radio.example/replaced",
        },
      ],
      settings: { player: { mode: "single" } },
    });

    expect(radiosCollection.state.get("radio-1")?.streamFormat).toBe("hls");
  });
});

describe("stream format imports", () => {
  test("restores stream formats when replacing radios", async () => {
    await radiosCollection.stateWhenReady();

    replaceImportedData({
      version: 2,
      exportDate: "2026-07-10T00:00:00.000Z",
      radios: [
        {
          id: "radio-1",
          name: "HLS Radio",
          streamUrl: "https://radio.example/live",
          streamFormat: "hls",
        },
      ],
      settings: { player: { mode: "single" } },
    });

    expect(radiosCollection.state.get("radio-1")?.streamFormat).toBe("hls");
  });

  test("previews a stream-format-only update", async () => {
    await radiosCollection.stateWhenReady();

    radiosCollection.insert({
      id: "radio-1",
      name: "Existing",
      streamUrl: "https://radio.example/live",
      streamFormat: "progressive",
      order: 1,
      enabled: true,
    });

    expect(
      previewImportChanges({
        version: 2,
        exportDate: "2026-07-10T00:00:00.000Z",
        radios: [
          {
            id: "imported-radio",
            name: "Existing",
            streamUrl: "https://radio.example/live",
            streamFormat: "hls",
          },
        ],
        settings: { player: { mode: "single" } },
      })
    ).toMatchObject({ updatedRadios: 1, unchangedRadios: 0 });
  });
});
