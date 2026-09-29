/**
 * Node Graph Compiler
 *
 * Lowers a validated patch onto what the engine already runs: one managed
 * sound per station lane, a leading Filter and Pan on its native strip, and
 * its FX as one series-parallel EffectConfig tree. Cables leaving a lane
 * become edge gains keyed by the cable id, and key cables become sidechain
 * bindings. Nothing here touches audio; `reconcile.ts` diffs two plans.
 *
 * Buses, control and modulation land with the layers that ship them. Until
 * then a node that would start a bus is refused with an issue, never dropped.
 */

import {
  canUseOfficialOpenDawRuntime,
  hasEnabledEffects,
} from "@/lib/audio/dsp/effects/official-opendaw-mapping";
import type {
  EffectChainConfig,
  EffectConfig,
  FxCompositeConfig,
} from "@/lib/audio/dsp/effects/types";
import {
  isEffectContainer,
  MAX_EFFECT_TREE_DEPTH,
} from "@/lib/audio/dsp/routing/effect-tree";
import {
  getNodeDefinition,
  isEffectNodeType,
  SIDECHAIN_EFFECT_TYPES,
} from "./catalogue";
import type { GraphEdge, GraphNode, NodeGraph, NodeType } from "./schema";
import {
  analyseGraph,
  type Issue,
  type IssueCode,
  type Lane,
  type Topology,
  type ValidateOptions,
  type WiredEdge,
} from "./validate";

/**
 * openDAW monitors at most 8 input channels, i.e. 4 stereo sounds
 * (`MAX_MONITORING_CHANNELS`, official-opendaw-runtime.ts).
 */
export const MONITORING_CHANNEL_CAP = 8;
const LANE_CHANNELS = 2;

/** A Split, Band Split or implicit fan-out takes 2 to 4 branches. */
export const MAX_SPLIT_BRANCHES = 4;

export type CompileEnv = ValidateOptions & {
  /** openDAW needs cross-origin isolation; read once by the caller. */
  crossOriginIsolated: boolean;
};

/** A display estimate only; the effects controller still decides. */
export type LaneBackend = "official" | "compat";

export type StationRadio = NonNullable<
  Extract<GraphNode, { type: "station" }>["data"]["radio"]
>;

export type NativeFilterPlan = {
  type: "lowpass" | "highpass";
  frequency: number;
  Q: number;
};

export type LanePlan = {
  /** The source node id. */
  id: string;
  /** Playback channel id in the node session: `n:<id>`. */
  channelId: string;
  /** Managed sound id: `node:n:<id>`. */
  soundId: string;
  radio: StationRadio;
  /** Nodes lowered into this lane, source first. */
  nodes: string[];
  pan: number;
  filter: NativeFilterPlan | null;
  effects: EffectConfig[];
  /** Changes only when effect ids, types, order or chains change. */
  layoutSignature: string;
  /** null when the lane has no enabled FX and so no effects runtime. */
  backend: LaneBackend | null;
};

export type EdgePlan = {
  /** The cable id. */
  id: string;
  from: { kind: "lane"; id: string };
  to: { kind: "sink"; id: string };
  /** Linear, with any in-lane Gain and cable trims folded in. */
  gain: number;
  muted: boolean;
};

export type SinkPlan = {
  id: string;
  type: GraphNode["type"];
};

export type EnginePlan = {
  lanes: Map<string, LanePlan>;
  edges: Map<string, EdgePlan>;
  sinks: Map<string, SinkPlan>;
  budget: { monitoringChannels: number };
  /** Validation and compile issues; the plan leaves their nodes out. */
  issues: Issue[];
};

export function laneChannelId(nodeId: string): string {
  return `n:${nodeId}`;
}

export function laneSoundId(nodeId: string): string {
  return `node:${laneChannelId(nodeId)}`;
}

/** Node types this compiler lowers; later layers add theirs. */
const COMPILED_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "station",
  "filter",
  "pan",
  "gain",
  "merge",
  "speakers",
]);

function isCompiled(type: NodeType): boolean {
  return COMPILED_NODE_TYPES.has(type) || isEffectNodeType(type);
}

function effectOf(node: GraphNode): EffectConfig | null {
  return isEffectNodeType(node.type)
    ? (node.data as { effect: EffectConfig }).effect
    : null;
}

/**
 * Issues that leave the node in the plan: the playing budget is enforced
 * when a stream starts, and a second key simply stays unkeyed.
 */
const ADVISORY_CODES: ReadonlySet<IssueCode> = new Set<IssueCode>([
  "budget-playing",
  "lane-key",
]);

type CompileGraph = Pick<NodeGraph, "nodes" | "edges">;

/** A trim waiting for the next point that can apply it. */
type Trim = { gain: number; muted: boolean };

const UNITY: Trim = { gain: 1, muted: false };

function addTrim(trim: Trim, edge: Pick<GraphEdge, "gain" | "muted">): Trim {
  return { gain: trim.gain * edge.gain, muted: trim.muted || edge.muted };
}

function trimLevel(trim: Trim): number {
  return trim.muted ? 0 : trim.gain;
}

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

function lastEnabledIndex(effects: readonly EffectConfig[]): number {
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    if (effects[index]?.enabled) {
      return index;
    }
  }
  return -1;
}

/**
 * Places the trim pending in front of `effect`, which is about to join
 * `effects`, and returns what is still pending after it. A bypassed effect
 * passes the trim on untouched. Otherwise the trim goes on the previous
 * enabled effect's post trim, which is exact, or else on this effect's pre
 * trim. The pre trim only reaches the wet path, so below 100% mix a mute
 * also zeroes the post trim; a level change there stays wet-only.
 */
function placeTrim(
  effects: EffectConfig[],
  effect: EffectConfig,
  trim: Trim
): { effect: EffectConfig; trim: Trim } {
  if (!effect.enabled) {
    return { effect, trim };
  }
  const level = trimLevel(trim);
  if (level === 1) {
    return { effect, trim: UNITY };
  }
  const previousIndex = lastEnabledIndex(effects);
  const previous = effects[previousIndex];
  if (previous) {
    effects[previousIndex] = {
      ...previous,
      outputGain: previous.outputGain * level,
    } as EffectConfig;
    return { effect, trim: UNITY };
  }
  return {
    effect: {
      ...effect,
      inputGain: effect.inputGain * level,
      outputGain: level === 0 && effect.dryWet < 1 ? 0 : effect.outputGain,
    } as EffectConfig,
    trim: UNITY,
  };
}

class LoweringError extends Error {
  readonly nodeId: string;
  readonly code: IssueCode;

  constructor(nodeId: string, code: IssueCode, message: string) {
    super(message);
    this.nodeId = nodeId;
    this.code = code;
  }
}

const EXIT = "\u0000exit";

type Branch = { effects: EffectConfig[]; trim: Trim };

type Walk = {
  current: string;
  effects: EffectConfig[];
  trim: Trim;
  /** The current node is the Merge that just closed a region. */
  closed: boolean;
};

type SeriesResult = {
  effects: EffectConfig[];
  /** Trim still pending at the end, for the chain gain or the exits. */
  trim: Trim;
  end: string;
};

/**
 * Lowers one lane. The lane is a DAG rooted at its source: only a Merge takes
 * more than one audio input, and feedback needs a Loop, which is a bus.
 */
class LaneLowerer {
  readonly nodes: string[] = [];
  pan = 0;
  filter: NativeFilterPlan | null = null;

  private readonly outs = new Map<string, WiredEdge[]>();
  private readonly ins = new Map<string, WiredEdge[]>();
  private readonly exits = new Map<string, WiredEdge[]>();
  private readonly postDominators = new Map<string, Set<string>>();
  private readonly byId: ReadonlyMap<string, GraphNode>;

  constructor(
    byId: ReadonlyMap<string, GraphNode>,
    members: ReadonlySet<string>,
    wired: readonly WiredEdge[],
    sinks: ReadonlySet<string>
  ) {
    this.byId = byId;
    const audio = wired.filter(
      ({ edge, from, to }) =>
        from.kind === "audio" && to.kind === "audio" && members.has(edge.source)
    );
    const live = liveNodes(
      audio.filter(({ edge }) => sinks.has(edge.target)),
      audio.filter(({ edge }) => members.has(edge.target))
    );
    for (const wire of audio) {
      const { source: from, target } = wire.edge;
      if (sinks.has(target)) {
        push(this.exits, from, wire);
      } else if (live.has(target)) {
        // Dead ends reach no output, so they are inaudible and skipped.
        push(this.outs, from, wire);
        push(this.ins, target, wire);
      }
    }
  }

  outsOf(id: string): WiredEdge[] {
    return this.outs.get(id) ?? [];
  }

  exitsOf(id: string): WiredEdge[] {
    return this.exits.get(id) ?? [];
  }

  /** Nodes every path from `id` to an output passes, `id` included. */
  private postDominatorsOf(id: string): Set<string> {
    const known = this.postDominators.get(id);
    if (known) {
      return known;
    }
    const successors = this.outsOf(id).map(({ edge }) => edge.target);
    if (this.exitsOf(id).length > 0) {
      successors.push(EXIT);
    }
    const sets = successors.map((next) =>
      next === EXIT ? new Set([EXIT]) : this.postDominatorsOf(next)
    );
    const [first = new Set<string>(), ...rest] = sets;
    const result = new Set(
      [...first].filter((node) => rest.every((set) => set.has(node)))
    );
    result.add(id);
    this.postDominators.set(id, result);
    return result;
  }

  /**
   * The nearest Merge every branch leaving `id` meets again, or EXIT. A
   * Merge, because a Split with one branch used still closes there.
   */
  private meetingPoint(id: string): string {
    let nearest = EXIT;
    let depth = 0;
    for (const candidate of this.postDominatorsOf(id)) {
      if (candidate === EXIT || this.node(candidate).type !== "merge") {
        continue;
      }
      // Post-dominators form a chain; the nearest one has the most.
      const { size } = this.postDominatorsOf(candidate);
      if (candidate !== id && size > depth) {
        nearest = candidate;
        depth = size;
      }
    }
    return nearest;
  }

  private node(id: string): GraphNode {
    const node = this.byId.get(id);
    if (!node) {
      throw new Error(`Node not found: ${id}`);
    }
    return node;
  }

  /**
   * Walks a series from `start` until `stop` (a Merge closing the region) or
   * the lane's end. `start` itself is lowered first.
   */
  lowerSeries(
    start: string,
    entry: Trim,
    stop: string | null,
    level: number
  ): SeriesResult {
    const walk: Walk = {
      closed: false,
      current: start,
      effects: [],
      trim: entry,
    };
    let result: SeriesResult | null = null;
    while (result === null) {
      result = this.step(walk, stop, level);
    }
    return result;
  }

  /** Lowers the current node and moves on; returns once the series ends. */
  private step(
    walk: Walk,
    stop: string | null,
    level: number
  ): SeriesResult | null {
    const { current, effects } = walk;
    walk.trim = this.lowerNode(current, walk.trim, effects, level, walk.closed);
    walk.closed = false;
    const outs = this.outsOf(current);
    const effect = effectOf(this.node(current));
    if (
      (effect !== null && isEffectContainer(effect)) ||
      outs.length > 1 ||
      (outs.length > 0 && this.exitsOf(current).length > 0)
    ) {
      const meeting = this.meetingPoint(current);
      if (meeting === EXIT) {
        throw new LoweringError(
          current,
          "lane-branches",
          "Join these branches in a Merge"
        );
      }
      const placed = placeTrim(
        effects,
        this.lowerRegion(current, meeting, level + 1, effects.length),
        walk.trim
      );
      effects.push(placed.effect);
      walk.trim = placed.trim;
      if (meeting === stop) {
        return { effects, end: meeting, trim: walk.trim };
      }
      walk.current = meeting;
      walk.closed = true;
      return null;
    }
    const [next] = outs;
    if (!next) {
      return { effects, end: current, trim: walk.trim };
    }
    walk.trim = addTrim(walk.trim, next.edge);
    if (next.edge.target === stop) {
      return { effects, end: current, trim: walk.trim };
    }
    walk.current = next.edge.target;
    return null;
  }

  /** Lowers one node in series; returns the trim still pending after it. */
  private lowerNode(
    id: string,
    trim: Trim,
    effects: EffectConfig[],
    level: number,
    closed: boolean
  ): Trim {
    const node = this.node(id);
    this.nodes.push(id);
    switch (node.type) {
      case "station":
        return trim;
      case "gain":
        return { ...trim, gain: trim.gain * dbToGain(node.data.gainDb) };
      case "merge":
        if (!closed && (this.ins.get(id)?.length ?? 0) > 1) {
          throw new LoweringError(
            id,
            "not-series-parallel",
            "This Merge joins branches from different splits"
          );
        }
        return trim;
      case "filter":
      case "pan":
        this.lowerNative(node, level, effects);
        return trim;
      default:
        break;
    }
    const config = effectOf(node);
    if (!config || isEffectContainer(config)) {
      // Containers are lowered as a region by the caller.
      return trim;
    }
    // The key cable is the only source of truth for a sidechain.
    const { sidechain: _, ...effect } = config;
    const placed = placeTrim(
      effects,
      { ...effect, id, order: effects.length } as EffectConfig,
      trim
    );
    effects.push(placed.effect);
    return placed.trim;
  }

  /** Filter and Pan map onto the native strip, before any lane FX. */
  private lowerNative(
    node: Extract<GraphNode, { type: "filter" | "pan" }>,
    level: number,
    effects: readonly EffectConfig[]
  ): void {
    const { name } = getNodeDefinition(node.type);
    if (level > 0 || effects.length > 0) {
      throw new LoweringError(
        node.id,
        "native-position",
        `${name} must come right after the station`
      );
    }
    if (node.type === "filter") {
      const { Q, frequency, type } = node.data;
      this.filter = { frequency, Q, type };
    } else {
      this.pan = node.data.pan;
    }
  }

  private lowerBranch(edge: GraphEdge, meeting: string, level: number): Branch {
    // The branch cable is the chain's own gain and mute, per the proposal.
    const trim: Trim = { gain: edge.gain, muted: edge.muted };
    if (edge.target === meeting) {
      return { effects: [], trim };
    }
    const series = this.lowerSeries(edge.target, UNITY, meeting, level);
    return {
      effects: series.effects,
      trim: {
        gain: trim.gain * series.trim.gain,
        muted: trim.muted || series.trim.muted,
      },
    };
  }

  /** A Split (explicit or implicit) up to the Merge where it meets again. */
  private lowerRegion(
    split: string,
    meeting: string,
    level: number,
    order: number
  ): EffectConfig {
    if (level > MAX_EFFECT_TREE_DEPTH) {
      throw new LoweringError(
        split,
        "split-depth",
        `Up to ${MAX_EFFECT_TREE_DEPTH} splits inside each other`
      );
    }
    const base = effectOf(this.node(split));
    const outs = this.outsOf(split);
    if (!(base && isEffectContainer(base))) {
      return this.lowerFanOut(`${split}:fan-out`, outs, meeting, level, {
        order,
      });
    }
    const ports = splitPorts(base);
    if (!ports) {
      throw new LoweringError(
        split,
        "split-branches",
        `Band Split takes 2 to ${MAX_SPLIT_BRANCHES} bands`
      );
    }
    const configChains = [...base.chains].sort(
      (left, right) => left.order - right.order
    );
    for (const { edge } of outs) {
      if (!ports.includes(edge.sourceHandle)) {
        throw new LoweringError(
          split,
          "split-branches",
          `Band Split has ${ports.length} bands`
        );
      }
    }
    const chains = ports.flatMap((port, index): EffectChainConfig[] => {
      const cables = outs.filter(({ edge }) => edge.sourceHandle === port);
      const chain: EffectChainConfig = configChains[index] ?? {
        effects: [],
        gain: 1,
        id: `${split}:${portName(port)}`,
        muted: false,
        name: `Branch ${index + 1}`,
        order: index,
        pan: 0,
        solo: false,
      };
      if (cables.length === 0) {
        // A Split drops an unused branch; a stereo or band split mutes it.
        return base.type === "fxComposite"
          ? []
          : [{ ...chain, effects: [], muted: true, order: index }];
      }
      const branch =
        cables.length === 1 && cables[0]
          ? this.lowerBranch(cables[0].edge, meeting, level)
          : {
              effects: [
                this.lowerFanOut(
                  `${chain.id}:fan-out`,
                  cables,
                  meeting,
                  level + 1,
                  { order: 0 }
                ),
              ],
              trim: UNITY,
            };
      return [
        {
          ...chain,
          effects: branch.effects,
          gain: chain.gain * branch.trim.gain,
          muted: chain.muted || branch.trim.muted,
          order: index,
        },
      ];
    });
    const { sidechain: _, ...container } = base;
    return {
      ...container,
      chains,
      ...(container.type === "frequencySplit"
        ? { frequencyBandCount: chains.length as 2 | 3 | 4 }
        : {}),
      id: split,
      order,
    } as EffectConfig;
  }

  /** One output cabled to several places that meet again: an implicit Split. */
  private lowerFanOut(
    id: string,
    cables: readonly WiredEdge[],
    meeting: string,
    level: number,
    { order }: { order: number }
  ): FxCompositeConfig {
    const owner = cables[0]?.edge.source ?? id;
    if (level > MAX_EFFECT_TREE_DEPTH) {
      throw new LoweringError(
        owner,
        "split-depth",
        `Up to ${MAX_EFFECT_TREE_DEPTH} splits inside each other`
      );
    }
    if (cables.length > MAX_SPLIT_BRANCHES) {
      throw new LoweringError(
        owner,
        "split-branches",
        `Up to ${MAX_SPLIT_BRANCHES} branches`
      );
    }
    return {
      chains: cables.map(({ edge }, index) => {
        const branch = this.lowerBranch(edge, meeting, level);
        return {
          effects: branch.effects,
          gain: branch.trim.gain,
          id: `${id}:${edge.id}`,
          muted: branch.trim.muted,
          name: `Branch ${index + 1}`,
          order: index,
          pan: 0,
          solo: false,
        };
      }),
      dryWet: 1,
      enabled: true,
      id,
      inputGain: 1,
      order,
      outputGain: 1,
      type: "fxComposite",
    };
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

/** Nodes with a path to an output: backwards from every exit cable. */
function liveNodes(
  exits: readonly WiredEdge[],
  inner: readonly WiredEdge[]
): Set<string> {
  const into = new Map<string, string[]>();
  for (const { edge } of inner) {
    push(into, edge.target, edge.source);
  }
  const live = new Set<string>();
  const queue = exits.map(({ edge }) => edge.source);
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (live.has(id)) {
      continue;
    }
    live.add(id);
    queue.push(...(into.get(id) ?? []));
  }
  return live;
}

function portName(handle: string): string {
  return handle.split(":").at(-1) ?? handle;
}

/** The out handles of a container, one per chain, or null for a bad shape. */
function splitPorts(effect: EffectConfig): string[] | null {
  switch (effect.type) {
    case "fxComposite":
      return range(MAX_SPLIT_BRANCHES).map(
        (index) => `out:audio:branch-${index}`
      );
    case "stereoSplit":
      return ["out:audio:left", "out:audio:right"];
    case "frequencySplit": {
      const crossovers = effect.crossoverFrequencies;
      const bands = crossovers.length + 1;
      const ascending = crossovers.every(
        (frequency, index) =>
          frequency > 0 &&
          (index === 0 || frequency > (crossovers[index - 1] ?? 0))
      );
      if (
        bands < 2 ||
        bands > MAX_SPLIT_BRANCHES ||
        !ascending ||
        effect.chains.length !== bands
      ) {
        return null;
      }
      return range(bands).map((index) => `out:audio:band-${index}`);
    }
    default:
      return null;
  }
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

/** A polynomial string hash, kept below 2^53 so it stays exact. */
function hash(text: string): string {
  const modulus = 2 ** 45;
  let value = 0;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 131 + text.charCodeAt(index)) % modulus;
  }
  return value.toString(36);
}

/**
 * openDAW keeps a default Autotune as a bare device and wraps it otherwise
 * (`usesDirectOfficialEffectLayout`), so that flip is a layout change too.
 */
function isDirectLayout(effect: EffectConfig): boolean {
  return (
    effect.enabled &&
    effect.type === "autotune" &&
    effect.dryWet === 1 &&
    effect.inputGain === 1 &&
    effect.outputGain === 1
  );
}

function layoutOf(effects: readonly EffectConfig[]): unknown[] {
  return effects.map((effect) => [
    effect.id,
    effect.type,
    effect.order,
    isDirectLayout(effect),
    isEffectContainer(effect)
      ? effect.chains.map((chain) => [
          chain.id,
          chain.order,
          layoutOf(chain.effects),
        ])
      : null,
  ]);
}

/** A hash of ids, types, order and chains, with params excluded. */
export function layoutSignature(effects: readonly EffectConfig[]): string {
  return hash(JSON.stringify(layoutOf(effects)));
}

/** Writes the key on the first keyed FX in tree order, and on no other. */
function keyEffects(
  effects: readonly EffectConfig[],
  keys: ReadonlyMap<string, string>
): EffectConfig[] {
  let keyed = false;
  const visit = (current: readonly EffectConfig[]): EffectConfig[] =>
    current.map((effect) => {
      const channelId = keys.get(effect.id);
      let next = effect;
      if (!keyed && channelId !== undefined) {
        keyed = true;
        next = { ...effect, sidechain: { channelId } } as EffectConfig;
      }
      return isEffectContainer(next)
        ? ({
            ...next,
            chains: next.chains.map((chain) => ({
              ...chain,
              effects: visit(chain.effects),
            })),
          } as EffectConfig)
        : next;
    });
  return visit(effects);
}

type Prepared = {
  graph: CompileGraph;
  byId: Map<string, GraphNode>;
  issues: Issue[];
  wired: WiredEdge[];
  labels: ReadonlyMap<string, Lane>;
  /** Keyed FX the validator flagged as a lane's second key. */
  extraKeys: ReadonlySet<string>;
};

function withoutExcluded(
  graph: CompileGraph,
  nodes: ReadonlySet<string>,
  edges: ReadonlySet<string>
): CompileGraph {
  return {
    edges: graph.edges.filter(
      (edge) =>
        !(
          edges.has(edge.id) ||
          nodes.has(edge.source) ||
          nodes.has(edge.target)
        )
    ),
    nodes: graph.nodes.filter((node) => !nodes.has(node.id)),
  };
}

/** Nodes this compiler cannot lower yet, each with the reason. */
function refuse(graph: CompileGraph, { buses, lanes }: Topology): Issue[] {
  return graph.nodes.flatMap((node): Issue[] => {
    let message: string | null = null;
    // Flag where the bus starts; what follows it goes quiet with it.
    if (lanes.get(node.id) === null && buses.get(node.id) === node.id) {
      message = "Mixing stations into a bus isn't available yet";
    } else if (!isCompiled(node.type)) {
      message = `${getNodeDefinition(node.type).name} can't play in a patch yet`;
    }
    return message
      ? [{ code: "unshipped", id: node.id, message, target: "node" }]
      : [];
  });
}

/**
 * Drops what failed validation, then refuses what this compiler cannot lower
 * yet (buses, other sources, control), re-validating after every round until
 * the patch is stable, so an issue a drop uncovers is reported too. Each
 * round drops at least one node or cable, so this always settles. Advisory
 * issues come from the final round, the patch the plan is built from.
 */
function prepare(graph: CompileGraph, env: CompileEnv): Prepared {
  const excludedNodes = new Set<string>();
  const excludedEdges = new Set<string>();
  const issues: Issue[] = [];
  for (;;) {
    const kept = withoutExcluded(graph, excludedNodes, excludedEdges);
    const analysis = analyseGraph(kept, env);
    const advisory = analysis.issues.filter((issue) =>
      ADVISORY_CODES.has(issue.code)
    );
    let blocking = analysis.issues.filter(
      (issue) => !ADVISORY_CODES.has(issue.code)
    );
    if (blocking.length === 0) {
      blocking = refuse(kept, analysis.topology);
    }
    if (blocking.length === 0) {
      return {
        byId: new Map(kept.nodes.map((node) => [node.id, node])),
        extraKeys: new Set(
          advisory
            .filter((issue) => issue.code === "lane-key")
            .map((issue) => issue.id)
        ),
        graph: kept,
        issues: [...issues, ...advisory],
        labels: analysis.topology.lanes,
        wired: analysis.wired,
      };
    }
    for (const issue of blocking) {
      issues.push(issue);
      (issue.target === "node" ? excludedNodes : excludedEdges).add(issue.id);
    }
  }
}

/** Keyed FX node id → the key's lane channel, grouped by the keyed lane. */
function planKeys({
  byId,
  extraKeys,
  labels,
  wired,
}: Prepared): Map<string, Map<string, string>> {
  const keys = new Map<string, Map<string, string>>();
  for (const { edge, to } of wired) {
    const from = labels.get(edge.source);
    const lane = labels.get(edge.target);
    const station = typeof from === "string" ? byId.get(from) : undefined;
    const target = byId.get(edge.target);
    if (
      to.kind !== "sidechain" ||
      typeof lane !== "string" ||
      station?.type !== "station" ||
      station.data.radio === null ||
      // The key the validator flagged stays unkeyed, so the badge is honest.
      extraKeys.has(edge.target) ||
      !(target && isKeyable(target))
    ) {
      continue;
    }
    const laneKeys = keys.get(lane) ?? new Map<string, string>();
    laneKeys.set(edge.target, laneChannelId(station.id));
    keys.set(lane, laneKeys);
  }
  return keys;
}

function isKeyable(node: GraphNode): boolean {
  return (SIDECHAIN_EFFECT_TYPES as readonly string[]).includes(node.type);
}

function groupLanes(
  labels: ReadonlyMap<string, Lane>
): Map<string, Set<string>> {
  const members = new Map<string, Set<string>>();
  for (const [id, lane] of labels) {
    if (typeof lane === "string") {
      const set = members.get(lane) ?? new Set<string>();
      set.add(id);
      members.set(lane, set);
    }
  }
  return members;
}

type LoweredLane = {
  lowerer: LaneLowerer;
  effects: EffectConfig[];
  exits: EdgePlan[];
};

/** Lowers one station lane; a lowering error silences it and is reported. */
function lowerLane(
  station: GraphNode,
  prepared: Prepared,
  members: ReadonlySet<string>,
  sinks: ReadonlySet<string>
): LoweredLane {
  const lowerer = new LaneLowerer(
    prepared.byId,
    members,
    prepared.wired,
    sinks
  );
  try {
    const series = lowerer.lowerSeries(station.id, UNITY, null, 0);
    const exits = lowerer.exitsOf(series.end).map(({ edge }): EdgePlan => {
      const { gain, muted } = addTrim(series.trim, edge);
      return {
        from: { id: station.id, kind: "lane" },
        gain,
        id: edge.id,
        muted,
        to: { id: edge.target, kind: "sink" },
      };
    });
    return { effects: series.effects, exits, lowerer };
  } catch (error) {
    if (!(error instanceof LoweringError)) {
      throw error;
    }
    // Fail closed: the lane plays into nothing until the patch is fixed.
    prepared.issues.push({
      code: error.code,
      id: error.nodeId,
      message: error.message,
      target: "node",
    });
    return { effects: [], exits: [], lowerer };
  }
}

/**
 * official only when every enabled effect maps to openDAW, the page is
 * cross-origin isolated and the lane still fits under the channel cap.
 */
function estimateBackend(
  effects: readonly EffectConfig[],
  env: CompileEnv,
  monitoringChannels: number
): LaneBackend | null {
  if (!hasEnabledEffects(effects)) {
    return null;
  }
  return env.crossOriginIsolated &&
    canUseOfficialOpenDawRuntime(effects) &&
    monitoringChannels + LANE_CHANNELS <= MONITORING_CHANNEL_CAP
    ? "official"
    : "compat";
}

/** Compiles a patch into the plan the node engine reconciles against. */
export function compile(graph: CompileGraph, env: CompileEnv): EnginePlan {
  const prepared = prepare(graph, env);
  const sinks = new Map<string, SinkPlan>();
  for (const node of prepared.graph.nodes) {
    if (getNodeDefinition(node.type).category === "output") {
      sinks.set(node.id, { id: node.id, type: node.type });
    }
  }
  const sinkIds = new Set(sinks.keys());
  const members = groupLanes(prepared.labels);
  const keys = planKeys(prepared);

  const lanes = new Map<string, LanePlan>();
  const edges = new Map<string, EdgePlan>();
  let monitoringChannels = 0;
  for (const node of prepared.graph.nodes) {
    // An empty Station is a search slot: no lane, but its cables survive.
    if (node.type !== "station" || node.data.radio === null) {
      continue;
    }
    const lowered = lowerLane(
      node,
      prepared,
      members.get(node.id) ?? new Set([node.id]),
      sinkIds
    );
    const effects = keyEffects(lowered.effects, keys.get(node.id) ?? new Map());
    const backend = estimateBackend(effects, env, monitoringChannels);
    if (backend === "official") {
      monitoringChannels += LANE_CHANNELS;
    }
    lanes.set(node.id, {
      backend,
      channelId: laneChannelId(node.id),
      effects,
      filter: lowered.lowerer.filter,
      id: node.id,
      layoutSignature: layoutSignature(effects),
      nodes: lowered.lowerer.nodes,
      pan: lowered.lowerer.pan,
      radio: node.data.radio,
      soundId: laneSoundId(node.id),
    });
    for (const edge of lowered.exits) {
      edges.set(edge.id, edge);
    }
  }

  return {
    budget: { monitoringChannels },
    edges,
    issues: prepared.issues,
    lanes,
    sinks,
  };
}
