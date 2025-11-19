import { radios as defaultRadios, settings as defaultSettings } from "./const";
import { db } from "./db";

export const resetSettings = async (): Promise<void> => {
  await db.settings.clear();
  await db.settings.add(defaultSettings);
};

export const resetAllSettings = async (): Promise<void> => {
  // Clear all data
  await db.radios.clear();
  await db.settings.clear();

  // Reinitialize with defaults
  await db.settings.add(defaultSettings);
  await db.radios.bulkAdd(defaultRadios);
};
