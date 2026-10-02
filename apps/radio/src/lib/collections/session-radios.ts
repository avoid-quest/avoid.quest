import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import type { Radio } from "@/lib/audio";
import { radioMetadataConfigSchema } from "@/lib/metadata/schema";
import { platformMetadataSchema } from "./schemas";

const SESSION_RADIOS_STORAGE_KEY = "radio-session-radios";
const REMOVED_SESSION_RADIOS_STORAGE_KEY = "radio-session-radios-removed";
const EVICTED_SESSION_RADIOS_STORAGE_KEY = "radio-session-radios-evicted";
const MAX_SESSION_RADIOS = 20;
/**
 * Removed or evicted ids kept per list, newest last; older ones are
 * forgotten. A tombstone only matters while a patch still holds the radio,
 * and a patch holds far fewer than this.
 */
const MAX_SESSION_RADIO_TOMBSTONES = 100;
let lastAddedAt = 0;

const memorySessionStorage = new Map<string, string>();

const sessionStorageApi: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
  getItem(key) {
    if (typeof globalThis.sessionStorage !== "undefined") {
      return globalThis.sessionStorage.getItem(key);
    }
    return memorySessionStorage.get(key) ?? null;
  },
  removeItem(key) {
    if (typeof globalThis.sessionStorage !== "undefined") {
      globalThis.sessionStorage.removeItem(key);
      return;
    }
    memorySessionStorage.delete(key);
  },
  setItem(key, value) {
    if (typeof globalThis.sessionStorage !== "undefined") {
      globalThis.sessionStorage.setItem(key, value);
      return;
    }
    memorySessionStorage.set(key, value);
  },
};

const sessionStorageEventApi = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

function createStorageVersionKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `session-radio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const sessionRadioSchema = z.object({
  addedAt: z.number(),
  countryTitle: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  id: z.union([z.string(), z.number()]),
  isSystem: z.boolean().optional(),
  logoUrl: z.string().optional(),
  metadataConfig: radioMetadataConfigSchema.optional(),
  name: z.string(),
  order: z.number().optional(),
  placeTitle: z.string().optional(),
  platformMetadata: platformMetadataSchema,
  streamFormat: z.enum(["hls", "progressive"]).optional(),
  streamUrl: z.string(),
  websiteUrl: z.string().optional(),
});

export type SessionRadioRecord = z.infer<typeof sessionRadioSchema>;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSessionRadiosStorage(data: string): unknown {
  const parsed = JSON.parse(data) as unknown;
  if (!(isObjectRecord(parsed) && "state" in parsed)) {
    return parsed;
  }

  const state = isObjectRecord(parsed.state) ? parsed.state : undefined;
  const radios = state?.radios;
  if (!Array.isArray(radios)) {
    return parsed;
  }

  const baseAddedAt = Date.now();
  return Object.fromEntries(
    radios.flatMap((radio, index) => {
      if (!isObjectRecord(radio)) {
        return [];
      }
      const record = sessionRadioSchema.safeParse({
        ...radio,
        addedAt: baseAddedAt - index,
      });
      if (!record.success) {
        return [];
      }
      return [
        [
          `s:${String(record.data.id)}`,
          {
            data: record.data,
            versionKey: createStorageVersionKey(),
          },
        ],
      ];
    })
  );
}

export const sessionRadiosCollection = createCollection(
  localStorageCollectionOptions({
    // Keep rows resident: the app reads `.state` outside live queries, and
    // TanStack DB reclaims unsubscribed collections after `gcTime` otherwise.
    gcTime: 0,
    getKey: (item) => String(item.id),
    id: "session-radios",
    parser: {
      parse: parseSessionRadiosStorage,
      stringify: JSON.stringify,
    },
    schema: sessionRadioSchema,
    startSync: true,
    storage: sessionStorageApi,
    storageEventApi: sessionStorageEventApi,
    storageKey: SESSION_RADIOS_STORAGE_KEY,
  })
);

export function isSessionRadio(radio: Radio): boolean {
  if (!radio.id) {
    return false;
  }
  const id = String(radio.id);
  return id.startsWith("rb_") || id.startsWith("rg_");
}

function getOrderedSessionRadioRecords(): SessionRadioRecord[] {
  return Array.from(sessionRadiosCollection.state.values()).sort(
    (a, b) => b.addedAt - a.addedAt
  );
}

function getNextAddedAt(): number {
  const latestStoredAddedAt = Math.max(
    0,
    ...Array.from(sessionRadiosCollection.state.values(), (radio) =>
      Number.isFinite(radio.addedAt) ? radio.addedAt : 0
    )
  );

  lastAddedAt = Math.max(Date.now(), lastAddedAt + 1, latestStoredAddedAt + 1);
  return lastAddedAt;
}

function toSessionRadioRecord(radio: Radio): SessionRadioRecord {
  return {
    ...radio,
    addedAt: getNextAddedAt(),
    id: radio.id ?? radio.name,
  };
}

export function toSessionRadio(record: SessionRadioRecord): Radio {
  const { addedAt: _addedAt, ...radio } = sessionRadioSchema.parse(record);
  return radio;
}

export function getSessionRadios(): Radio[] {
  return getOrderedSessionRadioRecords().map(toSessionRadio);
}

function readSessionRadioIds(key: string): Set<string> {
  try {
    const parsed = JSON.parse(
      sessionStorageApi.getItem(key) ?? "[]"
    ) as unknown;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : []
    );
  } catch {
    return new Set();
  }
}

function writeSessionRadioIds(key: string, ids: Set<string>): void {
  try {
    if (ids.size === 0) {
      sessionStorageApi.removeItem(key);
      return;
    }
    sessionStorageApi.setItem(
      key,
      JSON.stringify([...ids].slice(-MAX_SESSION_RADIO_TOMBSTONES))
    );
  } catch (error) {
    // A full or blocked storage loses the tombstones, not the radio change.
    console.warn("[session-radios] Could not store removed radios", error);
  }
}

function forgetSessionRadioId(key: string, id: string): void {
  const ids = readSessionRadioIds(key);
  if (ids.delete(id)) {
    writeSessionRadioIds(key, ids);
  }
}

/**
 * Whether this tab removed the session radio `id` on purpose, so a patch
 * that still holds it doesn't register it back.
 */
export function wasSessionRadioRemoved(id: string | number): boolean {
  return readSessionRadioIds(REMOVED_SESSION_RADIOS_STORAGE_KEY).has(
    String(id)
  );
}

/**
 * Whether the session radio `id` left this tab's list to make room for newer
 * ones, so a patch that still holds it doesn't register it back and push
 * out another.
 */
export function wasSessionRadioEvicted(id: string | number): boolean {
  return readSessionRadioIds(EVICTED_SESSION_RADIOS_STORAGE_KEY).has(
    String(id)
  );
}

export function addSessionRadio(radio: Radio): void {
  const record = toSessionRadioRecord(radio);
  const id = String(record.id);
  forgetSessionRadioId(REMOVED_SESSION_RADIOS_STORAGE_KEY, id);
  forgetSessionRadioId(EVICTED_SESSION_RADIOS_STORAGE_KEY, id);
  if (sessionRadiosCollection.state.has(id)) {
    sessionRadiosCollection.update(id, (draft) => {
      Object.assign(draft, record);
    });
    return;
  }

  sessionRadiosCollection.insert(record);

  const evicted = getOrderedSessionRadioRecords().slice(MAX_SESSION_RADIOS);
  if (evicted.length === 0) {
    return;
  }
  const evictedIds = readSessionRadioIds(EVICTED_SESSION_RADIOS_STORAGE_KEY);
  for (const staleRadio of evicted) {
    sessionRadiosCollection.delete(String(staleRadio.id));
    evictedIds.add(String(staleRadio.id));
  }
  writeSessionRadioIds(EVICTED_SESSION_RADIOS_STORAGE_KEY, evictedIds);
}

export function removeSessionRadio(id: string | number): void {
  const key = String(id);
  if (sessionRadiosCollection.state.has(key)) {
    sessionRadiosCollection.delete(key);
  }
  writeSessionRadioIds(
    REMOVED_SESSION_RADIOS_STORAGE_KEY,
    readSessionRadioIds(REMOVED_SESSION_RADIOS_STORAGE_KEY).add(key)
  );
}
