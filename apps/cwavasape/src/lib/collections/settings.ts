import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import {
  DEFAULT_EFFECTS_ENABLED,
  DEFAULT_IMAGE_SIZE,
  DEFAULT_SCROLL_SENSITIVITY,
  DEFAULT_SNAP_ENABLED,
  DEFAULT_USERNAME,
} from "../const";

const imageSizeSchema = z.enum(["170x", "236x", "474x", "736x", "orig"]);

const settingsSchema = z.object({
  id: z.literal("app-settings"),
  username: z.string().default(DEFAULT_USERNAME),
  imageSize: imageSizeSchema.default(DEFAULT_IMAGE_SIZE),
  scrollSensitivity: z
    .number()
    .min(0.1)
    .max(4.0)
    .default(DEFAULT_SCROLL_SENSITIVITY),
  effectsEnabled: z.boolean().default(DEFAULT_EFFECTS_ENABLED),
  snapEnabled: z.boolean().default(DEFAULT_SNAP_ENABLED),
});

export type Settings = z.infer<typeof settingsSchema>;
export type ImageSize = z.infer<typeof imageSizeSchema>;

const SETTINGS_ID = "app-settings" as const;

export const settingsCollection = createCollection(
  localStorageCollectionOptions({
    id: "cwavasape-settings",
    storageKey: "cwavasape-settings",
    getKey: (item) => item.id,
    schema: settingsSchema,
  })
);

/**
 * Initialize settings with defaults if empty, or migrate existing settings
 */
export async function initializeSettings(): Promise<void> {
  const existing = await settingsCollection.stateWhenReady();

  if (existing.size === 0) {
    settingsCollection.insert({
      id: SETTINGS_ID,
      username: DEFAULT_USERNAME,
      imageSize: DEFAULT_IMAGE_SIZE,
      scrollSensitivity: DEFAULT_SCROLL_SENSITIVITY,
      effectsEnabled: DEFAULT_EFFECTS_ENABLED,
      snapEnabled: DEFAULT_SNAP_ENABLED,
    });
  } else {
    // Migrate existing settings to add new fields
    const settings = existing.get(SETTINGS_ID);
    if (settings) {
      settingsCollection.update(SETTINGS_ID, (draft) => {
        if (draft.scrollSensitivity === undefined) {
          draft.scrollSensitivity = DEFAULT_SCROLL_SENSITIVITY;
        }
        if (draft.effectsEnabled === undefined) {
          draft.effectsEnabled = DEFAULT_EFFECTS_ENABLED;
        }
        if (draft.snapEnabled === undefined) {
          draft.snapEnabled = DEFAULT_SNAP_ENABLED;
        }
      });
    }
  }
}

/**
 * Get current settings
 */
export function getSettings(): Settings | undefined {
  return settingsCollection.state.get(SETTINGS_ID);
}

/**
 * Update username
 */
export function setUsername(username: string): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.username = username.trim();
    });
  }
}

/**
 * Update image size
 */
export function setImageSize(size: ImageSize): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.imageSize = size;
    });
  }
}

/**
 * Update scroll sensitivity
 */
export function setScrollSensitivity(sensitivity: number): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.scrollSensitivity = Math.max(0.1, Math.min(4.0, sensitivity));
    });
  }
}

/**
 * Update effects enabled state
 */
export function setEffectsEnabled(enabled: boolean): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.effectsEnabled = enabled;
    });
  }
}

/**
 * Update snap enabled state
 */
export function setSnapEnabled(enabled: boolean): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.snapEnabled = enabled;
    });
  }
}
