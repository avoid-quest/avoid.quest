/**
 * Node Palette
 *
 * What the add-node palette offers and what picking an entry does, as pure
 * functions over the graph. Sources, FX, Routing and Outputs are the shipped
 * node types (a Station can come pre-filled with a station, a Track locked
 * to a platform chip, an Audio input or an Output device with a device the
 * browser lists; an effect comes on),
 * Templates replace the patch. A cable dropped on empty space narrows the list to nodes with a
 * port that takes it and wires the new node in; a cable dropped on a node
 * connects when exactly one of its ports fits. Every check is the same
 * `connectionVerdict` React Flow runs while dragging. `I` on a cable
 * narrows it to nodes that can go into that cable, and "Swap effect…" to
 * the effects an FX can become.
 */

import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import type { Radio } from "@/lib/audio/playback/types";
import { PLATFORM_SOURCE_DEFINITIONS } from "@/lib/dj-library-sources";
import { bandCountOf, withBandCount } from "./branches";
import {
  createNodeEffectConfig,
  getNodeDefinition,
  isEffectNodeType,
  isShipped,
  NODE_DEFINITIONS,
  type NodeDefinition,
  type NodePort,
  type PortKind,
  portHandleId,
} from "./catalogue";
import { endLabel, portName } from "./describe";
import {
  connectNodes,
  findStationNode,
  insertNodeOnEdge,
  isSwappableType,
  nextFxPosition,
  nextOutputPosition,
  nextStationPosition,
  reconnectEdge,
  uniqueId,
  wireToSpeakers,
  withFxColumn,
} from "./graph-edits";
import {
  type EffectNodeType,
  type GraphNode,
  graphNodeSchema,
  isRadioSourceNode,
  NATIVE_NODE_TYPES,
  type NodeGraph,
  type NodeType,
  OUTPUT_NODE_TYPES,
  RADIO_SOURCE_NODE_TYPES,
  stripForType,
  TRACK_SEARCH_PLATFORMS,
  type TrackSearchPlatform,
} from "./schema";
import {
  buildNodeGraphFromTemplate,
  type NodeTemplateId,
  type NodeTemplateSources,
  SPEAKERS_NODE_ID,
  stationNodeId,
} from "./templates";
import {
  type Connection,
  connectionVerdict,
  deviceOutVerdict,
  kindsPatch,
  parseHandleId,
  type ValidateOptions,
  type Verdict,
} from "./validate";

type Position = GraphNode["position"];

export type PaletteSection =
  | "sources"
  | "fx"
  | "routing"
  | "outputs"
  | "templates";

/** An audio device as the palette offers it. */
export type PaletteDevice = { deviceId: string; label: string };

export type PaletteNodeEntry = {
  kind: "node";
  /** Stable React key; also what a test or a shortcut picks by. */
  id: string;
  section: "sources" | "fx" | "routing" | "outputs";
  type: NodeType;
  name: string;
  /** Set on a Station that comes filled with this station. */
  radio?: Radio;
  /** Set on a Track whose search comes locked to this platform chip. */
  searchPlatform?: TrackSearchPlatform;
  /** Set on an Audio input or Output device that comes set to this device. */
  device?: PaletteDevice;
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

/** Starter first: it is also the patch a new node session opens with. */
export const PALETTE_TEMPLATES: readonly PaletteTemplateEntry[] = [
  {
    description: "One station slot wired to Speakers",
    id: "template:starter",
    kind: "template",
    name: "Starter",
    section: "templates",
    template: "starter",
  },
  {
    description: "Your enabled stations, each wired to Speakers",
    id: "template:start-from-multiple",
    kind: "template",
    name: "All my stations",
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

/**
 * The patch `template` puts in place of `current`: the view stays, and a
 * station already in the patch keeps its level. Committed whole, it is one
 * undo step.
 */
export function templatePatch(
  current: NodeGraph,
  template: NodeTemplateId,
  sources: Pick<NodeTemplateSources, "saved" | "session"> = {}
): NodeGraph {
  return {
    ...buildNodeGraphFromTemplate(template, {
      ...sources,
      levels: (radio) => {
        const station = findStationNode(current, radio);
        return station
          ? { muted: station.data.muted, volume: station.data.volume }
          : undefined;
      },
    }),
    viewport: current.viewport,
  };
}

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

/**
 * Within a section: Station, Track and File before Audio input (saved
 * stations follow them all), splits before the Merge that closes them,
 * Speakers before Output devices.
 */
const PLACE_ORDER: readonly NodeType[] = [
  "station",
  "platform",
  "file",
  "deviceIn",
  "fxComposite",
  "stereoSplit",
  "frequencySplit",
  "merge",
  "speakers",
  "deviceOut",
];

/** The main output's own id: Speakers already play there. */
const DEFAULT_OUTPUT_ID = "default";

/** A new Band Split starts at low, mid and high. */
const NEW_BAND_COUNT = 3;

/** The id a probe node takes while its ports are tried. */
const PROBE_ID = "palette-probe";

/** A node of `type` with its default data, or null if it can't be built yet. */
export function createPaletteNode(
  type: NodeType,
  id: string,
  position: Position,
  radio: Radio | null = null,
  device: PaletteDevice | null = null,
  searchPlatform?: TrackSearchPlatform
): GraphNode | null {
  if (type === "station") {
    return {
      data: { muted: false, radio, strip: stripForType(type), volume: 1 },
      id,
      position,
      type,
    };
  }
  if (type === "file") {
    return {
      data: { muted: false, radio, strip: stripForType(type), volume: 1 },
      id,
      position,
      type,
    };
  }
  if (type === "platform") {
    return {
      data: {
        muted: false,
        radio,
        searchPlatform,
        strip: stripForType(type),
        volume: 1,
      },
      id,
      position,
      type,
    };
  }
  // An effect placed in a patch is meant to sound, so it starts on.
  let data: Record<string, unknown> = {};
  if (isEffectNodeType(type)) {
    data = { effect: { ...createEffect(type, id), enabled: true } };
  } else if (device && (type === "deviceIn" || type === "deviceOut")) {
    data = { deviceId: device.deviceId, deviceLabel: device.label };
  }
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
    .filter((cable) => connectionVerdict(graph, cable, options).ok);
}

/** The key a port's verdict goes under: `"<nodeId> <handleId>"`. */
export function portKey(nodeId: string, handle: string): string {
  return `${nodeId} ${handle}`;
}

/**
 * What a cable dragged from `from` may end on: a verdict for every shipped
 * port in the patch, keyed by `portKey`. Taken once when a drag starts, so
 * lighting the ports costs one validation per port facing the drag, not
 * one per port per pointer move. Ports on the drag's own side are refused
 * without one.
 */
export function connectableHandles(
  graph: NodeGraph,
  from: PaletteFrom,
  options?: ValidateOptions
): Map<string, Verdict> {
  const verdicts = new Map<string, Verdict>();
  for (const node of graph.nodes) {
    const definition = getNodeDefinition(node.type);
    for (const port of definition.ports) {
      if (isShipped(port.ship ?? definition.ship, options?.release ?? "v1")) {
        verdicts.set(
          portKey(node.id, portHandleId(port)),
          connectionVerdict(graph, cableBetween(from, node.id, port), options)
        );
      }
    }
  }
  return verdicts;
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
 * Other sections keep `PLACE_ORDER`.
 */
function byStripThenName(left: NodeDefinition, right: NodeDefinition) {
  const strip = (definition: NodeDefinition) =>
    definition.native
      ? NATIVE_NODE_TYPES.indexOf(definition.native)
      : NATIVE_NODE_TYPES.length;
  const place = (definition: NodeDefinition) =>
    PLACE_ORDER.includes(definition.type)
      ? PLACE_ORDER.indexOf(definition.type)
      : PLACE_ORDER.length;
  return (
    strip(left) - strip(right) ||
    place(left) - place(right) ||
    (left.category === "fx" && right.category === "fx"
      ? left.name.localeCompare(right.name)
      : 0)
  );
}

export type PaletteOptions = ValidateOptions & {
  /** Stations a Station entry can come filled with; hidden ones are left out. */
  radios?: readonly Radio[];
  /** Audio devices the browser lists; each gets an entry set to it. */
  devices?: {
    inputs: readonly PaletteDevice[];
    outputs: readonly PaletteDevice[];
  };
  /**
   * Whether the browser can choose an output (`setSinkId`). Without it,
   * as on Safari, no Output device is offered.
   */
  sinkSelection?: boolean;
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
    devices = { inputs: [], outputs: [] },
    sinkSelection = false,
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
    if (
      (type === "deviceOut" && !sinkSelection) ||
      !fits(graph, type, { ...options, from, into })
    ) {
      continue;
    }
    if (type === "deviceOut") {
      entries.push(...outputDeviceEntries(graph, devices.outputs));
      continue;
    }
    entries.push(
      { id: type, kind: "node", name: definition.name, section, type },
      ...(type === "platform" ? trackChipEntries() : []),
      ...(type === "deviceIn" ? inputDeviceEntries(devices.inputs) : [])
    );
  }
  // Saved stations close Sources, so a long list can't bury the inputs.
  const station = entries.findIndex((entry) => entry.id === "station");
  if (station !== -1) {
    const sources = entries.filter((entry) => entry.section === "sources");
    entries.splice(station + sources.length, 0, ...stationEntries(radios));
  }
  return from || into ? entries : [...entries, ...PALETTE_TEMPLATES];
}

/** A Station per saved station, filled with it; hidden ones left out. */
function stationEntries(radios: readonly Radio[]): PaletteNodeEntry[] {
  // A session station saved under the same id is listed once.
  const listed = new Set<string>();
  const entries: PaletteNodeEntry[] = [];
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
      section: "sources",
      type: "station",
    });
  }
  return entries;
}

/**
 * The platform a Track chip locks its search to, with DJ's name, blurb,
 * colour and icon for it (dj-library-sources.ts).
 */
export function trackChip(platform: TrackSearchPlatform) {
  const definition = PLATFORM_SOURCE_DEFINITIONS.find(
    (entry) => entry.pendingPlatform === platform
  );
  return {
    color: definition?.color ?? "#ff7700",
    description: definition?.radio.description ?? "",
    icon: definition?.icon ?? "search",
    name: definition?.radio.name ?? platform,
  };
}

/**
 * A Track per platform chip, its search locked to it. The plain Track is
 * DJ's "Search all": the same search, unlocked.
 */
function trackChipEntries(): PaletteNodeEntry[] {
  return TRACK_SEARCH_PLATFORMS.map((platform) => ({
    id: `platform:${platform}`,
    kind: "node",
    name: trackChip(platform).name,
    searchPlatform: platform,
    section: "sources",
    type: "platform",
  }));
}

/** An Audio input per input the browser lists, set to it. */
function inputDeviceEntries(
  inputs: readonly PaletteDevice[]
): PaletteNodeEntry[] {
  return inputs.map((device) => ({
    device,
    id: `deviceIn:${device.deviceId}`,
    kind: "node",
    name: device.label,
    section: "sources",
    type: "deviceIn",
  }));
}

/**
 * One Output device per output the browser lists, set to it, leaving out
 * the main output Speakers already play on and any device an Output device
 * already has. With none but the main output listed yet, one to set up in
 * its body.
 */
function outputDeviceEntries(
  graph: NodeGraph,
  outputs: readonly PaletteDevice[]
): PaletteNodeEntry[] {
  const { name } = getNodeDefinition("deviceOut");
  const others = outputs.filter(
    (device) => device.deviceId !== DEFAULT_OUTPUT_ID
  );
  if (others.length === 0) {
    return [
      {
        id: "deviceOut",
        kind: "node",
        name,
        section: "outputs",
        type: "deviceOut",
      },
    ];
  }
  return others
    .filter((device) => deviceOutVerdict(graph, device.deviceId).ok)
    .map((device) => ({
      device,
      id: `deviceOut:${device.deviceId}`,
      kind: "node",
      name: device.label,
      section: "outputs",
      type: "deviceOut",
    }));
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

/** Right of the rightmost node, for a node with nowhere better to go. */
function besideEverything(graph: NodeGraph): Position {
  if (graph.nodes.length === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: Math.max(...graph.nodes.map((node) => node.position.x)) + 280,
    y: Math.min(...graph.nodes.map((node) => node.position.y)),
  };
}

/**
 * A source stacks in the source column, an output in the Speakers column,
 * and anything in between (an FX, a Gain, a Merge) in a column of its own
 * between them, so its cables run forward. With no Speakers, an output or
 * an FX goes beside everything.
 */
function defaultPosition(graph: NodeGraph, type: NodeType): Position {
  if (isRadioSourceType(type) || type === "deviceIn") {
    return nextStationPosition(graph);
  }
  if (isOutputType(type)) {
    return nextOutputPosition(graph) ?? besideEverything(graph);
  }
  return nextFxPosition(graph) ?? besideEverything(graph);
}

/** Whether a node of `type` lands in the FX column. */
function isFxColumnType(type: NodeType): boolean {
  return !(
    isRadioSourceType(type) ||
    type === "deviceIn" ||
    isOutputType(type)
  );
}

function isOutputType(type: NodeType): boolean {
  return (OUTPUT_NODE_TYPES as readonly string[]).includes(type);
}

function isRadioSourceType(type: NodeType): boolean {
  return (RADIO_SOURCE_NODE_TYPES as readonly string[]).includes(type);
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
 * inserted into it; otherwise a new Station, Track or File is wired to
 * Speakers, as the search bar does. An Audio input is never wired on its own: a mic into
 * speakers can howl, so that cable is the user's to make. Returns the
 * same graph when the node can't be built.
 */
export function addPaletteNode(
  start: NodeGraph,
  entry: PaletteNodeEntry,
  { position, from = null, into = null, ...options }: AddPaletteNodeOptions = {}
): { graph: NodeGraph; nodeId: string | null } {
  // An FX in a free spot gets its column, Speakers moving right for it; the
  // spot is found before the move, which can shift where a sourceless
  // patch's column would be.
  const graph =
    position || !isFxColumnType(entry.type) ? start : withFxColumn(start);
  const nodeId = nodeIdFor(graph, entry.type);
  const node = createPaletteNode(
    entry.type,
    nodeId,
    position ?? defaultPosition(start, entry.type),
    entry.radio ?? null,
    entry.device ?? null,
    entry.searchPlatform
  );
  if (!node) {
    return { graph: start, nodeId: null };
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
  if (isRadioSourceNode(node)) {
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

type Refusal = Extract<Verdict, { ok: false }>;

/**
 * Why a cable dropped on `nodeId`'s body didn't connect, as a toast says
 * it: e.g. a second station into a Merge, or a second key into a lane.
 * Every port the cable's kind may patch into counts, so a key cable (audio
 * into a sidechain) is explained too. A port that is only full gives way to
 * a port with a truer reason. A node with no port of the cable's kind at
 * all says why when that is the rule, e.g. a Station takes no audio in.
 * Null when a port would take the cable (the drop was only ambiguous).
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
  const verdicts = facingPorts(node, from)
    .filter((port) =>
      from.type === "source"
        ? kindsPatch(kind, port.kind)
        : kindsPatch(port.kind, kind)
    )
    .map((port) =>
      connectionVerdict(graph, cableBetween(from, node.id, port), options)
    );
  if (verdicts.length === 0) {
    return noPortRefusal(graph, from, node, kind, options);
  }
  const refusals = verdicts.filter(
    (verdict): verdict is Refusal => !verdict.ok
  );
  if (refusals.length < verdicts.length) {
    return null;
  }
  return (
    (refusals.find((refusal) => refusal.code !== "port-max") ?? refusals[0])
      ?.message ?? null
  );
}

/**
 * A node with no port for the cable: said only when that is a rule of the
 * node, a source taking no audio in or an output giving none out.
 */
function noPortRefusal(
  graph: NodeGraph,
  from: PaletteFrom,
  node: GraphNode,
  kind: PortKind,
  options?: ValidateOptions
): string | null {
  const facing = from.type === "source" ? "in" : "out";
  // A key cable leaves an audio output.
  const facingKind = facing === "out" && kind === "sidechain" ? "audio" : kind;
  const verdict = connectionVerdict(
    graph,
    cableBetween(from, node.id, {
      direction: facing,
      id: "main",
      kind: facingKind,
      label: "",
      max: 1,
    }),
    options
  );
  return !verdict.ok &&
    (verdict.code === "no-audio-in" || verdict.code === "no-out")
    ? verdict.message
    : null;
}

/** The cable a refused one can take the place of, and the cable it becomes. */
export type Replacement = { edge: string; connection: Connection };

/**
 * What a cable let go over a node does: connect, or say why it can't. A
 * refusal for a one-cable port that has its cable offers to replace it.
 */
export type DropOutcome =
  | { connect: Connection }
  | { refuse: string | null; replace?: Replacement };

/**
 * A cable let go on one of `nodeId`'s ports takes that port or is refused
 * with its reason, e.g. "Audio can't turn a knob". It never lands on
 * another port of the node, so a key dropped on a loose Compressor's key
 * input can't turn into an audio cable. Let go on the body, or on a port
 * that is only full, it takes the one port that fits, else says why none
 * did.
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
    const verdict = connectionVerdict(graph, cable, options);
    if (verdict.ok) {
      return { connect: cable };
    }
    if (verdict.code !== "port-max") {
      return { refuse: verdict.message };
    }
  }
  const cable = autoConnection(graph, from, nodeId, options);
  if (cable) {
    return { connect: cable };
  }
  const refuse = dropRefusal(graph, from, nodeId, options);
  const replace = refuse
    ? replacement(graph, from, nodeId, port, options)
    : null;
  return replace ? { refuse, replace } : { refuse };
}

/**
 * The one full port a refused drop could go into instead, when that port
 * takes a single cable: its cable moves to the drop's far end, so the drop
 * replaces it. Let go on the body, only when one such port faces the cable
 * and the refusal is only that it is full.
 */
function replacement(
  graph: NodeGraph,
  from: PaletteFrom,
  nodeId: string,
  port: string | null,
  options?: ValidateOptions
): Replacement | null {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  const kind = parseHandleId(from.handle)?.kind;
  if (!node || node.id === from.node || !kind) {
    return null;
  }
  const patches = (facing: NodePort) =>
    from.type === "source"
      ? kindsPatch(kind, facing.kind)
      : kindsPatch(facing.kind, kind);
  const verdicts = facingPorts(node, from)
    .filter((facing) =>
      port === null ? patches(facing) : portHandleId(facing) === port
    )
    .map((facing) => {
      const cable = cableBetween(from, node.id, facing);
      return { cable, verdict: connectionVerdict(graph, cable, options) };
    });
  // A port refused for a truer reason than being full says that instead.
  if (
    verdicts.some(({ verdict }) => !verdict.ok && verdict.code !== "port-max")
  ) {
    return null;
  }
  const found = verdicts.flatMap(({ cable }): Replacement[] => {
    const held = graph.edges.filter((edge) =>
      from.type === "source"
        ? edge.target === node.id && edge.targetHandle === cable.targetHandle
        : edge.source === node.id && edge.sourceHandle === cable.sourceHandle
    );
    const [only] = held;
    return held.length === 1 &&
      only &&
      reconnectEdge(graph, only.id, cable, options).ok
      ? [{ connection: cable, edge: only.id }]
      : [];
  });
  return found.length === 1 ? (found[0] ?? null) : null;
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

/** Ports a selected cable end can move to, including each refusal reason. */
export function rewireTargets(
  graph: NodeGraph,
  edgeId: string,
  end: "source" | "target",
  options?: ValidateOptions
): (ConnectTarget & { reason: string | null })[] {
  const edge = graph.edges.find((entry) => entry.id === edgeId);
  if (!edge) {
    return [];
  }
  const without = {
    ...graph,
    edges: graph.edges.filter((entry) => entry.id !== edgeId),
  };
  // The end that stays put decides which ports fit: audio may move between
  // a normal input and a key (sidechain) input, as a drag can.
  const fixed = parseHandleId(
    edge[end === "source" ? "targetHandle" : "sourceHandle"]
  )?.kind;
  const canTake = (port: NodePort) =>
    fixed !== undefined &&
    (end === "source"
      ? port.direction === "out" && kindsPatch(port.kind, fixed)
      : port.direction === "in" && kindsPatch(fixed, port.kind));
  return graph.nodes.flatMap((node) =>
    getNodeDefinition(node.type)
      .ports.filter(canTake)
      .map((port) => {
        const handle = portHandleId(port);
        const connection: Connection = {
          source: end === "source" ? node.id : edge.source,
          sourceHandle: end === "source" ? handle : edge.sourceHandle,
          target: end === "target" ? node.id : edge.target,
          targetHandle: end === "target" ? handle : edge.targetHandle,
        };
        const verdict = connectionVerdict(without, connection, options);
        return {
          connection,
          key: `${node.id} ${handle}`,
          label: endLabel(node, handle),
          reason: verdict.ok ? null : verdict.message,
        };
      })
  );
}
