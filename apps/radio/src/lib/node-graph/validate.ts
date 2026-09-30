/**
 * Node Graph Validation
 *
 * Checks a patch against the port-kind rules, per-port limits, lane rules,
 * the feedback rule and the device budgets. Every problem is an Issue keyed
 * by the node or cable it belongs to; invalid cables never reach the compiler.
 * The same check runs on drag, on load and on import.
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
  | "kind-mismatch"
  | "use-follower"
  | "duplicate-edge"
  | "port-max"
  | "one-speakers"
  | "sidechain-source"
  | "sidechain-target"
  | "lane-filter"
  | "lane-pan"
  | "lane-key"
  | "feedback-needs-loop"
  | "control-cycle"
  | "budget-playing"
  | "budget-sources"
  | "budget-buses"
  | "budget-bus-fx"
  | "budget-loops"
  | "budget-tape-warp"
  | "budget-tape-warp-time"
  | "budget-lfos"
  | "budget-edges";

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
  buses: number;
  busesWithFx: number;
  loops: number;
  tapeWarps: number;
  tapeWarpSeconds: number;
  lfos: number;
  edges: number;
};

/** Mobile is a coarse pointer or iOS, where every FX lane is one worklet. */
export const NODE_BUDGETS: Readonly<Record<Profile, NodeBudget>> = {
  desktop: {
    buses: 6,
    busesWithFx: 3,
    edges: 64,
    lfos: 8,
    loops: 4,
    playingStreams: 6,
    sources: 24,
    tapeWarpSeconds: 30,
    tapeWarps: 2,
  },
  mobile: {
    buses: 3,
    busesWithFx: 2,
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

/** Nodes that always start a bus: they sum or delay across lanes. */
const BUS_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "crossfade",
  "dial",
  "loop",
  "return",
  "tapeWarp",
]);

type WiredEdge = {
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
  return (
    definitionOf(node).ports.find(
      (port) =>
        port.direction === direction &&
        port.kind === parsed.kind &&
        port.id === parsed.name
    ) ?? "unknown-port"
  );
}

/** audio→audio, audio→sidechain, control→control and midi→midi only. */
function kindIssue(
  from: NodePort,
  to: NodePort
): { code: IssueCode; message: string } | null {
  if (
    from.kind === "audio" &&
    (to.kind === "audio" || to.kind === "sidechain")
  ) {
    return null;
  }
  if (from.kind === to.kind && from.kind !== "sidechain") {
    return null;
  }
  if (from.kind === "audio" && to.kind === "control") {
    return {
      code: "use-follower",
      message: "Audio can't drive control; use a Follower",
    };
  }
  return {
    code: "kind-mismatch",
    message: `Can't patch ${from.kind} into ${to.kind}`,
  };
}

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
  const kind = kindIssue(from, to);
  if (kind) {
    edgeIssue(context, edge, kind.code, kind.message);
    return null;
  }
  return { edge, from, to };
}

function checkEdges(context: Context): WiredEdge[] {
  const wired: WiredEdge[] = [];
  const cables = new Set<string>();
  const portCounts = new Map<string, number>();
  for (const edge of context.graph.edges) {
    const result = wireEdge(context, edge);
    if (!result) {
      continue;
    }
    const cable = `${edge.source}\u0000${edge.sourceHandle}\u0000${edge.target}\u0000${edge.targetHandle}`;
    if (cables.has(cable)) {
      edgeIssue(
        context,
        edge,
        "duplicate-edge",
        "These ports are already connected"
      );
      continue;
    }
    const ends = [
      { key: `${edge.source}\u0000${edge.sourceHandle}`, port: result.from },
      { key: `${edge.target}\u0000${edge.targetHandle}`, port: result.to },
    ];
    const full = ends.find(
      ({ key, port }) => (portCounts.get(key) ?? 0) >= port.max
    );
    if (full) {
      edgeIssue(
        context,
        edge,
        "port-max",
        full.port.max === 1
          ? "Only one cable fits this port"
          : `Only ${full.port.max} cables fit this port`
      );
      continue;
    }
    cables.add(cable);
    for (const { key } of ends) {
      portCounts.set(key, (portCounts.get(key) ?? 0) + 1);
    }
    wired.push(result);
  }
  return wired;
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

/**
 * Refuses cables until no illegal cycle is left. An audio cycle is legal only
 * when every loop in it passes through a Loop node, whose delay makes it
 * audible; control cycles are never legal. Each round flags the last cable of
 * every remaining cycle, which is the one a drag just added, and repeats in
 * case one strongly connected component held several independent cycles.
 */
function checkCycles(context: Context, wired: WiredEdge[]): WiredEdge[] {
  const rejected = new Set<WiredEdge>();
  const nodeIds = context.graph.nodes.map((node) => node.id);
  const isLoop = (id: string) => context.nodes.get(id)?.type === "loop";
  for (const kind of ["audio", "control"] as const) {
    let remaining = wired.filter(
      ({ edge, from, to }) =>
        // A key cable taps its lane before the FX, so it closes no cycle.
        from.kind === kind &&
        to.kind === kind &&
        // Taking the Loop nodes out leaves exactly the delay-free cycles.
        !(kind === "audio" && (isLoop(edge.source) || isLoop(edge.target)))
    );
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
        if (kind === "audio") {
          edgeIssue(
            context,
            closing.edge,
            "feedback-needs-loop",
            "Feedback needs a Loop"
          );
        } else {
          edgeIssue(
            context,
            closing.edge,
            "control-cycle",
            "Control can't feed back into itself"
          );
        }
      }
      remaining = remaining.filter((wire) => !rejected.has(wire));
      cycles = findCycles(
        nodeIds,
        remaining.map(({ edge }) => edge)
      );
    }
  }
  return wired.filter((wire) => !rejected.has(wire));
}

/** undefined: not fed by any source; string: that source's lane; null: a bus. */
type Lane = string | null | undefined;

function joinLane(current: Lane, next: Lane): Lane {
  if (current === undefined) {
    return next;
  }
  if (next === undefined || next === current) {
    return current;
  }
  return null;
}

type Topology = {
  lanes: Map<string, Lane>;
  /** Bus id per bus node: the node that starts the bus. */
  buses: Map<string, string>;
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

/**
 * Labels each node with the lane it belongs to, or as a bus when it sums
 * more than one lane. A monotone fixpoint, so audio cycles settle too.
 */
function labelLanes(
  context: Context,
  inputs: ReadonlyMap<string, readonly string[]>
): Map<string, Lane> {
  const lanes = new Map<string, Lane>();
  for (const node of context.graph.nodes) {
    lanes.set(node.id, definitionOf(node).source ? node.id : undefined);
  }
  const followers = context.graph.nodes.filter(
    (node) => !definitionOf(node).source
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of followers) {
      const upstream = (inputs.get(node.id) ?? []).map((id) => lanes.get(id));
      const next = joinLane(lanes.get(node.id), laneFromInputs(node, upstream));
      if (next !== lanes.get(node.id)) {
        lanes.set(node.id, next);
        changed = true;
      }
    }
  }
  return lanes;
}

/**
 * Groups bus nodes. A node joins the bus its audio comes from when every
 * input is on that one bus, so a Split and Merge inside a bus stay one bus.
 * Bus-making nodes, and nodes where a lane joins, start a bus of their own.
 * A fixpoint: every legal cycle passes a Loop, which always starts a bus.
 */
function labelBuses(
  context: Context,
  inputs: ReadonlyMap<string, readonly string[]>,
  lanes: ReadonlyMap<string, Lane>
): Map<string, string> {
  const buses = new Map<string, string>();
  const busNodes = context.graph.nodes.filter(
    (node) => lanes.get(node.id) === null
  );
  for (const node of busNodes) {
    buses.set(node.id, node.id);
  }
  const upstreamBus = (node: GraphNode): string | undefined => {
    if (BUS_NODE_TYPES.has(node.type)) {
      return;
    }
    let bus: string | undefined;
    for (const id of inputs.get(node.id) ?? []) {
      const lane = lanes.get(id);
      if (lane === undefined) {
        // Not fed by any source, so it carries no signal.
        continue;
      }
      const upstream = lane === null ? buses.get(id) : undefined;
      if (upstream === undefined || (bus !== undefined && bus !== upstream)) {
        return;
      }
      bus = upstream;
    }
    return bus;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of busNodes) {
      const next = upstreamBus(node) ?? node.id;
      if (next !== buses.get(node.id)) {
        buses.set(node.id, next);
        changed = true;
      }
    }
  }
  return buses;
}

function findTopology(context: Context, wired: WiredEdge[]): Topology {
  const inputs = audioInputs(wired);
  const lanes = labelLanes(context, inputs);
  return { buses: labelBuses(context, inputs, lanes), lanes };
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
    if (typeof lanes.get(edge.source) !== "string") {
      edgeIssue(
        context,
        edge,
        "sidechain-source",
        "A key must come from a station lane"
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
      code: "lane-filter",
      message: "One Filter per lane",
      test: (node) => node.type === "filter",
    },
    {
      code: "lane-pan",
      message: "One Pan per lane",
      test: (node) => node.type === "pan",
    },
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

function busHeads(context: Context, { buses }: Topology): GraphNode[] {
  return context.graph.nodes.filter((node) => buses.get(node.id) === node.id);
}

function checkBusRelease(context: Context, topology: Topology): void {
  if (isShipped("v2", context.release)) {
    return;
  }
  for (const node of busHeads(context, topology)) {
    if (node.type === "merge") {
      nodeIssue(
        context,
        node,
        "unshipped",
        "Merging different stations isn't available yet"
      );
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

function checkBudgets(
  context: Context,
  topology: Topology,
  playing: readonly string[]
): void {
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

  const heads = busHeads(context, topology);
  flagNodes(
    heads,
    budget.buses,
    "budget-buses",
    `Up to ${budget.buses} buses per patch`
  );
  const fxBuses = new Set(
    graph.nodes
      .filter(
        (node) => topology.buses.has(node.id) && definitionOf(node).effectType
      )
      .map((node) => topology.buses.get(node.id))
  );
  flagNodes(
    heads.filter((node) => fxBuses.has(node.id)),
    budget.busesWithFx,
    "budget-bus-fx",
    `Up to ${budget.busesWithFx} buses with FX per patch`
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

/** Validates a whole patch. An empty list means the compiler may take it. */
export function validate(
  graph: ValidatableGraph,
  { playing = [], profile = "desktop", release = "v1" }: ValidateOptions = {}
): Issue[] {
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
  checkBusRelease(context, topology);
  checkBudgets(context, topology, playing);
  return context.issues;
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
 * The problems a new cable would introduce; empty means it may connect.
 * Backs React Flow's isValidConnection and the keyboard Connect… dialog.
 */
export function validateConnection(
  graph: ValidatableGraph,
  connection: Connection,
  options?: ValidateOptions
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
  const before = new Set(validate(graph, options).map(issueKey));
  return validate(
    { ...graph, edges: [...graph.edges, candidate] },
    options
  ).filter(
    (issue) =>
      (issue.target === "edge" && issue.id === candidate.id) ||
      !before.has(issueKey(issue))
  );
}
