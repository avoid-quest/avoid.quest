import {
  createCollection,
  createTransaction,
  deepEquals,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import type { Radio } from "../audio";
import { radios as defaultRadios } from "../const";
import { radioMetadataConfigSchema } from "../metadata/schema";
import { generateId } from "../types";
import { createMemoryFallbackStorage } from "./memory-fallback-storage";
import { platformMetadataSchema } from "./schemas";

const RADIOS_STORAGE_KEY = "radio-app-radios";
const DISMISSED_RADIOS_KEY = "radio-app-dismissed-radios";

/**
 * Get the set of radio names that have been dismissed by the user.
 */
export function getDismissedRadios(): Set<string> {
  if (typeof localStorage === "undefined") {
    return new Set();
  }
  const stored = localStorage.getItem(DISMISSED_RADIOS_KEY);
  if (!stored) {
    return new Set();
  }
  try {
    return new Set(z.array(z.string()).parse(JSON.parse(stored)));
  } catch (error) {
    console.warn("[radios] Could not read dismissed stations", error);
    try {
      preserveCorruptData(DISMISSED_RADIOS_KEY, stored);
    } catch (backupError) {
      console.warn(
        "[radios] Could not back up dismissed stations",
        backupError
      );
    }
    return new Set();
  }
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
  countryTitle: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  id: z.string(),
  isSystem: z.boolean().default(false),
  logoUrl: z.string().optional(),
  metadataConfig: radioMetadataConfigSchema.optional(),
  name: z.string(),
  order: z.number().default(0),
  placeTitle: z.string().optional(),
  platformMetadata: platformMetadataSchema,
  streamFormat: z.enum(["hls", "progressive"]).optional(),
  streamUrl: z.string(),
  websiteUrl: z.string().optional(),
});

export type RadioRecord = z.infer<typeof radioSchema>;

const radiosStorage = createMemoryFallbackStorage();

const radiosCollectionOptions = localStorageCollectionOptions({
  // Keep rows resident: the app reads `.state` outside live queries, and
  // TanStack DB reclaims unsubscribed collections after `gcTime` otherwise.
  gcTime: 0,
  getKey: (item) => item.id,
  id: "radios",
  schema: radioSchema,
  startSync: true,
  storage: radiosStorage.storage,
  storageEventApi: radiosStorage.storageEventApi,
  storageKey: RADIOS_STORAGE_KEY,
});
// TanStack's metadata callback reads window.localStorage again on every write.
// This collection always uses our custom adapter, even when storage is blocked.
radiosCollectionOptions.sync.getSyncMetadata = () => ({
  storageKey: RADIOS_STORAGE_KEY,
  storageType: "custom",
});

export const radiosCollection = createCollection(radiosCollectionOptions);

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
    existing.streamFormat !== incoming.streamFormat ||
    existing.logoUrl !== incoming.logoUrl ||
    existing.description !== incoming.description ||
    existing.websiteUrl !== incoming.websiteUrl ||
    !deepEquals(existing.metadataConfig, incoming.metadataConfig)
  );
}

/**
 * Get pending sync changes between stored radios and defaults.
 * - Updates: system radios with changed metadata
 * - Additions: new radios in defaults not present in storage, by name or URL
 * - Deletions: system radios no longer in defaults (auto-deleted, no prompt)
 */
export function getSyncChanges(): SyncChanges {
  const existing = [...radiosCollection.state.values()];
  const existingByName = new Map<string, RadioRecord>();

  for (const radio of existing) {
    existingByName.set(radio.name, radio);
  }

  const defaultNames = new Set(defaultRadios.map((r) => r.name));

  const updates: SyncChanges["updates"] = [];
  const additions: SyncChanges["additions"] = [];

  // Check for deletions (system radios no longer in defaults)
  const deletions = existing.filter(
    (radio) => radio.isSystem && !defaultNames.has(radio.name)
  );

  // Get dismissed radios to filter out
  const dismissed = getDismissedRadios();

  // Check for updates
  for (const defaultRadio of defaultRadios) {
    const existingRadio = existingByName.get(defaultRadio.name);
    // Only queue update if actually changed
    if (existingRadio && hasRadioChanged(existingRadio, defaultRadio)) {
      updates.push({ existing: existingRadio, incoming: defaultRadio });
    }
  }

  // applySyncChanges skips additions whose stream URL the library keeps, so
  // offering one would bring the prompt back on every launch. Rows with a
  // queued update are matched by the URL they will have once it applies.
  const deleted = new Set(deletions);
  const updatedUrls = new Map(
    updates.map(({ existing: radio, incoming }) => [radio, incoming.streamUrl])
  );
  const urls = new Set<string>();
  for (const radio of existing) {
    if (!deleted.has(radio)) {
      urls.add(updatedUrls.get(radio) ?? radio.streamUrl);
    }
  }

  // Check for additions: not in storage, not dismissed
  for (const defaultRadio of defaultRadios) {
    if (
      !(
        existingByName.has(defaultRadio.name) ||
        dismissed.has(defaultRadio.name) ||
        urls.has(defaultRadio.streamUrl)
      )
    ) {
      urls.add(defaultRadio.streamUrl);
      additions.push(defaultRadio);
    }
  }

  return { additions, deletions, updates };
}

/**
 * Map each addition to the updates that free its stream URL, keyed by name.
 * applySyncChanges skips the addition unless those updates apply with it.
 */
export function getAdditionDependencies(
  changes: SyncChanges
): Map<string, SyncChanges["updates"]> {
  const dependencies = new Map<string, SyncChanges["updates"]>();
  for (const addition of changes.additions) {
    const updates = changes.updates.filter(
      ({ existing }) => existing.streamUrl === addition.streamUrl
    );
    if (updates.length > 0) {
      dependencies.set(addition.name, updates);
    }
  }
  return dependencies;
}

/**
 * Apply selected sync changes.
 * @param changes - The changes to apply (filtered by user selection)
 */
export async function applySyncChanges(changes: SyncChanges): Promise<void> {
  const current = radiosCollection.state;
  const deletions = new Set(
    changes.deletions.map((radio) => radio.id).filter((id) => current.has(id))
  );
  const updates = new Map(
    changes.updates
      .filter(({ existing, incoming }) => {
        const radio = current.get(existing.id);
        return (
          radio && !deletions.has(radio.id) && hasRadioChanged(radio, incoming)
        );
      })
      .map(({ existing, incoming }) => [existing.id, incoming])
  );
  // Names are the identity used by getSyncChanges; URLs also catch renamed rows.
  const names = new Set<string>();
  const urls = new Set<string>();
  for (const radio of current.values()) {
    if (!deletions.has(radio.id)) {
      names.add(radio.name);
      urls.add(updates.get(radio.id)?.streamUrl ?? radio.streamUrl);
    }
  }
  const additions: RadioRecord[] = [];
  for (const radio of changes.additions) {
    if (names.has(radio.name) || urls.has(radio.streamUrl)) {
      continue;
    }
    names.add(radio.name);
    urls.add(radio.streamUrl);
    additions.push(createSystemRadio(radio));
  }

  await persistRadioChanges(() => {
    if (updates.size > 0) {
      radiosCollection.update([...updates.keys()], (drafts) => {
        for (const draft of drafts) {
          const incoming = updates.get(draft.id);
          if (incoming) {
            draft.streamUrl = incoming.streamUrl;
            draft.streamFormat = incoming.streamFormat;
            draft.logoUrl = incoming.logoUrl;
            draft.description = incoming.description;
            draft.websiteUrl = incoming.websiteUrl;
            draft.metadataConfig = incoming.metadataConfig;
            // Preserve order and enabled status.
          }
        }
      });
    }
    if (additions.length > 0) {
      radiosCollection.insert(additions);
    }
    if (deletions.size > 0) {
      radiosCollection.delete([...deletions]);
    }
  });
}

function createSystemRadio(radio: Radio): RadioRecord {
  return {
    description: radio.description,
    enabled: true,
    id: generateId(),
    isSystem: true,
    logoUrl: radio.logoUrl,
    metadataConfig: radio.metadataConfig,
    name: radio.name,
    order: radio.order ?? 0,
    streamFormat: radio.streamFormat,
    streamUrl: radio.streamUrl,
    websiteUrl: radio.websiteUrl,
  };
}

/** Persist a library operation once, rolling all its rows back on failure. */
async function persistRadioChanges(write: () => void): Promise<void> {
  const transaction = createTransaction({
    mutationFn: ({ transaction: pending }) => {
      radiosCollection.utils.acceptMutations(pending);
      return Promise.resolve();
    },
  });
  try {
    transaction.mutate(write);
  } catch (error) {
    transaction.rollback();
    await transaction.isPersisted.promise.catch(() => undefined);
    throw error;
  }
  await transaction.isPersisted.promise;
}

export function reorderRadios(orderedIds: string[]): Promise<void> {
  const orders = new Map<string, number>();
  for (const [index, id] of orderedIds.entries()) {
    const radio = radiosCollection.state.get(id);
    if (radio && radio.order !== index) {
      orders.set(id, index);
    }
  }
  return persistRadioChanges(() => {
    if (orders.size > 0) {
      radiosCollection.update([...orders.keys()], (drafts) => {
        for (const draft of drafts) {
          draft.order = orders.get(draft.id) ?? draft.order;
        }
      });
    }
  });
}

function preserveCorruptData(key: string, raw: string): void {
  const backupKey = `${key}:corrupt`;
  const previous = localStorage.getItem(backupKey);
  if (previous === raw) {
    return;
  }
  localStorage.setItem(
    previous ? `${backupKey}:${generateId()}` : backupKey,
    raw
  );
}

function recoverStoredRadios(): RadioRecord[] {
  const raw = radiosStorage.storage?.getItem(RADIOS_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  // An empty adapter result may hide a broken envelope. Back up before any write.
  preserveCorruptData(RADIOS_STORAGE_KEY, raw);
  const recovered = new Map<string, RadioRecord>();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const entry of Object.values(parsed)) {
        if (!(entry && typeof entry === "object" && "data" in entry)) {
          continue;
        }
        const radio = radioSchema.safeParse(entry.data);
        if (radio.success) {
          recovered.set(radio.data.id, radio.data);
        }
      }
    }
  } catch (error) {
    console.warn("[radios] Could not recover saved stations", error);
  }
  return [...recovered.values()];
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
    const recovered = recoverStoredRadios();
    const radios =
      recovered.length > 0 ? recovered : defaultRadios.map(createSystemRadio);
    // The app still opens with these stations if the browser cannot save them.
    await radiosStorage.persistOrKeepInMemory(
      () => persistRadioChanges(() => radiosCollection.insert(radios)),
      "radios"
    );
    if (recovered.length === 0) {
      return null;
    }
    // Recovered rows may have lost defaults; sync them like a loaded library.
  }

  // Collection has data - check for sync changes
  const changes = getSyncChanges();

  // Auto-apply deletions (system radios removed from defaults)
  if (changes.deletions.length > 0) {
    try {
      await applySyncChanges({
        additions: [],
        deletions: changes.deletions,
        updates: [],
      });
    } catch (error) {
      // The saved library is intact, so the app still opens. Applying the
      // rest would fail the same way; both are retried on the next launch.
      console.warn("[radios] Could not remove retired stations", error);
      return null;
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
export function syncRadios(): Promise<void> {
  const changes = getSyncChanges();
  return applySyncChanges(changes);
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
