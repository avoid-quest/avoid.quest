/**
 * Node Palette
 *
 * What the add-node palette offers and what picking an entry does, as pure
 * functions over the graph. Sources and Outputs are the shipped node types
 * (a Station can come pre-filled with a station), Templates replace the
 * patch. A cable dropped on empty space narrows the list to nodes with a
 * port that takes it and wires the new node in; a cable dropped on a node
 * connects when exactly one of its ports fits. Every check is the same
 * `validateConnection` React Flow runs while dragging.
 */

import type { Radio } from "@/lib/audio/playback/types";
import {
  getNodeDefinition,
  isShipped,
  NODE_DEFINITIONS,
  type NodePort,
  portHandleId,
} from "./catalogue";
import { endLabel, portName } from "./describe";
import {
  connectNodes,
  nextStationPosition,
  uniqueId,
  wireToSpeakers,
} from "./graph-edits";
import {
  type GraphNode,
  graphNodeSchema,
  type NodeGraph,
  type NodeType,
} from "./schema";
import {
  type NodeTemplateId,
  SPEAKERS_NODE_ID,
  stationNodeId,
} from "./templates";
import {
  type Connection,
  type ValidateOptions,
  validateConnection,
} from "./validate";

type Position = GraphNode["position"];

export type PaletteSection = "sources" | "outputs" | "templates";

export type PaletteNodeEntry = {
  kind: "node";
  /** Stable React key; also what a test or a shortcut picks by. */
  id: string;
  section: "sources" | "outputs";
  type: NodeType;
  name: string;
  /** Set on a Station that comes filled with this station. */
  radio?: Radio;
};

export type PaletteTemplateEntry = {
  kind: "template";
  id: string;
  section: "templates";
  template: NodeTemplateId;
  name: string;
  description: string;
};

export type PaletteEntry = PaletteNodeEntry | PaletteTemplateEntry;

/** The end of a cable dropped on empty space, as React Flow reports it. */
export type PaletteFrom = {
  node: string;
  handle: string;
  /** "source" when the cable left an output, "target" when an input. */
  type: "source" | "target";
};

export const PALETTE_TEMPLATES: readonly PaletteTemplateEntry[] = [
  {
    description: "Your enabled stations, each wired to Speakers",
    id: "template:start-from-multiple",
    kind: "template",
    name: "Start from Multiple",
    section: "templates",
    template: "start-from-multiple",
  },
  {
    description: "Speakers only",
    id: "template:blank",
    kind: "template",
    name: "Blank",
    section: "templates",
    template: "blank",
  },
];

const SECTION_OF = {
  output: "outputs",
  source: "sources",
} as const;

/** The id a probe node takes while its ports are tried. */
const PROBE_ID = "palette-probe";

/** A node of `type` with its default data, or null if it can't be built yet. */
export function createPaletteNode(
  type: NodeType,
  id: string,
  position: Position,
  radio: Radio | null = null
): GraphNode | null {
  if (type === "station") {
    return {
      data: { muted: false, radio, volume: 1 },
      id,
      position,
      type,
    };
  }
  const parsed = graphNodeSchema.safeParse({ data: {}, id, position, type });
  return parsed.success ? parsed.data : null;
}

function withNode(graph: NodeGraph, node: GraphNode): NodeGraph {
  return { ...graph, nodes: [...graph.nodes, node] };
}

/** The ports on `node` that could take the other end of `from`. */
function facingPorts(node: GraphNode, from: PaletteFrom): NodePort[] {
  const direction = from.type === "source" ? "in" : "out";
  return getNodeDefinition(node.type).ports.filter(
    (port) => port.direction === direction
  );
}

function cableBetween(
  from: PaletteFrom,
  node: string,
  port: NodePort
): Connection {
  return from.type === "source"
    ? {
        source: from.node,
        sourceHandle: from.handle,
        target: node,
        targetHandle: portHandleId(port),
      }
    : {
        source: node,
        sourceHandle: portHandleId(port),
        target: from.node,
        targetHandle: from.handle,
      };
}

/** Every cable from `from` into `node` that would pass validation. */
function validCables(
  graph: NodeGraph,
  node: GraphNode,
  from: PaletteFrom,
  options?: ValidateOptions
): Connection[] {
  if (node.id === from.node) {
    return [];
  }
  return facingPorts(node, from)
    .map((port) => cableBetween(from, node.id, port))
    .filter((cable) => validateConnection(graph, cable, options).length === 0);
}

function speakersPresent(graph: NodeGraph): boolean {
  return graph.nodes.some((node) => node.type === "speakers");
}

/** Shipped Sources and Outputs; Speakers only while the patch has none. */
function nodeTypesOnOffer(
  graph: NodeGraph,
  release: ValidateOptions["release"] = "v1"
): NodeType[] {
  return Object.values(NODE_DEFINITIONS)
    .filter(
      (definition) =>
        (definition.category === "source" ||
          definition.category === "output") &&
        isShipped(definition.ship, release) &&
        !(definition.type === "speakers" && speakersPresent(graph))
    )
    .map((definition) => definition.type);
}

export type PaletteOptions = ValidateOptions & {
  /** Stations a Station entry can come filled with; hidden ones are left out. */
  radios?: readonly Radio[];
  from?: PaletteFrom | null;
};

/**
 * The palette's entries, in section order. With `from`, only nodes that can
 * take the dropped cable, and no templates.
 */
export function paletteEntries(
  graph: NodeGraph,
  { radios = [], from = null, ...options }: PaletteOptions = {}
): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  for (const type of nodeTypesOnOffer(graph, options.release)) {
    const definition = getNodeDefinition(type);
    const section = SECTION_OF[definition.category as keyof typeof SECTION_OF];
    if (from) {
      const probe = createPaletteNode(type, PROBE_ID, { x: 0, y: 0 });
      if (
        !probe ||
        validCables(withNode(graph, probe), probe, from, options).length === 0
      ) {
        continue;
      }
    }
    entries.push({
      id: type,
      kind: "node",
      name: definition.name,
      section,
      type,
    });
    if (type === "station") {
      // A session station saved under the same id is listed once.
      const listed = new Set<string>();
      for (const radio of radios) {
        const id = `station:${String(radio.id ?? radio.streamUrl)}`;
        if (radio.enabled === false || listed.has(id)) {
          continue;
        }
        listed.add(id);
        entries.push({
          id,
          kind: "node",
          name: radio.name,
          radio,
          section,
          type,
        });
      }
    }
  }
  return from ? entries : [...entries, ...PALETTE_TEMPLATES];
}

/** Right of the rightmost node, for an output with nowhere better to go. */
function besideEverything(graph: NodeGraph): Position {
  if (graph.nodes.length === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: Math.max(...graph.nodes.map((node) => node.position.x)) + 280,
    y: Math.min(...graph.nodes.map((node) => node.position.y)),
  };
}

function nodeIdFor(
  graph: NodeGraph,
  type: NodeType,
  radio: Radio | undefined
): string {
  const taken = new Set(graph.nodes.map((node) => node.id));
  if (type === "station") {
    return radio ? stationNodeId(radio, taken) : uniqueId("src-slot", taken);
  }
  return uniqueId(type === "speakers" ? SPEAKERS_NODE_ID : type, taken);
}

export type AddPaletteNodeOptions = ValidateOptions & {
  /** Where the node's top-left goes; a free spot when absent. */
  position?: Position;
  /** A dropped cable the new node is wired into. */
  from?: PaletteFrom | null;
};

/**
 * Adds the node an entry names. A dropped cable is wired into the node's
 * first port that takes it; otherwise a new Station is wired to Speakers,
 * as the search bar does. Returns the same graph when the node can't be
 * built.
 */
export function addPaletteNode(
  graph: NodeGraph,
  entry: PaletteNodeEntry,
  { position, from = null, ...options }: AddPaletteNodeOptions = {}
): { graph: NodeGraph; nodeId: string | null } {
  const nodeId = nodeIdFor(graph, entry.type, entry.radio);
  const node = createPaletteNode(
    entry.type,
    nodeId,
    position ??
      (entry.type === "station"
        ? nextStationPosition(graph)
        : besideEverything(graph)),
    entry.radio ?? null
  );
  if (!node) {
    return { graph, nodeId: null };
  }
  const added = withNode(graph, node);
  if (from) {
    const [cable] = validCables(added, node, from, options);
    return { graph: cable ? connectNodes(added, cable) : added, nodeId };
  }
  if (entry.type === "station") {
    return {
      graph: { ...added, edges: wireToSpeakers(added, nodeId) },
      nodeId,
    };
  }
  return { graph: added, nodeId };
}

/**
 * The cable to make when a drag from `from` ends on node `nodeId` rather
 * than on a port: set only when exactly one of its ports fits.
 */
export function autoConnection(
  graph: NodeGraph,
  from: PaletteFrom,
  nodeId: string,
  options?: ValidateOptions
): Connection | null {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return null;
  }
  const cables = validCables(graph, node, from, options);
  return cables.length === 1 ? (cables[0] ?? null) : null;
}

export type ConnectTarget = {
  /** Unique within its port, e.g. `speakers in:audio:main`. */
  key: string;
  /** "Speakers input" or "KEXP audio". */
  label: string;
  connection: Connection;
};

export type ConnectPort = {
  handle: string;
  /** "Audio out", "Key input". */
  label: string;
  targets: ConnectTarget[];
};

/**
 * What the keyboard Connect… dialog offers for `nodeId`: each of its ports
 * that can take a new cable, with every other port that cable could reach.
 */
export function connectPorts(
  graph: NodeGraph,
  nodeId: string,
  options?: ValidateOptions
): ConnectPort[] {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return [];
  }
  const ports: ConnectPort[] = [];
  for (const port of getNodeDefinition(node.type).ports) {
    const from: PaletteFrom = {
      handle: portHandleId(port),
      node: node.id,
      type: port.direction === "out" ? "source" : "target",
    };
    const targets = graph.nodes.flatMap((other) =>
      validCables(graph, other, from, options).map((connection) => {
        const handle =
          from.type === "source"
            ? connection.targetHandle
            : connection.sourceHandle;
        return {
          connection,
          key: `${other.id} ${handle}`,
          label: endLabel(other, handle),
        };
      })
    );
    if (targets.length > 0) {
      ports.push({ handle: from.handle, label: portName(port), targets });
    }
  }
  return ports;
}
