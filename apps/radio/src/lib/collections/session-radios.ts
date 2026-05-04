import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import type { Radio } from "@/lib/audio";

const SESSION_RADIOS_STORAGE_KEY = "radio-session-radios";
const MAX_SESSION_RADIOS = 20;
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
  id: z.union([z.string(), z.number()]),
  name: z.string(),
  streamUrl: z.string(),
  logoUrl: z.string().optional(),
  description: z.string().optional(),
  websiteUrl: z.string().optional(),
  placeTitle: z.string().optional(),
  countryTitle: z.string().optional(),
  order: z.number().optional(),
  enabled: z.boolean().optional(),
  isSystem: z.boolean().optional(),
  platformMetadata: z.custom<Radio["platformMetadata"]>().optional(),
  addedAt: z.number(),
});

export type SessionRadioRecord = z.infer<typeof sessionRadioSchema>;

function parseSessionRadiosStorage(data: string): unknown {
  const parsed = JSON.parse(data) as unknown;
  if (!(parsed && typeof parsed === "object" && "state" in parsed)) {
    return parsed;
  }

  const radios = (parsed as { state?: { radios?: unknown[] } }).state?.radios;
  if (!Array.isArray(radios)) {
    return parsed;
  }

  const baseAddedAt = Date.now();
  return Object.fromEntries(
    radios.flatMap((radio, index) => {
      const record = sessionRadioSchema.safeParse({
        ...(radio as object),
        addedAt: baseAddedAt - index,
      });
      if (!record.success) {
        return [];
      }
      return [
        [
          `s:${String(record.data.id)}`,
          {
            versionKey: createStorageVersionKey(),
            data: record.data,
          },
        ],
      ];
    })
  );
}

export const sessionRadiosCollection = createCollection(
  localStorageCollectionOptions({
    id: "session-radios",
    storageKey: SESSION_RADIOS_STORAGE_KEY,
    storage: sessionStorageApi,
    storageEventApi: sessionStorageEventApi,
    parser: {
      parse: parseSessionRadiosStorage,
      stringify: JSON.stringify,
    },
    getKey: (item) => String(item.id),
    schema: sessionRadioSchema,
  })
);

export function isSessionRadio(radio: Radio): boolean {
  if (!radio.id) {
    return false;
  }
  return String(radio.id).startsWith("rg_");
}

function toSessionRadioRecord(radio: Radio): SessionRadioRecord {
  lastAddedAt = Math.max(Date.now(), lastAddedAt + 1);
  return {
    ...radio,
    id: radio.id ?? radio.name,
    addedAt: lastAddedAt,
  };
}

export function toSessionRadio(record: SessionRadioRecord): Radio {
  const { addedAt: _addedAt, ...radio } = record;
  return radio;
}

export function getSessionRadios(): Radio[] {
  return Array.from(sessionRadiosCollection.state.values())
    .sort((a, b) => b.addedAt - a.addedAt)
    .map(toSessionRadio);
}

export function addSessionRadio(radio: Radio): void {
  const record = toSessionRadioRecord(radio);
  const id = String(record.id);
  if (sessionRadiosCollection.state.has(id)) {
    return;
  }

  sessionRadiosCollection.insert(record);

  const radios = Array.from(sessionRadiosCollection.state.values()).sort(
    (a, b) => b.addedAt - a.addedAt
  );
  for (const staleRadio of radios.slice(MAX_SESSION_RADIOS)) {
    sessionRadiosCollection.delete(String(staleRadio.id));
  }
}

export function removeSessionRadio(id: string | number): void {
  const key = String(id);
  if (sessionRadiosCollection.state.has(key)) {
    sessionRadiosCollection.delete(key);
  }
}
