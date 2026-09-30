/**
 * Node Graph v2 Migration (session step)
 *
 * v2 gave every source a channel strip. The session schema pins the graph
 * version (`graph: nodeGraphSchema.optional()`), and stored records load
 * unvalidated while any update of a stale one throws, so a node session a
 * v1 release stored is upgraded here first, in `initializePlaybackSessions`
 * before anything updates the collection, as `migrateMultipleSession` does.
 *
 * It is idempotent: a current graph, or none, is left alone. A graph from a
 * newer release stays as stored, read-only to this one. A graph that can't
 * be read is dropped, so Node starts from the Starter patch rather than
 * every session update failing on it.
 */

import { migrateNodeGraph, NODE_GRAPH_VERSION } from "@/lib/node-graph/schema";
import type { playbackSessionsCollection } from "../playback-sessions";

function storedVersion(graph: unknown): number | null {
  if (typeof graph !== "object" || graph === null || !("version" in graph)) {
    return null;
  }
  return typeof graph.version === "number" ? graph.version : null;
}

export function migrateNodeGraphSession(
  sessions: typeof playbackSessionsCollection
): void {
  const stored: unknown = sessions.state.get("node")?.graph;
  const version = storedVersion(stored);
  if (stored === undefined || version === NODE_GRAPH_VERSION) {
    return;
  }
  const migration = migrateNodeGraph(stored);
  if (migration.status === "read-only") {
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
