/**
 * Connection Hints
 *
 * What a cable being dragged may end on: a verdict for every port, taken
 * once when the drag starts (`connectableHandles`) and dropped when it
 * ends. Each port reads its own verdict to light up or lock, and the
 * canvas's isValidConnection reads the same verdicts, so a pointer move
 * validates nothing. Validating the patch per port per pointer move is the
 * one hot path in Node mode worth a cache.
 */

import { Store, useStore } from "@tanstack/react-store";
import {
  connectableHandles,
  type PaletteFrom,
  portKey,
} from "@/lib/node-graph/palette";
import type { NodeGraph } from "@/lib/node-graph/schema";
import {
  type Connection,
  connectionVerdict,
  type ValidateOptions,
  type Verdict,
} from "@/lib/node-graph/validate";

export type ConnectionHints = {
  from: PaletteFrom;
  /** The patch the verdicts were taken on; any other patch asks afresh. */
  graph: NodeGraph;
  verdicts: ReadonlyMap<string, Verdict>;
};

export type ConnectionHintStore = Store<ConnectionHints | null>;

export const connectionHints: ConnectionHintStore =
  new Store<ConnectionHints | null>(null);

export function startConnectionHints(
  graph: NodeGraph,
  from: PaletteFrom,
  options?: ValidateOptions,
  store: ConnectionHintStore = connectionHints
): void {
  store.setState(() => ({
    from,
    graph,
    verdicts: connectableHandles(graph, from, options),
  }));
}

/** Drops the drag's verdicts, handing back the ones it had. */
export function clearConnectionHints(
  store: ConnectionHintStore = connectionHints
): ConnectionHints | null {
  const hints = store.state;
  store.setState(() => null);
  return hints;
}

/** The drag's verdict on `connection`, when it is the drag's cable. */
function hintedVerdict(
  hints: ConnectionHints | null,
  graph: NodeGraph,
  connection: Connection
): Verdict | undefined {
  if (!hints || hints.graph !== graph) {
    return;
  }
  const { from } = hints;
  const fromSource = from.type === "source";
  const [node, handle] = fromSource
    ? [connection.source, connection.sourceHandle]
    : [connection.target, connection.targetHandle];
  if (node !== from.node || handle !== from.handle) {
    return;
  }
  const other = fromSource
    ? portKey(connection.target, connection.targetHandle ?? "")
    : portKey(connection.source, connection.sourceHandle ?? "");
  return hints.verdicts.get(other);
}

/**
 * React Flow's isValidConnection: the drag's verdict when there is one,
 * else `connectionVerdict` itself, so both always agree.
 */
export function canConnect(
  graph: NodeGraph,
  connection: Connection,
  options?: ValidateOptions,
  store: ConnectionHintStore = connectionHints
): boolean {
  return (
    hintedVerdict(store.state, graph, connection) ??
    connectionVerdict(graph, connection, options)
  ).ok;
}

/** The verdict under `key`, taken for the drag from `dragFrom`, if any. */
export function readPortHint(
  hints: ConnectionHints | null,
  dragFrom: string | null,
  key: string
): Verdict | undefined {
  if (!(hints && dragFrom === portKey(hints.from.node, hints.from.handle))) {
    return;
  }
  return hints.verdicts.get(key);
}

/**
 * A port's verdict while a cable is dragged, or tapped out, from `dragFrom`
 * (`"<nodeId> <handleId>"`, from React Flow's connection state); undefined
 * when nothing is dragged, or the hints belong to another drag.
 */
export function usePortHint(
  dragFrom: string | null,
  key: string,
  store: ConnectionHintStore = connectionHints
): Verdict | undefined {
  return useStore(store, (hints) => readPortHint(hints, dragFrom, key));
}
