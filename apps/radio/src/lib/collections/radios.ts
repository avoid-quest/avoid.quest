import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import { radios as defaultRadios } from "../const";

// Use a loose schema for platformMetadata since it comes from external APIs
// and the full types (BandcampMetadata | SoundCloudMetadata) are complex unions
const platformMetadataSchema = z
  .custom<import("@/lib/platform-types").PlatformMetadata>()
  .optional();

const radioSchema = z.object({
  id: z.string(),
  name: z.string(),
  streamUrl: z.string(),
  logoUrl: z.string().optional(),
  description: z.string().optional(),
  websiteUrl: z.string().optional(),
  order: z.number().default(0),
  enabled: z.boolean().default(true),
  platformMetadata: platformMetadataSchema,
});

export type RadioRecord = z.infer<typeof radioSchema>;

export const radiosCollection = createCollection(
  localStorageCollectionOptions({
    id: "radios",
    storageKey: "radio-app-radios",
    getKey: (item) => item.id,
    schema: radioSchema,
  })
);

/**
 * Initialize the radios collection with default data if empty
 */
export function initializeRadios(): void {
  const existing = radiosCollection.state;

  if (existing.size === 0) {
    for (const radio of defaultRadios) {
      radiosCollection.insert({
        id: crypto.randomUUID(),
        name: radio.name,
        streamUrl: radio.streamUrl,
        logoUrl: radio.logoUrl,
        description: radio.description,
        websiteUrl: radio.websiteUrl,
        order: radio.order ?? 0,
        enabled: true,
      });
    }
  }
}

/**
 * Sync radios with default data (preserves user preferences)
 */
export function syncRadios(): void {
  const existing = radiosCollection.state;
  const existingByName = new Map<string, RadioRecord>();

  for (const radio of existing.values()) {
    existingByName.set(radio.name, radio);
  }

  // Add new radios from defaults
  for (const defaultRadio of defaultRadios) {
    if (existingByName.has(defaultRadio.name)) {
      // Update existing radio with new defaults (preserve user settings)
      const existingRadio = existingByName.get(defaultRadio.name);
      if (existingRadio) {
        radiosCollection.update(existingRadio.id, (draft) => {
          draft.streamUrl = defaultRadio.streamUrl;
          if (defaultRadio.logoUrl) {
            draft.logoUrl = defaultRadio.logoUrl;
          }
          if (defaultRadio.description) {
            draft.description = defaultRadio.description;
          }
          if (defaultRadio.websiteUrl) {
            draft.websiteUrl = defaultRadio.websiteUrl;
          }
          // Preserve order and enabled status
        });
      }
    } else {
      radiosCollection.insert({
        id: crypto.randomUUID(),
        name: defaultRadio.name,
        streamUrl: defaultRadio.streamUrl,
        logoUrl: defaultRadio.logoUrl,
        description: defaultRadio.description,
        websiteUrl: defaultRadio.websiteUrl,
        order: defaultRadio.order ?? 0,
        enabled: true,
      });
    }
  }
}

/**
 * Get all enabled radios sorted by order
 */
export function getEnabledRadios(): RadioRecord[] {
  const radios = Array.from(radiosCollection.state.values());
  return radios
    .filter((r) => r.enabled)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Get all radios sorted by order
 */
export function getAllRadios(): RadioRecord[] {
  const radios = Array.from(radiosCollection.state.values());
  return radios.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
