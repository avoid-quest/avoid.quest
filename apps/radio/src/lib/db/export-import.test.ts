import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getSettings, settingsCollection } from "@/lib/collections";
import { mergeImportedData, validateImportData } from "./export-import";

const SETTINGS_ID = "app-settings";

async function resetSettings() {
  await settingsCollection.stateWhenReady();

  for (const settingsId of Array.from(settingsCollection.state.keys())) {
    settingsCollection.delete(settingsId);
  }
}

beforeEach(async () => {
  await resetSettings();
});

afterEach(async () => {
  await resetSettings();
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
});
