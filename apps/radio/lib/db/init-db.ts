import { radios, settings } from "../const";
import type { Radio } from "../types";
import { db } from ".";

const TRANSITION_DURATION = 2000;

export const initDb = async () => {
  await db.settings.clear();
  await db.radios.clear();
  await db.settings.put(settings);
  await db.radios.bulkPut(radios);
};

export const resetDb = async () => {
  await db.radios.clear();
  await db.settings.clear();
  await db.settings.put(settings);
  await db.radios.bulkPut(radios);
};

export const syncRadioData = async (sourceRadios?: Radio[]) => {
  try {
    const existingRadios = await db.radios.toArray();
    const radiosToSync = sourceRadios || radios;

    // Create a map of existing radios by name for quick lookup
    const existingRadiosMap = new Map(
      existingRadios.map((radio) => [radio.name, radio])
    );

    const newRadios: Radio[] = [];
    const updatedRadios: Radio[] = [];

    // Check each radio from source (const.ts or imported data)
    for (const sourceRadio of radiosToSync) {
      const existingRadio = existingRadiosMap.get(sourceRadio.name);

      if (existingRadio) {
        // Check if radio data has changed
        const hasChanged =
          existingRadio.streamUrl !== sourceRadio.streamUrl ||
          existingRadio.logoUrl !== sourceRadio.logoUrl ||
          existingRadio.description !== sourceRadio.description ||
          existingRadio.websiteUrl !== sourceRadio.websiteUrl;

        if (hasChanged) {
          // Update existing radio with new data, preserving user preferences
          updatedRadios.push({
            ...sourceRadio,
            id: existingRadio.id, // Keep the existing ID
            order: existingRadio.order, // Preserve user's custom order
            enabled: existingRadio.enabled, // Preserve user's enabled/disabled state
          });
        }
      } else {
        // New radio - add to newRadios with default values
        const maxOrder = Math.max(
          ...existingRadios.map((r) => r.order || 0),
          0
        );
        newRadios.push({
          ...sourceRadio,
          order: maxOrder + newRadios.length + 1, // Add at the end
          enabled: false, // New radios are disabled by default to preserve user preferences
        });
      }
    }

    // Add new radios
    if (newRadios.length > 0) {
      await db.radios.bulkAdd(newRadios);
      console.log(`Added ${newRadios.length} new radios`);
    }

    // Update existing radios
    if (updatedRadios.length > 0) {
      await db.radios.bulkPut(updatedRadios);
      console.log(`Updated ${updatedRadios.length} existing radios`);
    }

    // Only check for removed radios when syncing from const.ts (not from imports)
    let removedCount = 0;
    if (!sourceRadios) {
      const constRadioNames = new Set(radios.map((radio) => radio.name));
      const removedRadios = existingRadios.filter(
        (radio) => !constRadioNames.has(radio.name)
      );

      if (removedRadios.length > 0) {
        console.log(
          `Found ${removedRadios.length} radios that are no longer in const.ts - deleting them`
        );
        // Delete radios that are no longer in const.ts
        const removedRadioIds = removedRadios.map((radio) => radio.id);
        await db.radios.bulkDelete(removedRadioIds);
        console.log(`Deleted ${removedRadios.length} removed radios`);
        removedCount = removedRadios.length;
      }
    }

    return {
      added: newRadios.length,
      updated: updatedRadios.length,
      removed: removedCount,
      deleted: removedCount,
    };
  } catch (error) {
    console.error("Failed to sync radio data:", error);
    throw error;
  }
};

export const forceSyncRadioData = async () => {
  console.log("Force syncing radio data...");
  return await syncRadioData();
};

export const cleanupVolatileData = async () => {
  try {
    const currentSettings = await db.settings.limit(1).toArray();
    if (currentSettings.length > 0) {
      const setting = currentSettings[0];

      if (setting && !setting.id) {
        console.warn("Setting has no ID, skipping cleanup");
        return;
      }

      const oldRadio = (setting && (setting.player.single as { radio?: Radio }))
        ?.radio;
      const transitionDuration =
        setting?.player.single?.transitionDuration ?? TRANSITION_DURATION;
      const lastUsedRadio = setting?.player.single?.lastUsedRadio ?? oldRadio;

      const cleanedPlayer = {
        mode: setting?.player.mode as "multiple" | "single" | "dj",
        playerType: setting?.player.playerType,
        single: {
          transitionDuration,
          lastUsedRadio,
        },
      };

      await db.settings.update(setting?.id, {
        player: cleanedPlayer,
      });
    }
  } catch (error) {
    console.error("Failed to cleanup volatile data:", error);
  }
};
