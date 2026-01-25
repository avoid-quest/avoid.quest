import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import { DEFAULT_IMAGE_SIZE, DEFAULT_USERNAME } from "../const";

const imageSizeSchema = z.enum(["170x", "236x", "474x", "736x", "orig"]);

const settingsSchema = z.object({
  id: z.literal("app-settings"),
  username: z.string().default(DEFAULT_USERNAME),
  imageSize: imageSizeSchema.default(DEFAULT_IMAGE_SIZE),
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
 * Initialize settings with defaults if empty
 */
export async function initializeSettings(): Promise<void> {
  const existing = await settingsCollection.stateWhenReady();

  if (existing.size === 0) {
    settingsCollection.insert({
      id: SETTINGS_ID,
      username: DEFAULT_USERNAME,
      imageSize: DEFAULT_IMAGE_SIZE,
    });
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
