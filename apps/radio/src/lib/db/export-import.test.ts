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
  test("accepts version 1 exports and drops legacy player fields", () => {
    const imported = validateImportData({
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
      version: 1,
    });

    expect(imported.version).toBe(1);
    expect(imported.settings.player).toEqual({
      mode: "single",
      restoreStateOnLoad: false,
    });
    expect("playerType" in imported.settings.player).toBe(false);
    expect("single" in imported.settings.player).toBe(false);
  });

  test("preserves omitted restoreStateOnLoad so merge imports can keep local value", () => {
    const imported = validateImportData({
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [],
      settings: {
        player: {
          mode: "dj",
        },
      },
      version: 1,
    });

    expect(imported.settings.player).toEqual({
      mode: "dj",
      restoreStateOnLoad: undefined,
    });
  });

  test("preserves omitted mode so merge imports can keep local value", () => {
    const imported = validateImportData({
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [],
      settings: {
        player: {
          restoreStateOnLoad: false,
        },
      },
      version: 1,
    });

    expect(imported.settings.player.mode).toBeUndefined();
    expect(imported.settings.player.restoreStateOnLoad).toBe(false);
  });
});

describe("mergeImportedData", () => {
  test("preserves metadataConfig when a legacy import omits it", async () => {
    await radiosCollection.stateWhenReady();

    radiosCollection.insert({
      enabled: true,
      id: "radio-1",
      metadataConfig: {
        kind: "airtime-live-info",
        urls: ["https://radio.example/api/live-info"],
      },
      name: "Existing",
      order: 1,
      streamUrl: "https://radio.example/original.mp3",
    });

    mergeImportedData({
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
      version: 1,
    });

    expect(radiosCollection.state.get("radio-1")).toMatchObject({
      metadataConfig: {
        kind: "airtime-live-info",
        urls: ["https://radio.example/api/live-info"],
      },
      streamUrl: "https://radio.example/replaced.mp3",
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
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [],
      settings: {
        player: {
          mode: "dj",
        },
      },
      version: 1,
    });

    expect(getSettings()?.player).toEqual({
      mode: "dj",
      restoreStateOnLoad: false,
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
        exportDate: "2026-04-16T00:00:00.000Z",
        radios: [],
        settings: {
          player: {
            restoreStateOnLoad: false,
          },
        },
        version: 1,
      })
    );

    expect(getSettings()?.player).toEqual({
      mode: "multiple",
      restoreStateOnLoad: false,
    });
  });

  test("imports stream formats for existing and new radios", async () => {
    await radiosCollection.stateWhenReady();

    radiosCollection.insert({
      enabled: true,
      id: "radio-1",
      name: "Existing",
      order: 1,
      streamFormat: "progressive",
      streamUrl: "https://radio.example/live",
    });

    mergeImportedData({
      exportDate: "2026-07-10T00:00:00.000Z",
      radios: [
        {
          id: "imported-existing",
          name: "Existing",
          streamFormat: "hls",
          streamUrl: "https://radio.example/live",
        },
        {
          id: "imported-new",
          name: "New",
          streamFormat: "hls",
          streamUrl: "https://radio.example/new",
        },
      ],
      settings: { player: { mode: "single" } },
      version: 2,
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
      enabled: true,
      id: "radio-1",
      name: "Existing",
      order: 1,
      streamFormat: "hls",
      streamUrl: "https://radio.example/original",
    });

    mergeImportedData({
      exportDate: "2026-04-16T00:00:00.000Z",
      radios: [
        {
          id: "legacy-radio",
          name: "Existing",
          streamUrl: "https://radio.example/replaced",
        },
      ],
      settings: { player: { mode: "single" } },
      version: 1,
    });

    expect(radiosCollection.state.get("radio-1")?.streamFormat).toBe("hls");
  });
});

describe("stream format imports", () => {
  test("restores stream formats when replacing radios", async () => {
    await radiosCollection.stateWhenReady();

    replaceImportedData({
      exportDate: "2026-07-10T00:00:00.000Z",
      radios: [
        {
          id: "radio-1",
          name: "HLS Radio",
          streamFormat: "hls",
          streamUrl: "https://radio.example/live",
        },
      ],
      settings: { player: { mode: "single" } },
      version: 2,
    });

    expect(radiosCollection.state.get("radio-1")?.streamFormat).toBe("hls");
  });

  test("previews a stream-format-only update", async () => {
    await radiosCollection.stateWhenReady();

    radiosCollection.insert({
      enabled: true,
      id: "radio-1",
      name: "Existing",
      order: 1,
      streamFormat: "progressive",
      streamUrl: "https://radio.example/live",
    });

    expect(
      previewImportChanges({
        exportDate: "2026-07-10T00:00:00.000Z",
        radios: [
          {
            id: "imported-radio",
            name: "Existing",
            streamFormat: "hls",
            streamUrl: "https://radio.example/live",
          },
        ],
        settings: { player: { mode: "single" } },
        version: 2,
      })
    ).toMatchObject({ unchangedRadios: 0, updatedRadios: 1 });
  });
});
