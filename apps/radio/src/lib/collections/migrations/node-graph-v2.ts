/**
 * Node Graph v2 Migration (session step)
 *
 * v2 gave every source a channel strip. The session schema pins the graph
 * version (`graph: nodeGraphSchema.optional()`), and stored records load
 * unvalidated while any update of a stale one throws, so a node session a
 * v1 release stored is upgraded here first, in `initializePlaybackSessions`
 * before anything updates the collection, as `migrateMultipleSession` does.
 *
 * It is idempotent: a normalized current graph, or none, is left alone.
 * A graph from a newer release stays as stored, read-only to this one. A graph that can't
 * be read is copied to localStorage `radio-app-node-graph-backup` and then
 * dropped, so Node starts from the Starter patch rather than every session
 * update failing on it. When the copy can't be stored the graph stays.
 */

import { migrateNodeGraph, NODE_GRAPH_VERSION } from "@/lib/node-graph/schema";
import type { playbackSessionsCollection } from "../playback-sessions";

/** localStorage key holding every unreadable patch this step dropped. */
export const NODE_GRAPH_BACKUP_STORAGE_KEY = "radio-app-node-graph-backup";

export type NodeGraphBackup = {
  createdAt: number;
  /** Why the graph could not be read. */
  error: string;
  /** The graph exactly as it was stored. */
  graph: unknown;
};

type BackupStorage = Pick<Storage, "getItem" | "setItem">;

function getBackupStorage(): BackupStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    // Storage access can throw when the browser blocks it.
    return null;
  }
}

function storedVersion(graph: unknown): number | null {
  if (typeof graph !== "object" || graph === null || !("version" in graph)) {
    return null;
  }
  return typeof graph.version === "number" ? graph.version : null;
}

function readBackups(storage: BackupStorage): unknown[] {
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(NODE_GRAPH_BACKUP_STORAGE_KEY) ?? "[]"
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Appends `graph` to the backups. Returns whether it is stored afterwards;
 * without storage nothing outlives this page, so there is nothing to keep.
 */
function backupUnreadableGraph(
  graph: unknown,
  error: string,
  storage: BackupStorage | null
): boolean {
  if (!storage) {
    return true;
  }
  try {
    const backup: NodeGraphBackup = { createdAt: Date.now(), error, graph };
    const serialized = JSON.stringify(backup);
    storage.setItem(
      NODE_GRAPH_BACKUP_STORAGE_KEY,
      JSON.stringify([...readBackups(storage), backup])
    );
    return readBackups(storage).some(
      (entry) => JSON.stringify(entry) === serialized
    );
  } catch (backupError) {
    console.warn(
      "[node-graph-v2] Could not back up the unreadable patch",
      backupError
    );
    return false;
  }
}

export function migrateNodeGraphSession(
  sessions: typeof playbackSessionsCollection,
  storage: BackupStorage | null = getBackupStorage()
): void {
  const stored: unknown = sessions.state.get("node")?.graph;
  const version = storedVersion(stored);
  if (stored === undefined) {
    return;
  }
  const migration = migrateNodeGraph(stored);
  if (migration.status === "read-only") {
    return;
  }
  if (
    migration.status === "ok" &&
    version === NODE_GRAPH_VERSION &&
    JSON.stringify(stored) === JSON.stringify(migration.graph)
  ) {
    return;
  }
  if (
    migration.status === "invalid" &&
    !backupUnreadableGraph(stored, migration.error, storage)
  ) {
    return;
  }
  try {
    // The update validates the merged record, upgraded graph included.
    sessions.update("node", (draft) => {
      if (migration.status === "ok") {
        draft.graph = migration.graph;
      } else {
        draft.graph = undefined;
      }
    });
  } catch (error) {
    console.warn("[node-graph-v2] Could not upgrade the node session", error);
  }
}
