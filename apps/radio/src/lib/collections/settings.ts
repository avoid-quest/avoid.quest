import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import { settings as defaultSettings } from "../const";

const playerModeSchema = z.enum(["multiple", "single", "dj"]);
const playerTypeSchema = z.enum(["default", "browser"]);

const singleModeSettingsSchema = z.object({
  transitionDuration: z.number().default(2000),
});

const playerSettingsSchema = z.object({
  mode: playerModeSchema.default("multiple"),
  playerType: playerTypeSchema.default("default"),
  restoreStateOnLoad: z.boolean().default(true),
  single: singleModeSettingsSchema.optional(),
});

const settingsSchema = z.object({
  id: z.string(),
  player: playerSettingsSchema,
});

export type SettingsRecord = z.infer<typeof settingsSchema>;

const SETTINGS_ID = "app-settings";

export const settingsCollection = createCollection(
  localStorageCollectionOptions({
    id: "settings",
    storageKey: "radio-app-settings",
    getKey: (item) => item.id,
    schema: settingsSchema,
  })
);

/**
 * Initialize settings with defaults if empty
 */
export function initializeSettings(): void {
  const existing = settingsCollection.state;

  if (existing.size === 0) {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode: defaultSettings.player.mode,
        playerType: defaultSettings.player.playerType ?? "default",
        restoreStateOnLoad: defaultSettings.player.restoreStateOnLoad ?? true,
        single: defaultSettings.player.single,
      },
    });
  }
}

/**
 * Get current settings (singleton)
 */
export function getSettings(): SettingsRecord | undefined {
  return settingsCollection.state.get(SETTINGS_ID);
}

/**
 * Update player mode
 */
export function setPlayerMode(mode: z.infer<typeof playerModeSchema>): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.player.mode = mode;
    });
  } else {
    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode,
        playerType: "default",
        restoreStateOnLoad: true,
      },
    });
  }
}

/**
 * Update player type
 */
export function setPlayerType(
  playerType: z.infer<typeof playerTypeSchema>
): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.player.playerType = playerType;
    });
  }
}

/**
 * Update restore state on load setting
 */
export function setRestoreStateOnLoad(restore: boolean): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.player.restoreStateOnLoad = restore;
    });
  }
}

/**
 * Update single mode transition duration
 */
export function setSingleModeTransitionDuration(duration: number): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.player.single) {
        draft.player.single.transitionDuration = duration;
      } else {
        draft.player.single = { transitionDuration: duration };
      }
    });
  }
}

/**
 * Update full player settings
 */
export function updatePlayerSettings(
  updater: (player: SettingsRecord["player"]) => Partial<{
    mode: "single" | "multiple" | "dj";
    playerType: "default" | "browser";
    restoreStateOnLoad: boolean;
    single: { transitionDuration: number };
  }>
): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      const updates = updater(existing.player);
      if (updates.mode !== undefined) {
        draft.player.mode = updates.mode;
      }
      if (updates.playerType !== undefined) {
        draft.player.playerType = updates.playerType;
      }
      if (updates.restoreStateOnLoad !== undefined) {
        draft.player.restoreStateOnLoad = updates.restoreStateOnLoad;
      }
      if (updates.single !== undefined) {
        draft.player.single = updates.single;
      }
    });
  }
}
