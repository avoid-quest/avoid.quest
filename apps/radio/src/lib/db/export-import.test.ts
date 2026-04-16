import { describe, expect, test } from "bun:test";
import { validateImportData } from "./export-import";

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

  test("defaults restoreStateOnLoad to true when omitted", () => {
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
      restoreStateOnLoad: true,
      single: undefined,
    });
  });
});
