import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import type { Radio } from "../audio";
import { radios as defaultRadios } from "../const";
import { platformMetadataSchema } from "./schemas";

const DISMISSED_RADIOS_KEY = "radio-app-dismissed-radios";

/**
 * Get the set of radio names that have been dismissed by the user.
 */
export function getDismissedRadios(): Set<string> {
  if (typeof localStorage === "undefined") {
    return new Set();
  }
  const stored = localStorage.getItem(DISMISSED_RADIOS_KEY);
  return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
}

/**
 * Add a radio name to the dismissed list.
 */
export function addDismissedRadio(name: string): void {
  const dismissed = getDismissedRadios();
  dismissed.add(name);
  localStorage.setItem(DISMISSED_RADIOS_KEY, JSON.stringify([...dismissed]));
}

/**
 * Add multiple radio names to the dismissed list.
 */
export function addDismissedRadios(names: string[]): void {
  const dismissed = getDismissedRadios();
  for (const name of names) {
    dismissed.add(name);
  }
  localStorage.setItem(DISMISSED_RADIOS_KEY, JSON.stringify([...dismissed]));
}

/**
 * Remove a radio name from the dismissed list.
 */
export function removeDismissedRadio(name: string): void {
  const dismissed = getDismissedRadios();
  dismissed.delete(name);
  localStorage.setItem(DISMISSED_RADIOS_KEY, JSON.stringify([...dismissed]));
}

/**
 * Clear all dismissed radios (for "restore defaults" functionality).
 */
export function clearDismissedRadios(): void {
  localStorage.removeItem(DISMISSED_RADIOS_KEY);
}

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
  isSystem: z.boolean().default(false),
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
 * Sync changes detected between current radios and defaults
 */
export type SyncChanges = {
  updates: { existing: RadioRecord; incoming: Radio }[];
  additions: Radio[];
  deletions: RadioRecord[];
};

/**
 * Check if a radio has changed from the default
 */
function hasRadioChanged(existing: RadioRecord, incoming: Radio): boolean {
  return (
    existing.streamUrl !== incoming.streamUrl ||
    existing.logoUrl !== incoming.logoUrl ||
    existing.description !== incoming.description ||
    existing.websiteUrl !== incoming.websiteUrl
  );
}

/**
 * Get pending sync changes between stored radios and defaults.
 * - Updates: system radios with changed metadata
 * - Additions: new radios in defaults not present in storage
 * - Deletions: system radios no longer in defaults (auto-deleted, no prompt)
 */
export function getSyncChanges(): SyncChanges {
  const existing = radiosCollection.state;
  const existingByName = new Map<string, RadioRecord>();

  for (const radio of existing.values()) {
    existingByName.set(radio.name, radio);
  }

  const defaultNames = new Set(defaultRadios.map((r) => r.name));

  const updates: SyncChanges["updates"] = [];
  const additions: SyncChanges["additions"] = [];
  const deletions: SyncChanges["deletions"] = [];

  // Get dismissed radios to filter out
  const dismissed = getDismissedRadios();

  // Check for updates and additions
  for (const defaultRadio of defaultRadios) {
    const existingRadio = existingByName.get(defaultRadio.name);
    if (existingRadio) {
      // Only queue update if actually changed
      if (hasRadioChanged(existingRadio, defaultRadio)) {
        updates.push({ existing: existingRadio, incoming: defaultRadio });
      }
    } else if (!dismissed.has(defaultRadio.name)) {
      // New radio not in storage and not dismissed
      additions.push(defaultRadio);
    }
  }

  // Check for deletions (system radios no longer in defaults)
  for (const radio of existing.values()) {
    if (radio.isSystem && !defaultNames.has(radio.name)) {
      deletions.push(radio);
    }
  }

  return { updates, additions, deletions };
}

/**
 * Apply selected sync changes.
 * @param changes - The changes to apply (filtered by user selection)
 */
export function applySyncChanges(changes: SyncChanges): void {
  // Apply updates
  for (const { existing, incoming } of changes.updates) {
    radiosCollection.update(existing.id, (draft) => {
      draft.streamUrl = incoming.streamUrl;
      draft.logoUrl = incoming.logoUrl;
      draft.description = incoming.description;
      draft.websiteUrl = incoming.websiteUrl;
      // Preserve order and enabled status
    });
  }

  // Apply additions
  for (const radio of changes.additions) {
    radiosCollection.insert({
      id: crypto.randomUUID(),
      name: radio.name,
      streamUrl: radio.streamUrl,
      logoUrl: radio.logoUrl,
      description: radio.description,
      websiteUrl: radio.websiteUrl,
      order: radio.order ?? 0,
      enabled: true,
      isSystem: true,
    });
  }

  // Apply deletions
  for (const radio of changes.deletions) {
    radiosCollection.delete(radio.id);
  }
}

/**
 * Check if there are any pending sync changes
 */
export function hasSyncChanges(): boolean {
  const changes = getSyncChanges();
  return (
    changes.updates.length > 0 ||
    changes.additions.length > 0 ||
    changes.deletions.length > 0
  );
}

/**
 * Initialize the radios collection with default data if empty.
 * Returns sync changes if collection has data and changes are detected.
 */
export async function initializeRadios(): Promise<SyncChanges | null> {
  // Wait for collection to load from localStorage first
  const existing = await radiosCollection.stateWhenReady();

  if (existing.size === 0) {
    // Seed with defaults, marking all as system radios
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
        isSystem: true,
      });
    }
    return null;
  }

  // Collection has data - check for sync changes
  const changes = getSyncChanges();

  // Auto-apply deletions (system radios removed from defaults)
  if (changes.deletions.length > 0) {
    for (const radio of changes.deletions) {
      radiosCollection.delete(radio.id);
    }
    // Clear deletions from return since they're auto-applied
    changes.deletions = [];
  }

  // Return remaining changes for user confirmation
  if (changes.updates.length > 0 || changes.additions.length > 0) {
    return changes;
  }

  return null;
}

/**
 * Sync radios with default data (legacy - now uses getSyncChanges + applySyncChanges)
 * @deprecated Use getSyncChanges() and applySyncChanges() instead
 */
export function syncRadios(): void {
  const changes = getSyncChanges();
  applySyncChanges(changes);
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
