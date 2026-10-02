import { describe, expect, mock, test } from "bun:test";
import type { playbackSessionsCollection } from "../playback-sessions";
import {
  migrateNodeGraphSession,
  NODE_GRAPH_BACKUP_STORAGE_KEY,
  type NodeGraphBackup,
} from "./node-graph-v2";

/** A v1 patch this release cannot read: its node list is not a list. */
const unreadable = { edges: [], nodes: "garbage", version: 1 };

function createSessions(graph: unknown) {
  const record: { graph?: unknown; id: string } = { graph, id: "node" };
  const update = mock(
    (_id: string, updater: (draft: typeof record) => void) => {
      updater(record);
    }
  );
  const sessions = {
    state: new Map([["node", record]]),
    update,
  } as unknown as typeof playbackSessionsCollection;
  return { record, sessions, update };
}

function createMemoryStorage() {
  const state = new Map<string, string>();
  return {
    getItem: (key: string) => state.get(key) ?? null,
    setItem: (key: string, value: string) => {
      state.set(key, value);
    },
  };
}

function readBackups(storage: { getItem: (key: string) => string | null }) {
  return JSON.parse(
    storage.getItem(NODE_GRAPH_BACKUP_STORAGE_KEY) ?? "[]"
  ) as NodeGraphBackup[];
}

describe("migrateNodeGraphSession", () => {
  test("backs up an unreadable patch before dropping it", () => {
    const { record, sessions } = createSessions(unreadable);
    const storage = createMemoryStorage();
    const earlier = { createdAt: 1, error: "earlier", graph: { version: 1 } };
    storage.setItem(NODE_GRAPH_BACKUP_STORAGE_KEY, JSON.stringify([earlier]));

    migrateNodeGraphSession(sessions, storage);

    expect(record.graph).toBeUndefined();
    const backups = readBackups(storage);
    expect(backups[0]).toEqual(earlier);
    expect(backups[1]?.graph).toEqual(unreadable);
    expect(backups[1]?.error).toBeString();
  });

  test("keeps an unreadable patch when its backup cannot be stored", () => {
    const { record, sessions, update } = createSessions(unreadable);
    const originalWarn = console.warn;
    console.warn = mock(() => undefined);

    try {
      migrateNodeGraphSession(sessions, {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(update).not.toHaveBeenCalled();
    expect(record.graph).toEqual(unreadable);
  });
});
