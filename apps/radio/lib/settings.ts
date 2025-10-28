import { settings as defaultSettings } from "./const";
import { db } from "./db";

export const resetSettings = async (): Promise<void> => {
  await db.settings.clear();
  await db.settings.add(defaultSettings);
};
