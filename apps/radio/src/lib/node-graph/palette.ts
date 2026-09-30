/**
 * Node Palette
 *
 * What the add-node palette offers and what picking an entry does, as pure
 * functions over the graph. Sources, FX, Routing and Outputs are the shipped
 * node types (a Station can come pre-filled with a station; an effect comes on),
 * Templates replace the patch. A cable dropped on empty space narrows the list to nodes with a
 * port that takes it and wires the new node in; a cable dropped on a node
 * connects when exactly one of its ports fits. Every check is the same
 * `validateConnection` React Flow runs while dragging. `I` on a cable
 * narrows it to nodes that can go into that cable, and "Swap effect…" to
 * the effects an FX can become.
 */

import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import type { Radio } from "@/lib/audio/playback/types";
import { bandCountOf, withBandCount } from "./branches";
import {
  createNodeEffectConfig,
  getNodeDefinition,
  isEffectNodeType,
  isShipped,
  NODE_DEFINITIONS,
  type NodeDefinition,
  type NodePort,
  portHandleId,
} from "./catalogue";
import { endLabel, portName } from "./describe";
import {
  connectNodes,
  insertNodeOnEdge,
  isSwappableType,
  nextStationPosition,
  uniqueId,
  wireToSpeakers,
} from "./graph-edits";
import {
  type EffectNodeType,
  type GraphNode,
  graphNodeSchema,
  NATIVE_NODE_TYPES,
  type NodeGraph,
  type NodeType,
} from "./schema";
import { type NodeTemplateId, SPEAKERS_NODE_ID } from "./templates";
import {
  type Connection,
  type Issue,
  kindsPatch,
  parseHandleId,
  type ValidateOptions,
  validateConnection,
} from "./validate";

type Position = GraphNode["position"];

export type PaletteSection =
  | "sources"
  | "fx"
  | "routing"
  | "outputs"
  | "templates";

export type PaletteNodeEntry = {
  kind: "node";
  /** Stable React key; also what a test or a shortcut picks by. */
  id: string;
  section: "sources" | "fx" | "routing" | "outputs";
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
    description: "A talk station ducks a music station while it speaks",
    id: "template:duck",
    kind: "template",
    name: "Duck",
    section: "templates",
    template: "duck",
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
  fx: "fx",
  output: "outputs",
  routing: "routing",
  source: "sources",
} as const;

/**
 * Section order: what makes sound, what shapes it, how it splits and
 * joins, where it goes.
 */
const SECTION_ORDER = ["sources", "fx", "routing", "outputs"] as const;

/** Splits first, then the Merge that closes them. */
const ROUTING_ORDER: readonly NodeType[] = [
  "fxComposite",
  "stereoSplit",
  "frequencySplit",
  "merge",
];

/** A new Band Split starts at low, mid and high. */
const NEW_BAND_COUNT = 3;

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
  // An effect placed in a patch is meant to sound, so it starts on.
  const data = isEffectNodeType(type)
    ? { effect: { ...createEffect(type, id), enabled: true } }
    : {};
  const parsed = graphNodeSchema.safeParse({ data, id, position, type });
  return parsed.success ? parsed.data : null;
}

function createEffect(type: EffectNodeType, id: string): EffectConfig {
  const effect = createNodeEffectConfig(type, id);
  if (effect.type === "fxComposite") {
    // Named as the canvas names its branches, so MIDI lists "Branch 1 gain".
    return {
      ...effect,
      chains: effect.chains.map((chain, index) => ({
        ...chain,
        name: `Branch ${index + 1}`,
      })),
    };
  }
  // Band crossovers start from the defaults for three bands.
  return effect.type === "frequencySplit"
    ? withBandCount({ ...effect, crossoverFrequencies: [] }, NEW_BAND_COUNT)
    : effect;
}

/**
 * What an effect node's Reset puts back: its params as the palette creates
 * them, still on or off. A Band Split keeps its band count, and so its cables.
 */
export function resetEffect(effect: EffectConfig): EffectConfig {
  const fresh = createEffect(effect.type, effect.id);
  const reset =
    fresh.type === "frequencySplit" && effect.type === "frequencySplit"
      ? withBandCount(
          { ...fresh, crossoverFrequencies: [] },
          bandCountOf(effect)
        )
      : fresh;
  return { ...reset, enabled: effect.enabled };
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

/**
 * Shipped Sources, FX, Routing and Outputs, in section order; Speakers only
 * while the patch has none.
 */
function nodeTypesOnOffer(
  graph: NodeGraph,
  release: ValidateOptions["release"] = "v1"
): NodeType[] {
  const offered = Object.values(NODE_DEFINITIONS).filter(
    (definition) =>
      definition.category in SECTION_OF &&
      isShipped(definition.ship, release) &&
      !(definition.type === "speakers" && speakersPresent(graph))
  );
  return SECTION_ORDER.flatMap((section) =>
    offered
      .filter(
        (definition) =>
          SECTION_OF[definition.category as keyof typeof SECTION_OF] === section
      )
      .sort(byStripThenName)
      .map((definition) => definition.type)
  );
}

/**
 * The native strip (Filter, Pan, Gain) leads FX; effects go by name.
 * Routing lists splits before the Merge that closes them.
 */
function byStripThenName(left: NodeDefinition, right: NodeDefinition) {
  const strip = (definition: NodeDefinition) =>
    definition.native
      ? NATIVE_NODE_TYPES.indexOf(definition.native)
      : NATIVE_NODE_TYPES.length;
  const routing = (definition: NodeDefinition) =>
    ROUTING_ORDER.includes(definition.type)
      ? ROUTING_ORDER.indexOf(definition.type)
      : ROUTING_ORDER.length;
  return (
    strip(left) - strip(right) ||
    routing(left) - routing(right) ||
    (left.category === "fx" && right.category === "fx"
      ? left.name.localeCompare(right.name)
      : 0)
  );
}

export type PaletteOptions = ValidateOptions & {
  /** Stations a Station entry can come filled with; hidden ones are left out. */
  radios?: readonly Radio[];
  from?: PaletteFrom | null;
  /** A cable to insert the pick into (`I`). */
  into?: string | null;
  /** An FX node to swap to the pick ("Swap effect…"). */
  swap?: string | null;
};

/** Whether a new node of `type` could take the cable, or go into it. */
function fits(
  graph: NodeGraph,
  type: NodeType,
  { from, into, ...options }: PaletteOptions
): boolean {
  if (!(from || into)) {
    return true;
  }
  const probe = createPaletteNode(type, PROBE_ID, { x: 0, y: 0 });
  if (!probe) {
    return false;
  }
  const probed = withNode(graph, probe);
  return from
    ? validCables(probed, probe, from, options).length > 0
    : insertNodeOnEdge(probed, PROBE_ID, into ?? "", options).ok;
}

/**
 * The palette's entries, in section order. With `from`, only nodes that can
 * take the dropped cable; with `into`, only nodes that can go into that
 * cable; with `swap`, only the other effects that FX can become. None of
 * those lists templates.
 */
export function paletteEntries(
  graph: NodeGraph,
  {
    radios = [],
    from = null,
    into = null,
    swap = null,
    ...options
  }: PaletteOptions = {}
): PaletteEntry[] {
  if (swap) {
    return swapEntries(graph, swap, options.release);
  }
  const entries: PaletteEntry[] = [];
  for (const type of nodeTypesOnOffer(graph, options.release)) {
    const definition = getNodeDefinition(type);
    const section = SECTION_OF[definition.category as keyof typeof SECTION_OF];
    if (!fits(graph, type, { ...options, from, into })) {
      continue;
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
  return from || into ? entries : [...entries, ...PALETTE_TEMPLATES];
}

/** The effects an FX node can swap to: every other shipped non-split FX. */
function swapEntries(
  graph: NodeGraph,
  nodeId: string,
  release: ValidateOptions["release"]
): PaletteEntry[] {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  if (!(node && isSwappableType(node.type))) {
    return [];
  }
  return nodeTypesOnOffer(graph, release)
    .filter((type) => isSwappableType(type) && type !== node.type)
    .map(
      (type): PaletteNodeEntry => ({
        id: type,
        kind: "node",
        name: getNodeDefinition(type).name,
        section: "fx",
        type,
      })
    );
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

function nodeIdFor(graph: NodeGraph, type: NodeType): string {
  // Deleted nodes keep their MIDI bindings for Undo; new instances must not reuse them.
  return type === "speakers"
    ? uniqueId(SPEAKERS_NODE_ID, new Set(graph.nodes.map((node) => node.id)))
    : `${type}-${crypto.randomUUID()}`;
}

export type AddPaletteNodeOptions = ValidateOptions & {
  /** Where the node's top-left goes; a free spot when absent. */
  position?: Position;
  /** A dropped cable the new node is wired into. */
  from?: PaletteFrom | null;
  /** A cable the new node goes into. */
  into?: string | null;
};

/**
 * Adds the node an entry names. A dropped cable is wired into the node's
 * first port that takes it, and a cable picked with `I` gets the node
 * inserted into it; otherwise a new Station is wired to Speakers, as the
 * search bar does. Returns the same graph when the node can't be built.
 */
export function addPaletteNode(
  graph: NodeGraph,
  entry: PaletteNodeEntry,
  { position, from = null, into = null, ...options }: AddPaletteNodeOptions = {}
): { graph: NodeGraph; nodeId: string | null } {
  const nodeId = nodeIdFor(graph, entry.type);
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
  if (into) {
    const inserted = insertNodeOnEdge(added, nodeId, into, options);
    return { graph: inserted.ok ? inserted.graph : added, nodeId };
  }
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

/** The cable's own problem first, then what it would break elsewhere. */
function refusalOf(issues: readonly Issue[]): Issue | undefined {
  return issues.find((issue) => issue.target === "edge") ?? issues[0];
}

/**
 * Why a cable dropped on `nodeId`'s body didn't connect, as a toast says
 * it: e.g. a second station into a Merge, or a second key into a lane.
 * Every port the cable's kind may patch into counts, so a key cable (audio
 * into a sidechain) is explained too. A port that is only full gives way to
 * a port with a truer reason. Null when a port would take the cable (the
 * drop was only ambiguous) or the node has none of its kind.
 */
export function dropRefusal(
  graph: NodeGraph,
  from: PaletteFrom,
  nodeId: string,
  options?: ValidateOptions
): string | null {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  const kind = parseHandleId(from.handle)?.kind;
  if (!node || node.id === from.node || !kind) {
    return null;
  }
  const refusals = facingPorts(node, from)
    .filter((port) =>
      from.type === "source"
        ? kindsPatch(kind, port.kind)
        : kindsPatch(port.kind, kind)
    )
    .map((port) =>
      refusalOf(
        validateConnection(graph, cableBetween(from, node.id, port), options)
      )
    );
  if (refusals.includes(undefined)) {
    return null;
  }
  return (
    (refusals.find((issue) => issue?.code !== "port-max") ?? refusals[0])
      ?.message ?? null
  );
}

/** What a cable let go over a node does: connect, or say why it can't. */
export type DropOutcome = { connect: Connection } | { refuse: string | null };

/**
 * A cable let go on one of `nodeId`'s ports takes that port or is refused
 * with its reason, e.g. "Audio can't drive control; use a Follower". It
 * never lands on another port of the node, so a key dropped on a loose
 * Compressor's key input can't turn into an audio cable. Let go on the
 * body, or on a port that is only full, it takes the one port that fits,
 * else says why none did.
 */
export function dropOnNode(
  graph: NodeGraph,
  from: PaletteFrom,
  nodeId: string,
  port: string | null,
  options?: ValidateOptions
): DropOutcome {
  if (port) {
    const cable: Connection =
      from.type === "source"
        ? {
            source: from.node,
            sourceHandle: from.handle,
            target: nodeId,
            targetHandle: port,
          }
        : {
            source: nodeId,
            sourceHandle: port,
            target: from.node,
            targetHandle: from.handle,
          };
    const refusal = refusalOf(validateConnection(graph, cable, options));
    if (!refusal) {
      return { connect: cable };
    }
    if (refusal.code !== "port-max") {
      return { refuse: refusal.message };
    }
  }
  const cable = autoConnection(graph, from, nodeId, options);
  return cable
    ? { connect: cable }
    : { refuse: dropRefusal(graph, from, nodeId, options) };
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
