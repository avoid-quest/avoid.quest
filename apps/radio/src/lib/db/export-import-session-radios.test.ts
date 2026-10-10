import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import {
  addSessionRadio,
  playbackSessionsCollection,
  radiosCollection,
  sessionRadiosCollection,
  settingsCollection,
} from "@/lib/collections";
import { loadNodeGraph, nodeStore } from "@/lib/node-graph/node-store";
import { buildNodeSessionFromGraph } from "@/lib/node-graph/template-sessions";
import { buildNodeGraphFromTemplate } from "@/lib/node-graph/templates";
import type { DatabaseExport } from "@/lib/types";
import { mergeImportedData, replaceImportedData } from "./export-import";

const STORAGE_KEY = "radio-session-radios";
let previousStorage: PropertyDescriptor | undefined;

function installSessionStorage() {
  previousStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage"
  );
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage,
  });
}

function radio(id: string): Radio {
  return { id, name: id, streamUrl: `https://radio.example/${id}` };
}

function recordData(record: object | undefined) {
  if (!record) {
    return;
  }
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !key.startsWith("$"))
  );
}

function sessionRows() {
  return [...sessionRadiosCollection.state.values()]
    .map(recordData)
    .sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
}

function storedSessionRows() {
  const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
  return Object.values(stored)
    .map((entry) => recordData((entry as { data: object }).data))
    .sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

async function resetCollections() {
  await Promise.all([
    radiosCollection.stateWhenReady(),
    sessionRadiosCollection.stateWhenReady(),
    settingsCollection.stateWhenReady(),
    playbackSessionsCollection.stateWhenReady(),
  ]);
  for (const collection of [
    radiosCollection,
    sessionRadiosCollection,
    settingsCollection,
    playbackSessionsCollection,
  ] as const) {
    for (const key of [...collection.state.keys()]) {
      collection.delete(key as never);
    }
  }
  loadNodeGraph(null);
  await settle();
}

beforeEach(async () => {
  installSessionStorage();
  await resetCollections();
});
afterEach(async () => {
  try {
    await resetCollections();
  } finally {
    if (previousStorage) {
      Object.defineProperty(globalThis, "sessionStorage", previousStorage);
    } else {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    }
  }
});

function backup(): DatabaseExport {
  return {
    exportDate: "2026-10-01T00:00:00.000Z",
    radios: [{ ...radio("saved"), enabled: true }],
    sessions: {
      node: {
        graph: buildNodeGraphFromTemplate("start-from-multiple", {
          session: [radio("rb_imported")],
        }),
        masterVolume: 0.4,
      },
    },
    settings: { player: { mode: "node", restoreStateOnLoad: true } },
    version: 2,
  };
}

async function seedFullSessionHistory() {
  for (let index = 0; index < 20; index += 1) {
    addSessionRadio(radio(`rb_old-${index}`));
  }
  settingsCollection.insert({
    id: "app-settings",
    player: { mode: "single", restoreStateOnLoad: false },
  });
  const graph = buildNodeGraphFromTemplate("blank");
  playbackSessionsCollection.insert(buildNodeSessionFromGraph(graph, 0.2));
  loadNodeGraph(graph);
  await settle();
}

describe("imported patch session radios", () => {
  for (const [label, apply] of [
    ["merge", mergeImportedData],
    ["replace", replaceImportedData],
  ] as const) {
    test(`${label} persists an unsaved Station from the imported patch`, async () => {
      await apply(backup());
      await settle();

      expect(sessionRadiosCollection.state.has("rb_imported")).toBe(true);
      expect(storedSessionRows()).toEqual(sessionRows());
      expect(storedSessionRows()).toHaveLength(1);
      expect(playbackSessionsCollection.state.get("node")?.masterVolume).toBe(
        0.4
      );
    });

    test(`${label} rolls back invalid disconnected session radios before persistence`, async () => {
      await seedFullSessionHistory();
      const previousRows = sessionRows();
      const previousStoredRows = storedSessionRows();
      const previousEditor = nodeStore.state;
      const graph = buildNodeGraphFromTemplate("start-from-multiple", {
        session: [radio("rb_imported")],
      });
      graph.edges = [];
      const station = graph.nodes.find((node) => node.type === "station");
      if (!station) {
        throw new Error("Missing Station fixture");
      }
      station.data.radio = {
        ...radio("rb_imported"),
        platformMetadata: { platform: "youtube" },
      };
      const invalid = backup();
      invalid.sessions = { node: { graph } };
      const accept = spyOn(radiosCollection.utils, "acceptMutations");
      const errors = spyOn(console, "error").mockImplementation(
        () => undefined
      );
      try {
        expect(() => apply(invalid)).toThrow();
        await settle();

        expect(accept).not.toHaveBeenCalled();
        expect(sessionRows()).toEqual(previousRows);
        expect(storedSessionRows()).toEqual(previousStoredRows);
        expect(radiosCollection.state.size).toBe(0);
        expect(nodeStore.state).toBe(previousEditor);
      } finally {
        accept.mockRestore();
        errors.mockRestore();
      }
    });

    for (const collection of [
      sessionRadiosCollection,
      playbackSessionsCollection,
    ]) {
      test(`${label} restores session radios after ${collection.id} persistence fails`, async () => {
        await seedFullSessionHistory();
        const previousRows = sessionRows();
        const previousStoredRows = storedSessionRows();
        const previousSession = recordData(
          playbackSessionsCollection.state.get("node")
        );
        const previousSettings = recordData(
          settingsCollection.state.get("app-settings")
        );
        const previousEditor = nodeStore.state;
        const originalAccept = collection.utils.acceptMutations;
        const accept = spyOn(
          collection.utils,
          "acceptMutations"
        ).mockImplementationOnce((pending) => {
          originalAccept(pending);
          throw new Error("session-radio import persistence failed");
        });
        const errors = spyOn(console, "error").mockImplementation(
          () => undefined
        );
        const success = spyOn(toast, "success");
        try {
          expect(() => apply(backup())).toThrow(
            "session-radio import persistence failed"
          );
          await settle();

          expect(sessionRows()).toEqual(previousRows);
          expect(storedSessionRows()).toEqual(previousStoredRows);
          expect(sessionRadiosCollection.state.has("rb_imported")).toBe(false);
          expect(
            recordData(playbackSessionsCollection.state.get("node"))
          ).toEqual(previousSession);
          expect(
            recordData(settingsCollection.state.get("app-settings"))
          ).toEqual(previousSettings);
          expect(radiosCollection.state.size).toBe(0);
          expect(nodeStore.state).toBe(previousEditor);
          expect(success).not.toHaveBeenCalled();
        } finally {
          accept.mockRestore();
          errors.mockRestore();
          success.mockRestore();
        }
      });
    }
  }
});
