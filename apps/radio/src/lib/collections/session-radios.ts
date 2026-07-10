import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import type { Radio } from "@/lib/audio";
import { radioMetadataConfigSchema } from "@/lib/metadata/schema";
import { platformMetadataSchema } from "./schemas";

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
  streamFormat: z.enum(["hls", "progressive"]).optional(),
  logoUrl: z.string().optional(),
  description: z.string().optional(),
  websiteUrl: z.string().optional(),
  placeTitle: z.string().optional(),
  countryTitle: z.string().optional(),
  order: z.number().optional(),
  enabled: z.boolean().optional(),
  isSystem: z.boolean().optional(),
  platformMetadata: platformMetadataSchema,
  metadataConfig: radioMetadataConfigSchema.optional(),
  addedAt: z.number(),
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
    id: radio.id ?? radio.name,
    addedAt: getNextAddedAt(),
  };
}

export function toSessionRadio(record: SessionRadioRecord): Radio {
  const { addedAt: _addedAt, ...radio } = sessionRadioSchema.parse(record);
  return radio;
}

export function getSessionRadios(): Radio[] {
  return getOrderedSessionRadioRecords().map(toSessionRadio);
}

export function addSessionRadio(radio: Radio): void {
  const record = toSessionRadioRecord(radio);
  const id = String(record.id);
  if (sessionRadiosCollection.state.has(id)) {
    sessionRadiosCollection.update(id, (draft) => {
      Object.assign(draft, record);
    });
    return;
  }

  sessionRadiosCollection.insert(record);

  for (const staleRadio of getOrderedSessionRadioRecords().slice(
    MAX_SESSION_RADIOS
  )) {
    sessionRadiosCollection.delete(String(staleRadio.id));
  }
}

export function removeSessionRadio(id: string | number): void {
  const key = String(id);
  if (sessionRadiosCollection.state.has(key)) {
    sessionRadiosCollection.delete(key);
  }
}
