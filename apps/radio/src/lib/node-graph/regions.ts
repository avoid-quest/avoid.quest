/**
 * Node Graph Regions
 *
 * Cuts the live audio graph into the pieces the engine runs, and lowers
 * each piece into one series-parallel EffectConfig tree.
 *
 * A **point** is a place the signal must exist in Web Audio:
 *
 * - before a node whose input sums more than one cable, unless it is the
 *   node closing a split region;
 * - before and after a Filter or Pan that is not one of its source's
 *   leading strip natives (a filter or pan module), unless it is a Filter
 *   in series between FX: there it runs as Revamp's pass filter, which
 *   does the same, inside their chain, so the signal never leaves openDAW
 *   and comes back a quantum late. A Pan has no exact openDAW equal (Web
 *   Audio's panner moves one side into the other), so it stays a module;
 * - after a node whose output goes to several places that don't meet
 *   again (an open fan-out);
 * - before every output (sink).
 *
 * A **segment** is the series between points, its split regions included:
 * every region inside one closes at its meeting node, the nearest node
 * past the split that every branch reaches and that joins cables (a Merge,
 * or any node or output that sums). A segment that starts at a source is
 * that source's lane insert; any other segment with FX is a graph unit.
 * Each effect node lowers into exactly one segment, so nothing is copied.
 *
 * A patch that only uses in-lane regions has no point before its outputs,
 * so its lane trees are those lane lowering has always made.
 */

import { createDefaultEffectConfig } from "@/lib/audio/dsp/effects/registry";
import { EFFECT_DEFINITIONS } from "@/lib/audio/dsp/effects/schema";
import type {
  EffectChainConfig,
  EffectConfig,
  FxCompositeConfig,
} from "@/lib/audio/dsp/effects/types";
import {
  isEffectContainer,
  MAX_EFFECT_TREE_DEPTH,
  usesDirectEffectLayout,
} from "@/lib/audio/dsp/routing/effect-tree";
import { getNodeDefinition, isEffectNodeType } from "./catalogue";
import type { GraphEdge, GraphNode } from "./schema";
import { type IssueCode, liveAudioNodes, type WiredEdge } from "./validate";

/** A Split, Band Split or implicit fan-out takes 2 to 4 branches. */
export const MAX_SPLIT_BRANCHES = 4;

/** Why an explicit Split whose branches go different ways is refused. */
export const OPEN_SPLIT_MESSAGE =
  "Sending a Split's branches to different places comes with the next update";

export type NativeFilterPlan = {
  type: "lowpass" | "highpass";
  frequency: number;
  Q: number;
};

/** A trim waiting for the next point that can apply it. */
export type Trim = { gain: number; muted: boolean };

export const UNITY: Trim = { gain: 1, muted: false };

export function addTrim(
  trim: Trim,
  edge: Pick<GraphEdge, "gain" | "muted">
): Trim {
  return { gain: trim.gain * edge.gain, muted: trim.muted || edge.muted };
}

function trimLevel(trim: Trim): number {
  return trim.muted ? 0 : trim.gain;
}

export function clampPan(pan: number): number {
  return Math.min(1, Math.max(-1, pan));
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function effectOf(node: GraphNode | undefined): EffectConfig | null {
  return node && isEffectNodeType(node.type)
    ? (node.data as { effect: EffectConfig }).effect
    : null;
}

/**
 * A Split's branches mix at −3 dB each, as its first two chains come from
 * the registry, so a third or fourth branch matches them. Stereo and band
 * splits divide the signal, so theirs stay at unity.
 */
export function defaultChainGain(
  type: "fxComposite" | "stereoSplit" | "frequencySplit"
): number {
  return EFFECT_DEFINITIONS[type].defaultConfig.chains[0]?.gain ?? 1;
}

const REVAMP_BANDS = [
  "highPass",
  "lowShelf",
  "lowBell",
  "midBell",
  "highBell",
  "highShelf",
  "lowPass",
] as const;

/**
 * A Filter between FX as the openDAW device that does the same: a Revamp
 * with only its 12 dB/oct pass filter on, Q from Web Audio's dB to linear.
 */
function revampFilter(
  node: Extract<GraphNode, { type: "filter" }>,
  order: number
): EffectConfig {
  const pass = node.data.type === "lowpass" ? "lowPass" : "highPass";
  const revamp = createDefaultEffectConfig("revamp", node.id, order);
  for (const band of REVAMP_BANDS) {
    revamp[`${band}Enabled`] = band === pass;
  }
  return {
    ...revamp,
    enabled: true,
    [`${pass}Frequency`]: node.data.frequency,
    [`${pass}Order`]: 1,
    [`${pass}Q`]: 10 ** (node.data.Q / 20),
  };
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
 * Places pending trim before the whole FX signal, including its dry path.
 * A silencing trim also stays pending, so the exits stay muted too: when an
 * FX is switched on, the mute moving into it never opens a send while the
 * async effect update is still on its way. A trim after a default Autotune
 * goes into the next FX instead of its output, even at unity, so turning
 * it never flips the Autotune's bare-device layout and rebuilds the lane.
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
  const pending = level === 0 ? trim : UNITY;
  const previousIndex = lastEnabledIndex(effects);
  const previous = effects[previousIndex];
  if (previous && !usesDirectEffectLayout(previous)) {
    effects[previousIndex] = {
      ...previous,
      outputGain: previous.outputGain * level,
    } as EffectConfig;
    return { effect, trim: pending };
  }
  return {
    effect: {
      ...effect,
      outputGain: level === 0 && effect.dryWet < 1 ? 0 : effect.outputGain,
      signalGain: level,
    } as EffectConfig,
    trim: pending,
  };
}

export class LoweringError extends Error {
  readonly nodeId: string;
  readonly code: IssueCode;

  constructor(nodeId: string, code: IssueCode, message: string) {
    super(message);
    this.nodeId = nodeId;
    this.code = code;
  }
}

/**
 * Ids the compiler makes up, which never take one the patch uses, while
 * each patch id is used once. A tree's: an effect is keyed by id in the
 * engine, and a chain within its tree, so an implicit fan-out and its
 * branches never take a node's or a Split chain's id, and a chain id two
 * containers share is used once. A plan's cables': one carrying several
 * patch cables never takes a patch cable's id.
 */
export class FreshIds {
  private readonly taken: Set<string>;
  private readonly used = new Set<string>();

  constructor(patchIds: ReadonlySet<string>) {
    this.taken = new Set(patchIds);
  }

  /** `base`, or `base~2`, `base~3`… when that is taken. */
  fresh(base: string): string {
    let id = base;
    for (let suffix = 2; this.taken.has(id); suffix += 1) {
      id = `${base}~${suffix}`;
    }
    this.taken.add(id);
    this.used.add(id);
    return id;
  }

  /** A patch's own id, kept unless this tree already used it. */
  claim(id: string): string {
    if (this.used.has(id)) {
      return this.fresh(id);
    }
    this.used.add(id);
    return id;
  }
}

/** Where a segment's audio goes next: one cable, or a closed region's sum. */
export type SegmentExit = {
  /** The cable ids it folds, joined into the plan cable's id. */
  ids: string[];
  target: string;
  trim: Trim;
};

export type Segment = {
  /** Nodes lowered into it, its head first. */
  nodes: string[];
  effects: EffectConfig[];
  /** A source's leading strip natives; null elsewhere. */
  filter: NativeFilterPlan | null;
  pan: number;
  exits: SegmentExit[];
};

type Walk = {
  current: string;
  effects: EffectConfig[];
  trim: Trim;
};

type SeriesResult = {
  effects: EffectConfig[];
  /** Trim still pending at the end, for the chain gain or the exits. */
  trim: Trim;
  exits: SegmentExit[];
};

type Branch = { effects: EffectConfig[]; trim: Trim };

const EXIT = "\u0000exit";

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
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

export type RegionInput = {
  byId: ReadonlyMap<string, GraphNode>;
  wired: readonly WiredEdge[];
  /** Output nodes: every cable into one ends at a point. */
  sinks: ReadonlySet<string>;
};

/**
 * The live audio graph between the sources and the outputs, cut into
 * segments. Only nodes a source feeds and that reach an output take part;
 * dead ends are inaudible and skipped. An empty source still feeds its
 * nodes here, so filling it doesn't move where the patch is cut.
 */
export class RegionLowerer {
  private readonly byId: ReadonlyMap<string, GraphNode>;
  private readonly sinks: ReadonlySet<string>;
  private readonly patchIds: Set<string>;
  private readonly outs = new Map<string, WiredEdge[]>();
  private readonly ins = new Map<string, WiredEdge[]>();
  private readonly postDominators = new Map<string, Set<string>>();
  private readonly regionCache = new Map<string, Set<string>>();
  /** Filter and Pan nodes on their source's strip. */
  private readonly leading = new Set<string>();
  /** Filters in series between FX: they run in the chain. */
  private absorbed = new Set<string>();
  /** Region heads whose region closes, by their meeting node. */
  private closed = new Map<string, string>();
  /** Multi-input nodes that close a region with nothing else coming in. */
  private closers = new Set<string>();

  constructor({ byId, wired, sinks }: RegionInput) {
    this.byId = byId;
    this.sinks = sinks;
    this.patchIds = new Set(byId.keys());
    for (const node of byId.values()) {
      const effect = effectOf(node);
      for (const chain of effect && isEffectContainer(effect)
        ? effect.chains
        : []) {
        this.patchIds.add(chain.id);
      }
    }
    const audio = wired.filter(
      ({ from, to }) => from.kind === "audio" && to.kind === "audio"
    );
    const live = liveAudioNodes(
      audio.filter(({ edge }) => sinks.has(edge.target)),
      audio.filter(({ edge }) => !sinks.has(edge.target))
    );
    const fed = this.fedNodes(audio);
    for (const wire of audio) {
      const { source, target } = wire.edge;
      if (
        fed.has(source) &&
        live.has(source) &&
        (sinks.has(target) || live.has(target))
      ) {
        push(this.outs, source, wire);
        push(this.ins, target, wire);
      }
    }
    this.findLeading();
    this.settleCuts();
  }

  /** Nodes a source reaches along audio cables, the sources included. */
  private fedNodes(audio: readonly WiredEdge[]): Set<string> {
    const next = new Map<string, string[]>();
    for (const { edge } of audio) {
      push(next, edge.source, edge.target);
    }
    const fed = new Set<string>();
    const queue = [...this.byId.values()]
      .filter((node) => getNodeDefinition(node.type).source)
      .map((node) => node.id);
    for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
      if (!fed.has(id)) {
        fed.add(id);
        queue.push(...(next.get(id) ?? []));
      }
    }
    return fed;
  }

  outsOf(id: string): WiredEdge[] {
    return this.outs.get(id) ?? [];
  }

  insOf(id: string): WiredEdge[] {
    return this.ins.get(id) ?? [];
  }

  node(id: string): GraphNode {
    const node = this.byId.get(id);
    if (!node) {
      throw new Error(`Node not found: ${id}`);
    }
    return node;
  }

  private isNative(id: string): boolean {
    const { type } = this.node(id);
    return type === "filter" || type === "pan";
  }

  /**
   * Each source's strip takes one Filter and one Pan from its leading
   * series, before any FX, branch or join.
   */
  private findLeading(): void {
    for (const node of this.byId.values()) {
      if (!getNodeDefinition(node.type).source) {
        continue;
      }
      const seen = new Set<string>();
      let id: string | undefined = node.id;
      while (id !== undefined) {
        const { type } = this.node(id);
        if (this.isNative(id)) {
          if (seen.has(type)) {
            break;
          }
          seen.add(type);
          this.leading.add(id);
        }
        const outs = this.outsOf(id);
        const next = outs[0]?.edge.target;
        id =
          getNodeDefinition(type).effectType ||
          outs.length !== 1 ||
          next === undefined ||
          this.sinks.has(next) ||
          this.insOf(next).length > 1
            ? undefined
            : next;
      }
    }
  }

  /**
   * A Filter or Pan off the strip, but for a Filter between FX: its own Web
   * Audio node.
   */
  isModule(id: string): boolean {
    return this.isNative(id) && !this.leading.has(id) && !this.absorbed.has(id);
  }

  /**
   * Whether an effect lies along the series from `id`, upstream or down,
   * before the series ends at a point, a branch or a join.
   */
  private reachesEffect(id: string, upstream: boolean): boolean {
    let current = id;
    for (let steps = 0; steps < this.byId.size; steps += 1) {
      const wires = upstream ? this.insOf(current) : this.outsOf(current);
      const [wire] = wires;
      if (!wire || wires.length > 1) {
        return false;
      }
      const { source, target } = wire.edge;
      if (this.isCutAfter(source) || this.isCutBefore(target)) {
        return false;
      }
      current = upstream ? source : target;
      if (effectOf(this.byId.get(current))) {
        return true;
      }
    }
    return false;
  }

  /** A point before the node: its input is a real signal. */
  isCutBefore(id: string): boolean {
    return (
      this.sinks.has(id) ||
      this.isModule(id) ||
      (this.insOf(id).length > 1 && !this.closers.has(id))
    );
  }

  /** A point after the node: its output is a real signal. */
  isCutAfter(id: string): boolean {
    return this.isModule(id) || (this.isRegionHead(id) && !this.closed.has(id));
  }

  private isRegionHead(id: string): boolean {
    const effect = effectOf(this.byId.get(id));
    return (
      !this.isModule(id) &&
      ((effect !== null && isEffectContainer(effect)) ||
        this.outsOf(id).length > 1)
    );
  }

  /** Nodes every path from `id` to an output passes, `id` included. */
  private postDominatorsOf(id: string): Set<string> {
    const known = this.postDominators.get(id);
    if (known) {
      return known;
    }
    const successors = this.sinks.has(id)
      ? [EXIT]
      : this.outsOf(id).map(({ edge }) => edge.target);
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
   * The nearest node every branch leaving `id` meets again that joins
   * cables: a Merge or an output, which close a Split even with one branch
   * cabled, or any node that sums. Null when the branches never meet.
   */
  private meetingPoint(id: string): string | null {
    let nearest: string | null = null;
    let depth = 0;
    for (const candidate of this.postDominatorsOf(id)) {
      if (
        candidate === id ||
        candidate === EXIT ||
        !(
          this.node(candidate).type === "merge" ||
          this.sinks.has(candidate) ||
          this.insOf(candidate).length > 1
        )
      ) {
        continue;
      }
      // Post-dominators form a chain; the nearest one has the most.
      const { size } = this.postDominatorsOf(candidate);
      if (size > depth) {
        nearest = candidate;
        depth = size;
      }
    }
    return nearest;
  }

  /** The nodes strictly between a region's head and its meeting node. */
  private regionOf(head: string, meeting: string): Set<string> {
    const known = this.regionCache.get(head);
    if (known) {
      return known;
    }
    const region = new Set<string>();
    const queue = this.outsOf(head).map(({ edge }) => edge.target);
    for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
      if (id !== meeting && !region.has(id)) {
        region.add(id);
        queue.push(...this.outsOf(id).map(({ edge }) => edge.target));
      }
    }
    this.regionCache.set(head, region);
    return region;
  }

  /**
   * Settles which regions close and which Filters run in an FX chain.
   * Every region that has a meeting node starts closed, and every Filter in
   * series runs in the chain; a region with a point inside opens, and a
   * Filter with no FX on both sides becomes a module,
   * either of which can make more points. Points are only ever added, so
   * this settles.
   */
  private settleCuts(): void {
    this.absorbed = new Set(
      [...this.byId.keys()].filter(
        (id) =>
          this.node(id).type === "filter" &&
          !this.leading.has(id) &&
          this.insOf(id).length === 1 &&
          this.outsOf(id).length === 1
      )
    );
    const heads = new Map<string, string>();
    for (const id of this.outs.keys()) {
      const meeting = this.isRegionHead(id) ? this.meetingPoint(id) : null;
      if (meeting !== null) {
        heads.set(id, meeting);
      }
    }
    this.closed = new Map(heads);
    for (;;) {
      this.closers = new Set(
        [...this.closed].flatMap(([head, meeting]) => {
          const region = this.regionOf(head, meeting);
          return this.insOf(meeting).every(
            ({ edge }) => edge.source === head || region.has(edge.source)
          )
            ? [meeting]
            : [];
        })
      );
      const next = new Map(
        [...this.closed].filter(([head, meeting]) =>
          [...this.regionOf(head, meeting)].every(
            (id) => !(this.isCutBefore(id) || this.isCutAfter(id))
          )
        )
      );
      const absorbed = new Set(
        [...this.absorbed].filter(
          (id) => this.reachesEffect(id, true) && this.reachesEffect(id, false)
        )
      );
      if (
        next.size === this.closed.size &&
        absorbed.size === this.absorbed.size
      ) {
        return;
      }
      this.closed = next;
      this.absorbed = absorbed;
    }
  }

  /** Explicit Splits whose branches don't meet again: refused for now. */
  openSplits(): string[] {
    return [...this.byId.values()].flatMap((node) => {
      const effect = effectOf(node);
      return effect &&
        isEffectContainer(effect) &&
        this.outs.has(node.id) &&
        !this.closed.has(node.id)
        ? [node.id]
        : [];
    });
  }

  /**
   * Lowers the segment `head` starts, up to the points it ends at. Its
   * strip natives are taken only from a source's own segment.
   */
  lowerSegment(head: string): Segment {
    const segment = new SegmentLowerer(this, new FreshIds(this.patchIds));
    const series = segment.lowerSeries(head, UNITY, null, 0);
    return {
      effects: series.effects,
      exits: series.exits,
      filter: segment.filter,
      nodes: segment.nodes,
      pan: segment.pan,
    };
  }

  /** The node a closed region meets again at, or null. */
  meetingOf(id: string): string | null {
    return this.closed.get(id) ?? null;
  }

  isLeading(id: string): boolean {
    return this.leading.has(id);
  }
}

/** Lowers one segment's series and the regions inside it into one tree. */
class SegmentLowerer {
  readonly nodes: string[] = [];
  pan = 0;
  filter: NativeFilterPlan | null = null;
  private readonly regions: RegionLowerer;
  private readonly ids: FreshIds;

  constructor(regions: RegionLowerer, ids: FreshIds) {
    this.regions = regions;
    this.ids = ids;
  }

  /**
   * Walks a series from `start` until `stop` (a node closing the region)
   * or the segment's end at a point. `start` itself is lowered first.
   */
  lowerSeries(
    start: string,
    entry: Trim,
    stop: string | null,
    level: number
  ): SeriesResult {
    const walk: Walk = {
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
    const { regions } = this;
    const { current, effects } = walk;
    walk.trim = this.lowerNode(current, walk.trim, effects);
    const outs = regions.outsOf(current);
    const meeting = regions.meetingOf(current);
    if (meeting !== null) {
      const placed = placeTrim(
        effects,
        this.lowerRegion(current, meeting, level + 1, effects.length),
        walk.trim
      );
      effects.push(placed.effect);
      walk.trim = placed.trim;
      if (meeting === stop) {
        return { effects, exits: [], trim: walk.trim };
      }
      if (regions.isCutBefore(meeting)) {
        // The region sums straight into a point: one cable for its branches.
        const ids = regions
          .insOf(meeting)
          .filter(({ edge }) => this.nodes.includes(edge.source))
          .map(({ edge }) => edge.id);
        return {
          effects,
          exits: [{ ids, target: meeting, trim: walk.trim }],
          trim: walk.trim,
        };
      }
      walk.current = meeting;
      return null;
    }
    if (regions.isCutAfter(current) || outs.length !== 1) {
      return {
        effects,
        exits: outs.map(({ edge }) => ({
          ids: [edge.id],
          target: edge.target,
          trim: addTrim(walk.trim, edge),
        })),
        trim: walk.trim,
      };
    }
    const [next] = outs;
    if (!next) {
      return { effects, exits: [], trim: walk.trim };
    }
    const trim = addTrim(walk.trim, next.edge);
    if (next.edge.target === stop) {
      return { effects, exits: [], trim };
    }
    if (regions.isCutBefore(next.edge.target)) {
      return {
        effects,
        exits: [{ ids: [next.edge.id], target: next.edge.target, trim }],
        trim,
      };
    }
    walk.trim = trim;
    walk.current = next.edge.target;
    return null;
  }

  /** Lowers one node in series; returns the trim still pending after it. */
  private lowerNode(id: string, trim: Trim, effects: EffectConfig[]): Trim {
    const node = this.regions.node(id);
    this.nodes.push(id);
    let config = effectOf(node);
    switch (node.type) {
      case "gain":
        return { ...trim, gain: trim.gain * dbToGain(node.data.gainDb) };
      case "pan":
        // Any other Pan is a module, a point no segment runs through.
        this.lowerNative(node);
        return trim;
      case "filter":
        if (this.regions.isLeading(id)) {
          this.lowerNative(node);
          return trim;
        }
        // Between FX: Revamp's pass filter does the same.
        config = revampFilter(node, effects.length);
        break;
      default:
        break;
    }
    if (!config || isEffectContainer(config)) {
      // Sources and Merges pass through; containers lower as a region.
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
    node: Extract<GraphNode, { type: "filter" | "pan" }>
  ): void {
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

  /** A Split (explicit or implicit) up to the node where it meets again. */
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
    const base = effectOf(this.regions.node(split));
    const outs = this.regions.outsOf(split);
    if (!(base && isEffectContainer(base))) {
      return this.lowerFanOut(`${split}:fan-out`, outs, meeting, level, {
        branchParams: false,
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
      const configured = configChains[index];
      const chain: EffectChainConfig = configured
        ? { ...configured, id: this.ids.claim(configured.id) }
        : {
            effects: [],
            gain: defaultChainGain(base.type),
            id: this.ids.fresh(`${split}:${portName(port)}`),
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
      const cable = cables.length === 1 ? cables[0]?.edge : undefined;
      const branch = cable
        ? this.lowerBranch(cable, meeting, level)
        : {
            effects: [
              this.lowerFanOut(
                `${chain.id}:fan-out`,
                cables,
                meeting,
                level + 1,
                { branchParams: true, order: 0 }
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
          // The branch cable carries the chain's pan and solo, on top of
          // what the container holds (a MIDI-learned chain pan). With
          // several cables on the port each keeps its own in the nested
          // fan-out, and a soloed one also solos its branch over the rest.
          pan: clampPan(chain.pan + (cable?.pan ?? 0)),
          solo: chain.solo || cables.some(({ edge }) => edge.solo === true),
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

  /**
   * One output cabled to several places that meet again: an implicit Split.
   * Only cables out of a split port take their pan and solo
   * (`branchParams`), as only those draw branch controls to change them.
   */
  private lowerFanOut(
    base: string,
    cables: readonly WiredEdge[],
    meeting: string,
    level: number,
    { branchParams, order }: { branchParams: boolean; order: number }
  ): FxCompositeConfig {
    const owner = cables[0]?.edge.source ?? base;
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
    const id = this.ids.fresh(base);
    return {
      chains: cables.map(({ edge }, index) => {
        const chainId = this.ids.fresh(`${id}:${edge.id}`);
        const branch = this.lowerBranch(edge, meeting, level);
        return {
          effects: branch.effects,
          gain: branch.trim.gain,
          id: chainId,
          muted: branch.trim.muted,
          name: `Branch ${index + 1}`,
          order: index,
          pan: branchParams ? (edge.pan ?? 0) : 0,
          solo: branchParams && edge.solo === true,
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
