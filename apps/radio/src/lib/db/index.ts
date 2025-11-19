import Dexie, { type EntityTable } from "dexie";
import { radios as defaultRadios, settings as defaultSettings } from "../const";
import type { Radio, Settings } from "../types";
import { syncRadioData } from "./init-db";

const db = new Dexie("Radios") as Dexie & {
  radios: EntityTable<Radio, "id">;
  settings: EntityTable<Settings, "id">;
};

// Version 1: Clear everything and start fresh
db.version(1)
  .stores({
    radios:
      "++id, name, streamUrl, logoUrl, description, websiteUrl, order, enabled",
    settings: "++id, player",
  })
  .upgrade(async () => {
    // Clear all existing data
    await db.radios.clear();
    await db.settings.clear();

    // Add fresh data from const.ts
    await db.settings.add(defaultSettings);
    await db.radios.bulkAdd(defaultRadios);
  });

// Initialize database with default data (fallback)
db.on("ready", async () => {
  if ((await db.settings.count()) === 0) {
    await db.settings.add(defaultSettings);
  }

  if ((await db.radios.count()) === 0) {
    await db.radios.bulkAdd(defaultRadios);
  } else {
    // Sync existing data with latest from const.ts
    await syncRadioData();
  }
});

export { db };
