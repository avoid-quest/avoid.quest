/**
 * Node Graph Validation
 *
 * Checks a patch against the port-kind rules, per-port limits, lane rules,
 * the feedback rule and the device budgets. Every problem is an Issue keyed
 * by the node or cable it belongs to; invalid cables never reach the compiler.
 * The same check runs on drag, on load and on import, and every "can this
 * cable connect?" question goes through `connectionVerdict`.
 */

import {
  getNodeDefinition,
  isShipped,
  type NodeDefinition,
  type NodePort,
  type PortDirection,
  type PortKind,
  type ShipLevel,
} from "./catalogue";
import type { GraphEdge, GraphNode, NodeGraph, NodeType } from "./schema";

export type Profile = "desktop" | "mobile";

export type IssueCode =
  | "unshipped"
  | "missing-node"
  | "bad-handle"
  | "unknown-port"
  | "self-loop"
  | "no-audio-in"
  | "no-out"
  | "kind-mismatch"
  | "audio-to-control"
  | "duplicate-edge"
  | "port-max"
  | "one-speakers"
  | "sidechain-source"
  | "sidechain-target"
  | "lane-key"
  | "feedback-needs-loop"
  | "control-cycle"
  | "budget-playing"
  | "budget-sources"
  | "budget-loops"
  | "budget-tape-warp"
  | "budget-tape-warp-time"
  | "budget-lfos"
  | "budget-edges"
  // Raised by the compiler, where the patch's shape is known.
  | "split-depth"
  | "split-branches"
  | "split-open";

export type Issue = {
  code: IssueCode;
  message: string;
  target: "node" | "edge";
  id: string;
};

export type NodeBudget = {
  /** Stream sources playing at once: each costs a decoder, hls.js and a worklet. */
  playingStreams: number;
  sources: number;
  loops: number;
  tapeWarps: number;
  tapeWarpSeconds: number;
  lfos: number;
  edges: number;
};

/** Mobile is a coarse pointer or iOS, where every FX lane is one worklet. */
export const NODE_BUDGETS: Readonly<Record<Profile, NodeBudget>> = {
  desktop: {
    edges: 64,
    lfos: 8,
    loops: 4,
    playingStreams: 6,
    sources: 24,
    tapeWarpSeconds: 30,
    tapeWarps: 2,
  },
  mobile: {
    edges: 64,
    lfos: 8,
    loops: 4,
    playingStreams: 4,
    sources: 24,
    tapeWarpSeconds: 10,
    tapeWarps: 1,
  },
};

export type ValidateOptions = {
  profile?: Profile;
  /** Node types and ports beyond this ship level are refused. */
  release?: ShipLevel;
  /** Source node ids that are playing or starting, oldest first. */
  playing?: readonly string[];
};

export type Connection = {
  id?: string;
  source: string;
  sourceHandle: string | null | undefined;
  target: string;
  targetHandle: string | null | undefined;
};

type ValidatableGraph = Pick<NodeGraph, "nodes" | "edges">;

export type ParsedHandle = {
  direction: PortDirection;
  kind: PortKind;
  name: string;
};

const PORT_KINDS: readonly string[] = ["audio", "sidechain", "control", "midi"];

/** Parses a handle id `"<dir>:<kind>:<name>"`, e.g. `in:sidechain:key`. */
export function parseHandleId(
  handle: string | null | undefined
): ParsedHandle | null {
  const [direction, kind, name, ...rest] = (handle ?? "").split(":");
  if (
    (direction !== "in" && direction !== "out") ||
    !(kind && PORT_KINDS.includes(kind)) ||
    !name ||
    rest.length > 0
  ) {
    return null;
  }
  return { direction, kind: kind as PortKind, name };
}

/** Nodes that always mix their sources: they sum or delay across lanes. */
const BUS_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "crossfade",
  "dial",
  "loop",
  "return",
  "tapeWarp",
]);

/** A cable that passed the port checks, with both ends resolved. */
export type WiredEdge = {
  edge: GraphEdge;
  from: NodePort;
  to: NodePort;
};

type Context = {
  graph: ValidatableGraph;
  nodes: Map<string, GraphNode>;
  release: ShipLevel;
  budget: NodeBudget;
  issues: Issue[];
};

function nodeIssue(
  context: Context,
  node: GraphNode,
  code: IssueCode,
  message: string
): void {
  context.issues.push({ code, id: node.id, message, target: "node" });
}

function edgeIssue(
  context: Context,
  edge: GraphEdge,
  code: IssueCode,
  message: string
): void {
  context.issues.push({ code, id: edge.id, message, target: "edge" });
}

function definitionOf(node: GraphNode): NodeDefinition {
  return getNodeDefinition(node.type);
}

function checkNodes(context: Context): void {
  let speakers = 0;
  for (const node of context.graph.nodes) {
    const definition = definitionOf(node);
    if (!isShipped(definition.ship, context.release)) {
      nodeIssue(
        context,
        node,
        "unshipped",
        `${definition.name} isn't available yet`
      );
    }
    if (node.type === "speakers") {
      speakers += 1;
      if (speakers > 1) {
        nodeIssue(context, node, "one-speakers", "A patch has one Speakers");
      }
    }
  }
}

function resolvePort(
  node: GraphNode,
  handle: string,
  direction: PortDirection
): NodePort | "bad-handle" | "unknown-port" {
  const parsed = parseHandleId(handle);
  if (!parsed || parsed.direction !== direction) {
    return "bad-handle";
  }
  const port = definitionOf(node).ports.find(
    (entry) =>
      entry.direction === direction &&
      entry.kind === parsed.kind &&
      entry.id === parsed.name
  );
  return port && !isInactiveBand(node, port) ? port : "unknown-port";
}

/**
 * A Band Split shows only its configured bands, so a port past them is as
 * missing as one it never had: the compiler would refuse the whole split.
 */
function isInactiveBand(node: GraphNode, port: NodePort): boolean {
  if (node.type !== "frequencySplit" || port.direction !== "out") {
    return false;
  }
  const { effect } = node.data;
  if (effect.type !== "frequencySplit") {
    return false;
  }
  const band = Number.parseInt(port.id.split("-").at(-1) ?? "", 10);
  return band > effect.crossoverFrequencies.length + 1;
}

/**
 * audio→audio, audio→sidechain, control→control and midi→midi only. Each
 * refusal says what the input takes, in the interface's words.
 */
function kindIssue(
  from: PortKind,
  to: PortKind
): { code: IssueCode; message: string } | null {
  if (from === "audio" && (to === "audio" || to === "sidechain")) {
    return null;
  }
  if (from === to && from !== "sidechain") {
    return null;
  }
  if (from === "audio" && to === "control") {
    return { code: "audio-to-control", message: "Audio can't turn a knob" };
  }
  const message: Record<PortKind, string> = {
    audio: "Only sound goes in here",
    control: "Only a control cable turns this knob",
    midi: "Only MIDI goes in here",
    sidechain: "Only audio can key this effect",
  };
  return { code: "kind-mismatch", message: message[to] };
}

/** Whether an output of kind `from` may feed an input of kind `to`. */
export function kindsPatch(from: PortKind, to: PortKind): boolean {
  return kindIssue(from, to) === null;
}

/**
 * A cable's end that no port of its node could ever take, said plainly: a
 * source makes its own sound, and the sound ends at an output. Checked
 * before the port lookup, so these read better than "missing port".
 */
function endIssue(
  source: GraphNode,
  target: GraphNode,
  targetHandle: string
): { code: IssueCode; message: string } | null {
  const into = definitionOf(target);
  const kind = parseHandleId(targetHandle)?.kind;
  if (into.source && (kind === "audio" || kind === "sidechain")) {
    const article = STARTS_WITH_VOWEL.test(into.name) ? "An" : "A";
    return {
      code: "no-audio-in",
      message: `${article} ${into.name} makes its own sound and takes no audio in`,
    };
  }
  const outOf = definitionOf(source);
  if (outOf.category === "output") {
    // "at Speakers", but "at an Output device".
    const where = BARE_OUTPUT_NAMES.has(source.type)
      ? outOf.name
      : `${STARTS_WITH_VOWEL.test(outOf.name) ? "an" : "a"} ${outOf.name}`;
    return {
      code: "no-out",
      message: `The sound ends at ${where}; it has no output`,
    };
  }
  return null;
}

/** "An Audio input", but "A Station". */
const STARTS_WITH_VOWEL = /^[AEIOU]/;

/** Outputs named like a place, with no article. */
const BARE_OUTPUT_NAMES: ReadonlySet<GraphNode["type"]> = new Set([
  "speakers",
  "headphones",
]);

/** "A module can't feed itself": the one exception is a Loop's own delay. */
export const SELF_LOOP_MESSAGE = "A module can't feed itself";

function wireEdge(context: Context, edge: GraphEdge): WiredEdge | null {
  const source = context.nodes.get(edge.source);
  const target = context.nodes.get(edge.target);
  if (!(source && target)) {
    edgeIssue(context, edge, "missing-node", "Cable points at a missing node");
    return null;
  }
  const from = resolvePort(source, edge.sourceHandle, "out");
  const to = resolvePort(target, edge.targetHandle, "in");
  if (from === "bad-handle" || to === "bad-handle") {
    edgeIssue(context, edge, "bad-handle", "Cable has a malformed port id");
    return null;
  }
  if (source === target && source.type !== "loop") {
    edgeIssue(context, edge, "self-loop", SELF_LOOP_MESSAGE);
    return null;
  }
  const end = endIssue(source, target, edge.targetHandle);
  if (end) {
    edgeIssue(context, edge, end.code, end.message);
    return null;
  }
  if (from === "unknown-port" || to === "unknown-port") {
    edgeIssue(context, edge, "unknown-port", "Cable points at a missing port");
    return null;
  }
  const unshipped = [from, to].find(
    (port) => port.ship && !isShipped(port.ship, context.release)
  );
  if (unshipped) {
    edgeIssue(
      context,
      edge,
      "unshipped",
      `${unshipped.label} isn't available yet`
    );
    return null;
  }
  const kind = kindIssue(from.kind, to.kind);
  if (kind) {
    edgeIssue(context, edge, kind.code, kind.message);
    return null;
  }
  return { edge, from, to };
}

function fullMessage(port: NodePort): string {
  const side = port.direction === "in" ? "input" : "output";
  return port.max === 1
    ? `This ${side} takes one cable`
    : `This ${side} is full (${port.max} cables)`;
}

/** Cables past the port checks, and the ones refused only for a full port. */
type CheckedEdges = {
  wired: WiredEdge[];
  full: { wire: WiredEdge; port: NodePort }[];
};

function checkEdges(context: Context): CheckedEdges {
  const wired: WiredEdge[] = [];
  const full: CheckedEdges["full"] = [];
  const cables = new Set<string>();
  const portCounts = new Map<string, number>();
  for (const edge of context.graph.edges) {
    const result = wireEdge(context, edge);
    if (!result) {
      continue;
    }
    const cable = `${edge.source}\u0000${edge.sourceHandle}\u0000${edge.target}\u0000${edge.targetHandle}`;
    if (cables.has(cable)) {
      edgeIssue(context, edge, "duplicate-edge", "These are already connected");
      continue;
    }
    const ends = [
      { key: `${edge.source}\u0000${edge.sourceHandle}`, port: result.from },
      { key: `${edge.target}\u0000${edge.targetHandle}`, port: result.to },
    ];
    const filled = ends.find(
      ({ key, port }) => (portCounts.get(key) ?? 0) >= port.max
    );
    if (filled) {
      // Flagged after the feedback check, which has the truer reason when
      // the cable would also close a loop.
      full.push({ port: filled.port, wire: result });
      continue;
    }
    cables.add(cable);
    for (const { key } of ends) {
      portCounts.set(key, (portCounts.get(key) ?? 0) + 1);
    }
    wired.push(result);
  }
  return { full, wired };
}

type TarjanFrame = { id: string; next: number };

/** Tarjan's SCC state; iterative so a hostile import cannot overflow the stack. */
class TarjanSearch {
  private readonly index = new Map<string, number>();
  private readonly low = new Map<string, number>();
  private readonly stack: string[] = [];
  private readonly onStack = new Set<string>();
  private counter = 0;
  readonly cycles: string[][] = [];

  private readonly adjacency: ReadonlyMap<string, readonly string[]>;
  private readonly selfLoops: ReadonlySet<string>;

  constructor(
    adjacency: ReadonlyMap<string, readonly string[]>,
    selfLoops: ReadonlySet<string>
  ) {
    this.adjacency = adjacency;
    this.selfLoops = selfLoops;
  }

  run(start: string): void {
    if (this.index.has(start)) {
      return;
    }
    this.visit(start);
    const frames: TarjanFrame[] = [{ id: start, next: 0 }];
    let frame = frames.at(-1);
    while (frame) {
      const neighbour = this.adjacency.get(frame.id)?.[frame.next];
      if (neighbour === undefined) {
        frames.pop();
        this.finish(frame, frames.at(-1));
      } else {
        frame.next += 1;
        this.step(frame, neighbour, frames);
      }
      frame = frames.at(-1);
    }
  }

  private visit(id: string): void {
    this.index.set(id, this.counter);
    this.low.set(id, this.counter);
    this.counter += 1;
    this.stack.push(id);
    this.onStack.add(id);
  }

  private lower(id: string, value: number | undefined): void {
    this.low.set(id, Math.min(this.low.get(id) ?? 0, value ?? 0));
  }

  private step(frame: TarjanFrame, neighbour: string, frames: TarjanFrame[]) {
    if (!this.index.has(neighbour)) {
      this.visit(neighbour);
      frames.push({ id: neighbour, next: 0 });
    } else if (this.onStack.has(neighbour)) {
      this.lower(frame.id, this.index.get(neighbour));
    }
  }

  private finish(frame: TarjanFrame, parent: TarjanFrame | undefined): void {
    if (parent) {
      this.lower(parent.id, this.low.get(frame.id));
    }
    if (this.low.get(frame.id) !== this.index.get(frame.id)) {
      return;
    }
    const component: string[] = [];
    let id = this.stack.pop();
    while (id !== undefined) {
      this.onStack.delete(id);
      component.push(id);
      id = id === frame.id ? undefined : this.stack.pop();
    }
    if (component.length > 1 || this.selfLoops.has(frame.id)) {
      this.cycles.push(component);
    }
  }
}

/**
 * Tarjan's strongly connected components. Returns only the components that
 * form a cycle: more than one node, or one node cabled to itself.
 */
export function findCycles(
  nodeIds: readonly string[],
  edges: readonly { source: string; target: string }[]
): string[][] {
  const adjacency = new Map<string, string[]>();
  const selfLoops = new Set<string>();
  for (const { source, target } of edges) {
    const targets = adjacency.get(source) ?? [];
    targets.push(target);
    adjacency.set(source, targets);
    if (source === target) {
      selfLoops.add(source);
    }
  }
  const search = new TarjanSearch(adjacency, selfLoops);
  for (const id of nodeIds) {
    search.run(id);
  }
  return search.cycles;
}

const FEEDBACK: Record<"audio" | "control", [IssueCode, string]> = {
  audio: ["feedback-needs-loop", "That would feed the sound back into itself"],
  control: ["control-cycle", "That would feed the control back into itself"],
};

/** Whether `to` can already reach `from` along `edges`. */
function reaches(
  edges: readonly WiredEdge[],
  from: string,
  to: string
): boolean {
  const next = new Map<string, string[]>();
  for (const { edge } of edges) {
    next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
  }
  const seen = new Set([to]);
  const queue = [to];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (id === from) {
      return true;
    }
    for (const target of next.get(id) ?? []) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return false;
}

/**
 * Refuses cables until no illegal cycle is left. An audio cycle is legal only
 * when every loop in it passes through a Loop node, whose delay makes it
 * audible (Loop ships later, so for now any feedback is refused); control
 * cycles are never legal. Each round flags the last cable of every remaining
 * cycle, which is the one a drag just added, and repeats in case one
 * strongly connected component held several independent cycles. A cable
 * into a full port that would also close a loop says so, since freeing the
 * port wouldn't help; the rest say the port is full.
 */
function checkCycles(
  context: Context,
  { wired, full }: CheckedEdges
): WiredEdge[] {
  const rejected = new Set<WiredEdge>();
  const nodeIds = context.graph.nodes.map((node) => node.id);
  const isLoop = (id: string) => context.nodes.get(id)?.type === "loop";
  // A key cable taps its lane before the FX, so it closes no cycle; taking
  // the Loop nodes out leaves exactly the delay-free cycles.
  const inCycles = (kind: "audio" | "control") => (wire: WiredEdge) =>
    wire.from.kind === kind &&
    wire.to.kind === kind &&
    !(
      kind === "audio" &&
      (isLoop(wire.edge.source) || isLoop(wire.edge.target))
    );
  for (const kind of ["audio", "control"] as const) {
    const [code, message] = FEEDBACK[kind];
    let remaining = wired.filter(inCycles(kind));
    let cycles = findCycles(
      nodeIds,
      remaining.map(({ edge }) => edge)
    );
    while (cycles.length > 0) {
      for (const cycle of cycles) {
        const members = new Set(cycle);
        const closing = remaining
          .filter(
            ({ edge }) => members.has(edge.source) && members.has(edge.target)
          )
          .at(-1);
        if (!closing) {
          continue;
        }
        rejected.add(closing);
        edgeIssue(context, closing.edge, code, message);
      }
      remaining = remaining.filter((wire) => !rejected.has(wire));
      cycles = findCycles(
        nodeIds,
        remaining.map(({ edge }) => edge)
      );
    }
  }
  const kept = wired.filter((wire) => !rejected.has(wire));
  for (const { wire, port } of full) {
    const kind = (["audio", "control"] as const).find((entry) =>
      inCycles(entry)(wire)
    );
    if (
      kind &&
      reaches(kept.filter(inCycles(kind)), wire.edge.source, wire.edge.target)
    ) {
      const [code, message] = FEEDBACK[kind];
      edgeIssue(context, wire.edge, code, message);
    } else {
      edgeIssue(context, wire.edge, "port-max", fullMessage(port));
    }
  }
  return kept;
}

/** undefined: not fed by any source; string: that source's lane; null: several sources. */
export type Lane = string | null | undefined;

function joinLane(current: Lane, next: Lane): Lane {
  if (current === undefined) {
    return next;
  }
  if (next === undefined || next === current) {
    return current;
  }
  return null;
}

export type Topology = {
  lanes: Map<string, Lane>;
};

function laneFromInputs(node: GraphNode, inputs: readonly Lane[]): Lane {
  if (definitionOf(node).category === "output") {
    return;
  }
  const lane = inputs.reduce<Lane>(joinLane, undefined);
  if (lane !== undefined && BUS_NODE_TYPES.has(node.type)) {
    return null;
  }
  return lane;
}

function audioInputs(wired: readonly WiredEdge[]): Map<string, string[]> {
  const inputs = new Map<string, string[]>();
  for (const { edge, to } of wired) {
    if (to.kind === "audio") {
      const sources = inputs.get(edge.target) ?? [];
      sources.push(edge.source);
      inputs.set(edge.target, sources);
    }
  }
  return inputs;
}

/** Nodes that reach an output; dangling paths remain available for editing. */
export function liveAudioNodes(
  exits: readonly WiredEdge[],
  inner: readonly WiredEdge[]
): Set<string> {
  const inputs = audioInputs(inner);
  const live = new Set<string>();
  const queue = exits.map(({ edge }) => edge.source);
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (live.has(id)) {
      continue;
    }
    live.add(id);
    queue.push(...(inputs.get(id) ?? []));
  }
  return live;
}

function audioOutputs(
  inputs: ReadonlyMap<string, readonly string[]>
): Map<string, string[]> {
  const outputs = new Map<string, string[]>();
  for (const [target, sources] of inputs) {
    for (const source of sources) {
      const targets = outputs.get(source) ?? [];
      targets.push(target);
      outputs.set(source, targets);
    }
  }
  return outputs;
}

/**
 * Labels each node with the lane it belongs to, or as a bus when it sums
 * more than one lane. A monotone fixpoint, so audio cycles settle too. A
 * worklist revisits only what a change feeds, and a label only moves from
 * none to a lane to a bus, so a long imported chain stays linear whatever
 * order its nodes are stored in.
 */
function labelLanes(
  context: Context,
  inputs: ReadonlyMap<string, readonly string[]>
): Map<string, Lane> {
  const lanes = new Map<string, Lane>();
  for (const node of context.graph.nodes) {
    lanes.set(node.id, definitionOf(node).source ? node.id : undefined);
  }
  const outputs = audioOutputs(inputs);
  const pending = context.graph.nodes
    .filter((node) => !definitionOf(node).source)
    .reverse();
  const queued = new Set(pending.map((node) => node.id));
  for (let node = pending.pop(); node; node = pending.pop()) {
    queued.delete(node.id);
    const upstream = (inputs.get(node.id) ?? []).map((id) => lanes.get(id));
    const next = joinLane(lanes.get(node.id), laneFromInputs(node, upstream));
    if (next === lanes.get(node.id)) {
      continue;
    }
    lanes.set(node.id, next);
    for (const id of outputs.get(node.id) ?? []) {
      const target = context.nodes.get(id);
      if (target && !definitionOf(target).source && !queued.has(id)) {
        queued.add(id);
        pending.push(target);
      }
    }
  }
  return lanes;
}

function findTopology(context: Context, wired: WiredEdge[]): Topology {
  const inputs = audioInputs(wired);
  const lanes = labelLanes(context, inputs);
  return { lanes };
}

function checkSidechains(
  context: Context,
  wired: WiredEdge[],
  { lanes }: Topology
): Set<string> {
  const keyed = new Set<string>();
  for (const { edge, to } of wired) {
    if (to.kind !== "sidechain") {
      continue;
    }
    const lane = lanes.get(edge.source);
    if (typeof lane !== "string") {
      edgeIssue(
        context,
        edge,
        "sidechain-source",
        "A key must come from a station lane"
      );
    } else if (lane !== edge.source) {
      // The engine keys from the station's raw signal, so a cable drawn after
      // its Gain or FX would claim a tap it doesn't get.
      edgeIssue(
        context,
        edge,
        "sidechain-source",
        "A key must come from the station itself"
      );
    } else if (typeof lanes.get(edge.target) === "string") {
      keyed.add(edge.target);
    } else {
      edgeIssue(
        context,
        edge,
        "sidechain-target",
        "A key only works on a station lane"
      );
    }
  }
  return keyed;
}

function checkLanes(context: Context, topology: Topology, keyed: Set<string>) {
  const seen = new Map<string, Set<IssueCode>>();
  const rules: {
    code: IssueCode;
    message: string;
    test: (node: GraphNode) => boolean;
  }[] = [
    {
      code: "lane-key",
      message: "One key per lane",
      test: (node) => keyed.has(node.id),
    },
  ];
  for (const node of context.graph.nodes) {
    const lane = topology.lanes.get(node.id);
    if (typeof lane !== "string") {
      continue;
    }
    const laneSeen = seen.get(lane) ?? new Set<IssueCode>();
    seen.set(lane, laneSeen);
    for (const rule of rules) {
      if (!rule.test(node)) {
        continue;
      }
      if (laneSeen.has(rule.code)) {
        nodeIssue(context, node, rule.code, rule.message);
      }
      laneSeen.add(rule.code);
    }
  }
}

function overBudget<T>(
  items: readonly T[],
  limit: number,
  flag: (item: T) => void
): void {
  for (const item of items.slice(limit)) {
    flag(item);
  }
}

function checkBudgets(context: Context, playing: readonly string[]): void {
  const { budget, graph } = context;
  const ofType = (type: NodeType) =>
    graph.nodes.filter((node) => node.type === type);
  const flagNodes = (
    nodes: readonly GraphNode[],
    limit: number,
    code: IssueCode,
    message: string
  ) =>
    overBudget(nodes, limit, (node) => nodeIssue(context, node, code, message));

  const streams = [...new Set(playing)]
    .map((id) => context.nodes.get(id))
    .filter((node): node is GraphNode =>
      Boolean(node && definitionOf(node).stream)
    );
  flagNodes(
    streams,
    budget.playingStreams,
    "budget-playing",
    `Up to ${budget.playingStreams} streams can play at once`
  );
  flagNodes(
    graph.nodes.filter((node) => definitionOf(node).source),
    budget.sources,
    "budget-sources",
    `Up to ${budget.sources} sources per patch`
  );

  flagNodes(
    ofType("loop"),
    budget.loops,
    "budget-loops",
    `Up to ${budget.loops} Loops per patch`
  );
  const tapeWarps = ofType("tapeWarp");
  flagNodes(
    tapeWarps,
    budget.tapeWarps,
    "budget-tape-warp",
    `Up to ${budget.tapeWarps} Tape Warp per patch`
  );
  for (const node of tapeWarps) {
    if (node.type === "tapeWarp" && node.data.time > budget.tapeWarpSeconds) {
      nodeIssue(
        context,
        node,
        "budget-tape-warp-time",
        `Tape Warp is limited to ${budget.tapeWarpSeconds} s here`
      );
    }
  }
  flagNodes(
    ofType("lfo"),
    budget.lfos,
    "budget-lfos",
    `Up to ${budget.lfos} LFOs per patch`
  );

  overBudget(graph.edges, budget.edges, (edge) =>
    edgeIssue(
      context,
      edge,
      "budget-edges",
      `Up to ${budget.edges} cables per patch`
    )
  );
}

export type GraphAnalysis = {
  issues: Issue[];
  /** Cables that passed the port and cycle checks. */
  wired: WiredEdge[];
  topology: Topology;
};

/** Validates a patch and keeps what the compiler builds on. */
export function analyseGraph(
  graph: ValidatableGraph,
  { playing = [], profile = "desktop", release = "v1" }: ValidateOptions = {}
): GraphAnalysis {
  const context: Context = {
    budget: NODE_BUDGETS[profile],
    graph,
    issues: [],
    nodes: new Map(graph.nodes.map((node) => [node.id, node])),
    release,
  };
  checkNodes(context);
  const wired = checkCycles(context, checkEdges(context));
  const topology = findTopology(context, wired);
  const keyed = checkSidechains(context, wired, topology);
  checkLanes(context, topology, keyed);
  checkBudgets(context, playing);
  return { issues: context.issues, topology, wired };
}

/** Validates a whole patch. An empty list means the compiler may take it. */
export function validate(
  graph: ValidatableGraph,
  options?: ValidateOptions
): Issue[] {
  return analyseGraph(graph, options).issues;
}

function issueKey(issue: Issue): string {
  return `${issue.code}\u0000${issue.target}\u0000${issue.id}`;
}

export const CANDIDATE_EDGE_ID = "candidate";

/** An id for the candidate cable that no cable in the patch already uses. */
function candidateEdgeId(graph: ValidatableGraph): string {
  const taken = new Set(graph.edges.map((edge) => edge.id));
  let id = CANDIDATE_EDGE_ID;
  for (let suffix = 1; taken.has(id); suffix += 1) {
    id = `${CANDIDATE_EDGE_ID}-${suffix}`;
  }
  return id;
}

/**
 * The problems `graph` already has, which `validateConnection` leaves out
 * as not a new cable's doing. Take it once to check many cables against the
 * same patch, e.g. every port a drag faces, rather than once per cable.
 */
export function connectionBaseline(
  graph: ValidatableGraph,
  options?: ValidateOptions
): ReadonlySet<string> {
  return new Set(validate(graph, options).map(issueKey));
}

/**
 * The problems a new cable would introduce; empty means it may connect.
 * Ask `connectionVerdict` instead, which picks the one to show. `baseline`
 * is `connectionBaseline(graph, options)` when the caller already has it.
 */
export function validateConnection(
  graph: ValidatableGraph,
  connection: Connection,
  options?: ValidateOptions,
  baseline?: ReadonlySet<string>
): Issue[] {
  if (
    connection.id !== undefined &&
    graph.edges.some((edge) => edge.id === connection.id)
  ) {
    return [
      {
        code: "duplicate-edge",
        id: connection.id,
        message: "That cable id is already taken",
        target: "edge",
      },
    ];
  }
  const candidate: GraphEdge = {
    gain: 1,
    id: connection.id ?? candidateEdgeId(graph),
    muted: false,
    source: connection.source,
    sourceHandle: connection.sourceHandle ?? "",
    target: connection.target,
    targetHandle: connection.targetHandle ?? "",
  };
  const before = baseline ?? connectionBaseline(graph, options);
  return validate(
    { ...graph, edges: [...graph.edges, candidate] },
    options
  ).filter(
    (issue) =>
      (issue.target === "edge" && issue.id === candidate.id) ||
      !before.has(issueKey(issue))
  );
}

/** Whether a cable may connect, and if not, why, as a toast says it. */
export type Verdict =
  | { ok: true }
  | { ok: false; code: IssueCode; message: string };

/** Why a cable dragged from an output can't end on another output. */
export const SAME_SIDE_MESSAGE = "A cable runs from an output to an input";

/**
 * The one answer to "may this cable connect?": the canvas, a drop on a
 * node, the Connect… dialog, the palette and cable surgery all ask here.
 * The cable's own problem comes first, then what it would break elsewhere,
 * e.g. a Merge that would sum two stations. Two outputs or two inputs are
 * refused before any validation, so a drag can ask about every port; it
 * passes the patch's `connectionBaseline` so that is validated only once.
 */
export function connectionVerdict(
  graph: ValidatableGraph,
  connection: Connection,
  options?: ValidateOptions,
  baseline?: ReadonlySet<string>
): Verdict {
  const source = parseHandleId(connection.sourceHandle);
  const target = parseHandleId(connection.targetHandle);
  if (source?.direction === "in" || target?.direction === "out") {
    return { code: "bad-handle", message: SAME_SIDE_MESSAGE, ok: false };
  }
  const issues = validateConnection(graph, connection, options, baseline);
  const refusal = issues.find((issue) => issue.target === "edge") ?? issues[0];
  return refusal
    ? { code: refusal.code, message: refusal.message, ok: false }
    : { ok: true };
}
