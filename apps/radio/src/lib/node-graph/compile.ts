/**
 * Node Graph Compiler
 *
 * Lowers a validated patch onto what the engine runs. Each live source
 * (a Station's stream, a Track's or File's audio, or an Audio input's
 * capture) is one lane: one managed sound with a leading Filter and Pan
 * on its native strip and the FX only it feeds as its insert, one
 * series-parallel EffectConfig tree before its fader. Past the first point
 * (regions.ts) the patch is a routing graph after the faders: graph units
 * (FX chains several sources share, or that a branch takes on its own),
 * modules (sums, and Filters and Pans off the strip), outputs, and one
 * cable per connection between them. A key cable taps any point: it is a
 * cable into the key it feeds, a sum the keyed effect's sidechain binds to.
 * Nothing here touches audio; `reconcile.ts` diffs two plans' lanes.
 *
 * Each source's channel strip folds in here too: its trim multiplies into
 * every cable leaving its lane (as an in-lane Gain would), its pan adds to
 * the lane's Pan, any solo mutes the cables of every unsoloed lane, and a
 * Track's or File's speed, key lock, loop and cue listen become the lane's
 * transport. The fader and mute stay the source's own.
 *
 * Control and modulation land with the layers that ship them. Until then a
 * node this compiler can't lower is refused with an issue, never dropped.
 */

import {
  canUseOfficialOpenDawRuntime,
  hasEnabledEffects,
  MAX_MONITORING_CHANNELS,
} from "@/lib/audio/dsp/effects/official-opendaw-mapping";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  audibleEffects,
  audibleSidechainIds,
  isEffectContainer,
  usesDirectEffectLayout,
} from "@/lib/audio/dsp/routing/effect-tree";
import { getNodeDefinition, isEffectNodeType } from "./catalogue";
import { laneChannelId, laneSoundId } from "./identifiers";
import {
  clampPan,
  dbToGain,
  ENCLOSED_KEY_MESSAGE,
  FreshIds,
  LoweringError,
  type NativeFilterPlan,
  OPEN_SPLIT_MESSAGE,
  RegionLowerer,
  type Segment,
  type SegmentExit,
  type Trim,
  UNITY,
} from "./regions";
import {
  type GraphEdge,
  type GraphNode,
  isMediaSourceType,
  isRadioSourceNode,
  isStripSource,
  type NodeGraph,
  type NodeType,
  type RadioSourceNode,
  type SourceStrip,
} from "./schema";
import { isLocalFileGone } from "./sources";
import {
  analyseGraph,
  type Issue,
  type IssueCode,
  parseHandleId,
  type ValidateOptions,
  type WiredEdge,
} from "./validate";

export type { NativeFilterPlan } from "./regions";
export { defaultChainGain, MAX_SPLIT_BRANCHES } from "./regions";

const LANE_CHANNELS = 2;

export type CompileEnv = ValidateOptions & {
  /** openDAW needs cross-origin isolation; read once by the caller. */
  crossOriginIsolated: boolean;
};

/** A display estimate only; the effects controller still decides. */
export type LaneBackend = "official" | "compat";

export type StationRadio = NonNullable<
  Extract<GraphNode, { type: "station" }>["data"]["radio"]
>;

type DeviceInNode = Extract<GraphNode, { type: "deviceIn" }>;

export type ChannelSelectionPlan = DeviceInNode["data"]["channelSelection"];

/** What a lane plays: a radio's stream, or a device's live capture. */
export type LaneSource =
  | { kind: "radio"; radio: StationRadio }
  | {
      kind: "device";
      capture?: "display";
      deviceId: string;
      channelSelection: ChannelSelectionPlan;
      echoCancellation: boolean;
    };

/**
 * A Track's or File's transport, from its strip: seekable media only. Loop
 * repeats the whole track at its end.
 */
export type LaneTransport = {
  speed: number;
  keyLock: boolean;
  loop: boolean;
};

export type LanePlan = {
  /** The source node id. */
  id: string;
  /** Playback channel id in the node session: `n:<id>`. */
  channelId: string;
  /** Managed sound id: `node:n:<id>`. */
  soundId: string;
  source: LaneSource;
  /**
   * The channel's radio: the station, or for an Audio input the
   * device-input radio DJ decks use, so the session channel cache holds it.
   */
  radio: StationRadio;
  /**
   * The source's own fader and mute, owned by the lane's volume control.
   * Cable levels never fold in here; they act downstream of the fader.
   */
  volume: number;
  muted: boolean;
  /** Nodes lowered into this lane, source first. */
  nodes: string[];
  /** The lane's Pan node plus its strip pan, clamped. */
  pan: number;
  filter: NativeFilterPlan | null;
  /** Its insert: the FX only this source feeds, before its fader. */
  effects: EffectConfig[];
  /** Changes only when effect ids, types, order or chains change. */
  layoutSignature: string;
  /** null when the lane has no enabled FX and so no effects runtime. */
  backend: LaneBackend | null;
  /** A Track's or File's transport; null for live radio and inputs. */
  transport: LaneTransport | null;
  /** Plays the lane pre-fader on the headphone cue output. */
  cueListen: boolean;
};

/** A lane, unit, module or output, by its kind and node id. */
export type Endpoint = {
  kind: "lane" | "unit" | ModulePlan["kind"] | "sink";
  id: string;
};

/** An endpoint as one string: a point changes with its kind. */
export function endpointKey({ kind, id }: Endpoint): string {
  return `${kind}:${id}`;
}

/** One connection between two endpoints: one GainNode in the engine. */
export type CablePlan = {
  /**
   * Unique among the plan's cables: the id of the patch cable it carries,
   * or a fresh one no patch cable has when it carries several.
   */
  id: string;
  /**
   * The patch cables it carries: one, or several where a region's
   * branches sum straight into a point.
   */
  edges: string[];
  from: Endpoint;
  to: Endpoint;
  /** Linear, with the strip trim, Gains and cable trims folded in. */
  gain: number;
  /** Muted, by its own cables or by another source's solo. */
  muted: boolean;
  /**
   * Render quanta it waits on a DelayNode, so every cable into a point
   * arrives in step with the slowest.
   */
  delay: number;
  /**
   * It goes back into openDAW: Web Audio reads it a render quantum late
   * on its own, and it passes a DelayNode, at no added delay, as every
   * loop through the worklet wants one.
   */
  reenters: boolean;
  /**
   * A key cable feeds a key, not audio: another source's solo leaves it on,
   * as a detector input is never on air.
   */
  kind: "audio" | "key";
};

/** One FX chain in the routing graph, after the faders feeding it. */
export type UnitPlan = {
  /** Its first node: stable across parameter edits. */
  id: string;
  nodes: string[];
  effects: EffectConfig[];
  layoutSignature: string;
  backend: LaneBackend | null;
  /** Every source reaching it is a live input: it skips the main delay. */
  realtime: boolean;
};

/**
 * A Web Audio point in the routing graph: a sum, a Filter or a Pan; a key,
 * the stereo sum of key cables keyed effects bind their sidechain to; or a
 * tap, the same sum handed to a follower (control, next layer).
 */
export type ModulePlan = { id: string; realtime: boolean } & (
  | { kind: "sum" }
  | { kind: "filter"; filter: NativeFilterPlan }
  | { kind: "pan"; pan: number }
  | { kind: "key" }
  | { kind: "tap" }
);

export type SinkPlan = {
  id: string;
  type: GraphNode["type"];
  /** Output device nodes: the device picked, or null while none is. */
  deviceId?: string | null;
  /** Output device nodes: their mute silences every cable into them. */
  muted?: boolean;
};

export type EnginePlan = {
  lanes: Map<string, LanePlan>;
  units: Map<string, UnitPlan>;
  /** By endpoint key: a generated key id never meets a node's own. */
  modules: Map<string, ModulePlan>;
  cables: Map<string, CablePlan>;
  sinks: Map<string, SinkPlan>;
  monitoringChannels: number;
  /** Validation and compile issues; the plan leaves their nodes out. */
  issues: Issue[];
};

/**
 * A Station, Track or File plays when it holds a radio whose saved station
 * is not hidden and, for a local file, whose file was picked in this page.
 * An empty, hidden or re-pick File keeps its cables but has no lane.
 */
export function isRadioSourceLive(
  node: GraphNode | undefined
): node is RadioSourceNode & {
  data: { radio: StationRadio };
} {
  return (
    isRadioSourceNode(node) &&
    node.data.radio !== null &&
    node.data.radio.enabled !== false &&
    !isLocalFileGone(node.data.radio)
  );
}

/** An Audio input plays once it has a device; an empty one has no lane. */
export function isDeviceInLive(
  node: GraphNode
): node is DeviceInNode & { data: { deviceId: string } } {
  return node.type === "deviceIn" && node.data.deviceId !== null;
}

/**
 * A source that has a lane: a live Station, Track or File, or an Audio
 * input with a device.
 */
export function isSourceLive(node: GraphNode): boolean {
  return isRadioSourceLive(node) || isDeviceInLive(node);
}

/**
 * Whether any source with a lane is soloed: then every unsoloed lane's
 * exits are muted. A soloed empty slot has no lane, so it silences nothing.
 */
export function isSoloActive(nodes: readonly GraphNode[]): boolean {
  return nodes.some(
    (node) => isStripSource(node) && isSourceLive(node) && node.data.strip.solo
  );
}

/**
 * The radio an Audio input's channel carries: the device-input shape DJ
 * decks load (dj-library-sources.ts), so restore and the channel cache
 * know it for a live capture. Browsers give at most 2 channels a device.
 */
export function deviceInputRadio(
  nodeId: string,
  data: Pick<
    DeviceInNode["data"],
    "channelSelection" | "deviceLabel" | "capture" | "sourceUrl"
  > & {
    deviceId: string;
  }
): StationRadio {
  return {
    enabled: true,
    id: `device-input:${nodeId}`,
    name: data.deviceLabel || "Audio input",
    platformMetadata: {
      ...(data.capture
        ? { capture: data.capture, sourceUrl: data.sourceUrl }
        : {}),
      channelCount: 2,
      channelSelection: data.channelSelection,
      deviceId: data.deviceId,
      deviceLabel: data.deviceLabel,
      itemType: "track",
      platform: "device-input",
      url: "",
    },
    streamUrl: "",
  };
}

type LiveSource = {
  source: LaneSource;
  radio: StationRadio;
  volume: number;
  muted: boolean;
  strip: SourceStrip;
  transport: LaneTransport | null;
  cueListen: boolean;
};

function laneSourceOf(node: GraphNode): LiveSource | null {
  if (isRadioSourceLive(node)) {
    const { muted, radio, strip, volume } = node.data;
    const media = isMediaSourceType(node.type) && "speed" in strip;
    return {
      cueListen: media && strip.cueListen,
      muted,
      radio,
      source: { kind: "radio", radio },
      strip,
      transport: media
        ? { keyLock: strip.keyLock, loop: strip.loop, speed: strip.speed }
        : null,
      volume,
    };
  }
  if (isDeviceInLive(node)) {
    const {
      channelSelection,
      deviceId,
      echoCancellation,
      muted,
      strip,
      volume,
    } = node.data;
    return {
      cueListen: false,
      muted,
      radio: deviceInputRadio(node.id, node.data),
      source: {
        channelSelection,
        deviceId,
        echoCancellation,
        kind: "device",
        ...(node.data.capture ? { capture: node.data.capture } : {}),
      },
      strip,
      transport: null,
      volume,
    };
  }
  return null;
}

export { laneChannelId, laneSoundId } from "./identifiers";

/** Node types this compiler lowers; later layers add theirs. */
const COMPILED_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "station",
  "platform",
  "file",
  "deviceIn",
  "filter",
  "pan",
  "gain",
  "merge",
  "speakers",
  "deviceOut",
]);

function isCompiled(type: NodeType): boolean {
  return COMPILED_NODE_TYPES.has(type) || isEffectNodeType(type);
}

/**
 * Issues that leave the node in the plan: the playing budget is enforced
 * when a stream starts.
 */
const ADVISORY_CODES: ReadonlySet<IssueCode> = new Set<IssueCode>([
  "budget-playing",
]);

type CompileGraph = Pick<NodeGraph, "nodes" | "edges">;

/** A polynomial string hash, kept below 2^53 so it stays exact. */
function hash(text: string): string {
  const modulus = 2 ** 45;
  let value = 0;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 131 + text.charCodeAt(index)) % modulus;
  }
  return value.toString(36);
}

function layoutOf(effects: readonly EffectConfig[]): unknown[] {
  return effects.map((effect) => [
    effect.id,
    effect.type,
    effect.order,
    usesDirectEffectLayout(effect),
    effect.signalGain !== undefined,
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

/**
 * A keyed FX's own key id, apart from every sound id as a graph unit's
 * effects id is.
 */
function keyIdOf(fxId: string): string {
  return `node-key:${fxId}`;
}

/** Writes the key each keyed FX binds, by its own key id, into the tree. */
function keyEffects(
  effects: readonly EffectConfig[],
  keys: ReadonlyMap<string, string>
): EffectConfig[] {
  const visit = (current: readonly EffectConfig[]): EffectConfig[] =>
    current.map((effect) => {
      const channelId = keys.get(keyIdOf(effect.id));
      let next = effect;
      if (channelId !== undefined) {
        // A key overrides the runtime modulator, preserving the authored
        // choice so removing the cable restores it, including after undo.
        next = {
          ...effect,
          ...(effect.type === "vocoder" ? { modulatorSource: "external" } : {}),
          sidechain: { channelId },
        } as EffectConfig;
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
  regions: RegionLowerer;
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

function isSink(node: GraphNode): boolean {
  return getNodeDefinition(node.type).category === "output";
}

/** Nodes this compiler cannot lower yet, each with the reason. */
function refuse(graph: CompileGraph): Issue[] {
  return graph.nodes.flatMap((node): Issue[] =>
    isCompiled(node.type)
      ? []
      : [
          {
            code: "unshipped",
            id: node.id,
            message: `${getNodeDefinition(node.type).name} can't play in a patch yet`,
            target: "node",
          },
        ]
  );
}

/**
 * Splits whose branches part ways, which this compiler cannot lower yet,
 * and keys inside a Split whose branches meet again.
 */
function refuseRegions(regions: RegionLowerer): Issue[] {
  return [
    ...regions.openSplits().map(
      (id): Issue => ({
        code: "split-open",
        id,
        message: OPEN_SPLIT_MESSAGE,
        target: "node",
      })
    ),
    ...regions.keysInsideRegions().map(
      (id): Issue => ({
        code: "key-enclosed",
        id,
        message: ENCLOSED_KEY_MESSAGE,
        target: "edge",
      })
    ),
  ];
}

/**
 * Drops what failed validation, then refuses what this compiler cannot lower
 * yet (other sources, control, a Split whose branches part ways),
 * re-validating after every round until the patch is stable, so an issue a
 * drop uncovers is reported too. Each round drops at least one node or
 * cable, so this always settles. Advisory issues come from the final
 * round, the patch the plan is built from.
 */
function prepare(graph: CompileGraph, env: CompileEnv): Prepared {
  const excludedNodes = new Set<string>();
  const excludedEdges = new Set<string>();
  const issues: Issue[] = [];
  for (;;) {
    const kept = withoutExcluded(graph, excludedNodes, excludedEdges);
    const analysis = analyseGraph(kept, env);
    const byId = new Map(kept.nodes.map((node) => [node.id, node]));
    const advisory = analysis.issues.filter((issue) =>
      ADVISORY_CODES.has(issue.code)
    );
    let blocking = analysis.issues.filter(
      (issue) => !ADVISORY_CODES.has(issue.code)
    );
    if (blocking.length === 0) {
      blocking = refuse(kept);
    }
    // Lowered only once nothing is refused: with every Loop gone, the
    // patch it sees has no cycle.
    const regions =
      blocking.length === 0
        ? new RegionLowerer({
            byId,
            sinks: new Set(kept.nodes.filter(isSink).map((node) => node.id)),
            wired: analysis.wired,
          })
        : null;
    if (regions) {
      blocking = refuseRegions(regions);
    }
    if (regions && blocking.length === 0) {
      return {
        byId,
        graph: kept,
        issues: [...issues, ...advisory],
        regions,
        wired: analysis.wired,
      };
    }
    for (const issue of blocking) {
      issues.push(issue);
      (issue.target === "node" ? excludedNodes : excludedEdges).add(issue.id);
    }
  }
}

/**
 * official only when every enabled effect maps to openDAW, the page is
 * cross-origin isolated and the `added` channels the lane needs still fit
 * under the channel cap.
 */
function estimateBackend(
  effects: readonly EffectConfig[],
  env: CompileEnv,
  monitoringChannels: number,
  added: number
): LaneBackend | null {
  if (!hasEnabledEffects(effects)) {
    return null;
  }
  return env.crossOriginIsolated &&
    canUseOfficialOpenDawRuntime(effects) &&
    monitoringChannels + added <= MAX_MONITORING_CHANNELS
    ? "official"
    : "compat";
}

/** Where a key cable comes from and at what level. */
function heardFrom({ from, gain, muted }: CablePlan): string {
  return JSON.stringify([endpointKey(from), gain, muted]);
}

/** A key's cables in a fixed order: equal keys list equal cables alike. */
function byHeard(cables: readonly CablePlan[]): CablePlan[] {
  return [...cables].sort((left, right) =>
    heardFrom(left).localeCompare(heardFrom(right))
  );
}

function multiply(left: Trim, right: Trim): Trim {
  return { gain: left.gain * right.gain, muted: left.muted || right.muted };
}

/**
 * The order signal flows in between a plan's points, where a keyed chain
 * and the keys its FX bind count as one, as they arrive together. It
 * stays a strict order: two keys join only when neither reaches the other.
 */
class SignalOrder {
  private readonly cables: ReadonlyMap<string, CablePlan>;
  private readonly parent = new Map<string, string>();

  constructor({
    cables,
    lanes,
    units,
  }: Pick<PlanBuilder, "cables" | "lanes" | "units">) {
    this.cables = cables;
    for (const [kind, chains] of [
      ["lane", lanes],
      ["unit", units],
    ] as const) {
      for (const chain of chains.values()) {
        for (const node of chain.nodes) {
          this.union(
            endpointKey({ id: keyIdOf(node), kind: "key" }),
            endpointKey({ id: chain.id, kind })
          );
        }
      }
    }
  }

  canJoin(keyId: string, other: string): boolean {
    const mine = this.find(endpointKey({ id: keyId, kind: "key" }));
    const theirs = this.find(endpointKey({ id: other, kind: "key" }));
    return (
      mine === theirs ||
      !(this.reaches(mine, theirs) || this.reaches(theirs, mine))
    );
  }

  join(keyId: string, other: string): void {
    this.union(
      endpointKey({ id: keyId, kind: "key" }),
      endpointKey({ id: other, kind: "key" })
    );
  }

  private find(key: string): string {
    const parent = this.parent.get(key);
    if (parent === undefined || parent === key) {
      return key;
    }
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }

  private union(left: string, right: string): void {
    this.parent.set(this.find(left), this.find(right));
  }

  private reaches(from: string, to: string): boolean {
    const next = new Map<string, string[]>();
    for (const cable of this.cables.values()) {
      const source = this.find(endpointKey(cable.from));
      next.set(source, [
        ...(next.get(source) ?? []),
        this.find(endpointKey(cable.to)),
      ]);
    }
    const seen = new Set<string>();
    const queue = [...(next.get(from) ?? [])];
    for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
      if (key === to) {
        return true;
      }
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(...(next.get(key) ?? []));
      }
    }
    return false;
  }
}

/**
 * Builds the plan from the segments: each lane's, then each segment its
 * cables reach, once, as a cable first needs its far end.
 */
class PlanBuilder {
  readonly lanes = new Map<string, LanePlan>();
  readonly units = new Map<string, UnitPlan>();
  readonly modules = new Map<string, ModulePlan>();
  readonly cables = new Map<string, CablePlan>();
  private readonly endpoints = new Map<string, Endpoint>();
  private readonly prepared: Prepared;
  /** Lanes another source's solo silences. */
  private readonly soloMuted = new Set<string>();
  private readonly cableIds: FreshIds;

  constructor(prepared: Prepared) {
    this.prepared = prepared;
    this.cableIds = new FreshIds(
      new Set(prepared.graph.edges.map((edge) => edge.id))
    );
  }

  private get regions(): RegionLowerer {
    return this.prepared.regions;
  }

  /** A segment, or null when it can't lower: it then plays into nothing. */
  lower(head: string): Segment | null {
    try {
      return this.regions.lowerSegment(head);
    } catch (error) {
      if (!(error instanceof LoweringError)) {
        throw error;
      }
      this.prepared.issues.push({
        code: error.code,
        id: error.nodeId,
        message: error.message,
        target: "node",
      });
      return null;
    }
  }

  /** The lane's own segment, and everything its cables reach. */
  addLane(node: GraphNode, source: LiveSource, soloMuted: boolean): void {
    const segment = this.lower(node.id);
    const effects = segment?.effects ?? [];
    this.lanes.set(node.id, {
      backend: null,
      channelId: laneChannelId(node.id),
      cueListen: source.cueListen,
      effects,
      filter: segment?.filter ?? null,
      id: node.id,
      layoutSignature: layoutSignature(effects),
      muted: source.muted,
      nodes: segment?.nodes ?? [node.id],
      pan: clampPan((segment?.pan ?? 0) + source.strip.pan),
      radio: source.radio,
      soundId: laneSoundId(node.id),
      source: source.source,
      transport: source.transport,
      volume: source.volume,
    });
    // Trim and solo act on the cables, downstream of the fader, so the
    // volume controller keeps the fader.
    if (soloMuted) {
      this.soloMuted.add(node.id);
    }
    this.emit(
      segment?.exits ?? [],
      { id: node.id, kind: "lane" },
      { gain: dbToGain(source.strip.trimDb), muted: false }
    );
  }

  /** Cables from `from` for each exit, through whatever has no FX. */
  private emit(
    exits: readonly SegmentExit[],
    from: Endpoint,
    carry: Trim
  ): void {
    for (const exit of exits) {
      const trim = multiply(carry, exit.trim);
      if (exit.key) {
        // A key for each keyed FX; keys that hear the same cables merge.
        const key: Endpoint = { id: keyIdOf(exit.target), kind: "key" };
        this.connect(exit.ids, from, key, trim, "key");
        continue;
      }
      if (this.regions.isCutBefore(exit.target)) {
        this.connect(exit.ids, from, this.endpointOf(exit.target), trim);
        continue;
      }
      // Past a fan-out: a branch with FX is a unit of its own; one
      // without folds into the cables out of it.
      const segment = this.lower(exit.target);
      if (!segment) {
        continue;
      }
      if (segment.effects.length > 0) {
        const unit = this.addUnit(exit.target, segment);
        this.connect(exit.ids, from, unit, trim);
        this.emit(segment.exits, unit, UNITY);
      } else {
        this.emit(segment.exits, from, trim);
      }
    }
  }

  private connect(
    ids: readonly string[],
    from: Endpoint,
    to: Endpoint,
    { gain, muted }: Trim,
    kind: CablePlan["kind"] = "audio"
  ): void {
    const id =
      ids.length === 1 && ids[0] !== undefined
        ? this.cableIds.claim(ids[0])
        : this.cableIds.fresh(ids.join("+"));
    const soloed =
      kind === "audio" && from.kind === "lane" && this.soloMuted.has(from.id);
    this.cables.set(id, {
      delay: 0,
      edges: [...ids],
      from,
      gain,
      id,
      kind,
      muted: muted || soloed,
      reenters: false,
      to,
    });
  }

  private addModule(module: ModulePlan): void {
    this.modules.set(endpointKey(module), module);
  }

  private addUnit(id: string, segment: Segment): Endpoint {
    const { effects } = segment;
    this.units.set(id, {
      backend: null,
      effects,
      id,
      layoutSignature: layoutSignature(effects),
      nodes: segment.nodes,
      realtime: false,
    });
    return { id, kind: "unit" };
  }

  /** The point a cable into `id` ends at, built the first time. */
  private endpointOf(id: string): Endpoint {
    const known = this.endpoints.get(id);
    if (known) {
      return known;
    }
    const node = this.regions.node(id);
    if (isSink(node)) {
      const sink: Endpoint = { id, kind: "sink" };
      this.endpoints.set(id, sink);
      return sink;
    }
    if (node.type === "filter" || node.type === "pan") {
      const module: Endpoint = { id, kind: node.type };
      this.endpoints.set(id, module);
      this.addModule(
        node.type === "filter"
          ? {
              filter: {
                frequency: node.data.frequency,
                Q: node.data.Q,
                type: node.data.type,
              },
              id,
              kind: "filter",
              realtime: false,
            }
          : { id, kind: "pan", pan: node.data.pan, realtime: false }
      );
      this.emit(this.regions.exitsOf(id), module, UNITY);
      return module;
    }
    // A sum: its own segment, as a unit when that has FX.
    const segment = this.lower(id);
    const sum: Endpoint =
      segment && segment.effects.length > 0
        ? this.addUnit(id, segment)
        : { id, kind: "sum" };
    this.endpoints.set(id, sum);
    if (sum.kind === "sum") {
      this.addModule({ id, kind: "sum", realtime: false });
    }
    this.emit(segment?.exits ?? [], sum, UNITY);
    return sum;
  }

  /**
   * Gives each keyed FX its key: a key module summing its key cables, bound
   * only while one of them is audible, and shared by FX whose key cables
   * come from the same places at the same levels. An FX left with no key
   * detects on its own input, and a Vocoder takes its authored modulator.
   */
  bindKeys(): void {
    const into = new Map<string, CablePlan[]>();
    for (const cable of this.cables.values()) {
      if (cable.kind === "key") {
        into.set(cable.to.id, [...(into.get(cable.to.id) ?? []), cable]);
      }
    }
    const order = new SignalOrder(this);
    /** Each shared key's cables, by what they hear. */
    const shared = new Map<string, CablePlan[][]>();
    const keyOf = new Map<string, string>();
    for (const [keyId, cables] of into) {
      const audible = cables.some((cable) => !cable.muted && cable.gain > 0);
      const mine = byHeard(cables);
      const heard = mine.map(heardFrom).join();
      const groups = shared.get(heard) ?? [];
      // A key and its FX's audio arrive together, so FX one of which
      // feeds the other can't share one.
      const kept = groups.find((group) =>
        order.canJoin(keyId, group[0]?.to.id ?? keyId)
      );
      const owner = audible ? (kept?.[0]?.to.id ?? keyId) : null;
      if (owner === keyId) {
        shared.set(heard, [...groups, mine]);
        this.addModule({ id: keyId, kind: "key", realtime: false });
      } else {
        this.mergeKey(mine, owner ? (kept ?? []) : []);
      }
      if (owner !== null) {
        order.join(keyId, owner);
        keyOf.set(keyId, owner);
      }
    }
    for (const chain of [...this.lanes.values(), ...this.units.values()]) {
      chain.effects = keyEffects(chain.effects, keyOf);
      chain.layoutSignature = layoutSignature(chain.effects);
    }
  }

  /**
   * Drops a key's cables; the shared key's equal cables, if any, stand for
   * them too, each carrying both cables' patch cables.
   */
  private mergeKey(cables: readonly CablePlan[], into: readonly CablePlan[]) {
    for (const cable of cables) {
      this.cables.delete(cable.id);
    }
    for (const [index, cable] of into.entries()) {
      cable.edges.push(...(cables[index]?.edges ?? []));
    }
  }

  /**
   * A unit or module skips the main delay, as a live input's lane does,
   * when every source reaching it is a live input.
   */
  markRealtime(): void {
    const into = new Map<string, Endpoint[]>();
    for (const cable of this.cables.values()) {
      const key = endpointKey(cable.to);
      into.set(key, [...(into.get(key) ?? []), cable.from]);
    }
    const known = new Map<string, boolean>();
    const realtime = (endpoint: Endpoint): boolean => {
      const key = endpointKey(endpoint);
      const cached = known.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const result =
        endpoint.kind === "lane"
          ? this.lanes.get(endpoint.id)?.source.kind === "device"
          : (into.get(key) ?? []).every(realtime) && into.has(key);
      known.set(key, result);
      return result;
    };
    for (const unit of this.units.values()) {
      unit.realtime = realtime({ id: unit.id, kind: "unit" });
    }
    for (const module of this.modules.values()) {
      module.realtime = realtime(module);
    }
  }
}

/**
 * Delays cables so every cable into a point arrives in step. A signal that
 * came out of openDAW and goes back into it is read a render quantum late,
 * as Web Audio marks the one worklet processed before it pulls its inputs:
 * that lateness is the loop's own, so the cable adds none, and the faster
 * cables into the same point wait the difference on a DelayNode, and a
 * keyed effect's audio and its key arrive together: whichever is later, the
 * other waits. A source's own insert takes its audio first hand, so a later
 * key there can't be waited for. This aligns rejoining branches when
 * Chromium renders the faster sibling first; when it renders the loop first,
 * that sibling lands one quantum late. Web Audio leaves that order to the
 * browser, so same-source paths that rejoin across a re-entry can be off by
 * one quantum. Backends are the compile estimate.
 */
function alignCables(
  plan: Pick<EnginePlan, "cables" | "lanes" | "units">
): void {
  const into = new Map<string, CablePlan[]>();
  for (const cable of plan.cables.values()) {
    const key = endpointKey(cable.to);
    into.set(key, [...(into.get(key) ?? []), cable]);
  }
  const official = ({ id, kind }: Endpoint) =>
    (kind === "lane" ? plan.lanes.get(id) : plan.units.get(id))?.backend ===
    "official";
  const together = keyedTogether(plan);
  /** A key goes into openDAW when an effect there listens to it. */
  const intoOpenDaw = (to: Endpoint) =>
    to.kind === "key"
      ? (together.get(endpointKey(to)) ?? []).some(official)
      : to.kind === "unit" && official(to);
  // A keyed chain and its keys arrive together: one arrival for them all.
  const groupOf = new Map<string, string[]>();
  for (const [key, others] of together) {
    const group = [
      ...new Set([
        ...(groupOf.get(key) ?? [key]),
        ...others.flatMap((other) => {
          const otherKey = endpointKey(other);
          return groupOf.get(otherKey) ?? [otherKey];
        }),
      ]),
    ];
    for (const member of group) {
      groupOf.set(member, group);
    }
  }
  const processed = new Map<string, boolean>();
  const arrivals = new Map<string, number>();
  /** Whether audio out of `from` has been through openDAW. */
  const isProcessed = (from: Endpoint): boolean => {
    const key = endpointKey(from);
    const known = processed.get(key);
    if (known !== undefined) {
      return known;
    }
    // Settled before its inputs, so a cycle, which validation refuses,
    // ends here.
    processed.set(key, false);
    const result =
      official(from) ||
      (from.kind !== "lane" &&
        (into.get(key) ?? []).some((cable) => isProcessed(cable.from)));
    processed.set(key, result);
    return result;
  };
  /** Render quanta after the sources that audio out of `from` is. */
  const quantaOf = (from: Endpoint): number =>
    from.kind === "lane" ? 0 : arrivalOf(endpointKey(from));
  /** When every cable into a point, and into its group, arrives. */
  const arrivalOf = (key: string): number => {
    const known = arrivals.get(key);
    if (known !== undefined) {
      return known;
    }
    const group = groupOf.get(key) ?? [key];
    // As above: a cycle ends here rather than recursing.
    for (const member of group) {
      arrivals.set(member, 0);
    }
    const quanta = Math.max(
      0,
      ...group.flatMap((member) =>
        (into.get(member) ?? []).map(
          (cable) =>
            quantaOf(cable.from) +
            (intoOpenDaw(cable.to) && isProcessed(cable.from) ? 1 : 0)
        )
      )
    );
    for (const member of group) {
      arrivals.set(member, quanta);
    }
    return quanta;
  };
  for (const cable of plan.cables.values()) {
    cable.reenters = intoOpenDaw(cable.to) && isProcessed(cable.from);
    cable.delay =
      arrivalOf(endpointKey(cable.to)) -
      quantaOf(cable.from) -
      (cable.reenters ? 1 : 0);
  }
}

/** Each keyed chain with the keys it listens to, both ways round. */
function keyedTogether(
  plan: Pick<EnginePlan, "lanes" | "units">
): Map<string, Endpoint[]> {
  const together = new Map<string, Endpoint[]>();
  const pair = (from: Endpoint, to: Endpoint) => {
    const key = endpointKey(from);
    together.set(key, [...(together.get(key) ?? []), to]);
  };
  for (const [kind, chains] of [
    ["lane", plan.lanes],
    ["unit", plan.units],
  ] as const) {
    for (const chain of chains.values()) {
      for (const id of audibleSidechainIds(chain.effects)) {
        pair({ id: chain.id, kind }, { id, kind: "key" });
        pair({ id, kind: "key" }, { id: chain.id, kind });
      }
    }
  }
  return together;
}

/** Compiles a patch into the plan the node engine reconciles against. */
export function compile(graph: CompileGraph, env: CompileEnv): EnginePlan {
  const prepared = prepare(graph, env);
  const sinks = new Map<string, SinkPlan>();
  for (const node of prepared.graph.nodes) {
    if (node.type === "deviceOut") {
      const { deviceId, muted } = node.data;
      sinks.set(node.id, { deviceId, id: node.id, muted, type: node.type });
    } else if (isSink(node)) {
      sinks.set(node.id, { id: node.id, type: node.type });
    }
  }
  const builder = new PlanBuilder(prepared);
  // An empty Station is a search slot, a hidden one is disabled, and an
  // Audio input with no device has nothing to capture: no lane, but their
  // cables survive. Only a source with a lane can solo.
  const anySolo = isSoloActive(prepared.graph.nodes);
  for (const node of prepared.graph.nodes) {
    const source = laneSourceOf(node);
    if (source) {
      builder.addLane(node, source, anySolo && !source.strip.solo);
    }
  }
  builder.bindKeys();
  builder.markRealtime();

  // Channel users in patch order: lane inserts, then units. Each takes its
  // own input and each key its effects listen to, a key once for all.
  let monitoringChannels = 0;
  const monitored = new Set<string>();
  const order = new Map(
    prepared.graph.nodes.map((node, index) => [node.id, index])
  );
  const users = [
    ...[...builder.lanes.values()].map((lane) => ({
      channel: lane.channelId,
      plan: lane as { effects: EffectConfig[]; backend: LaneBackend | null },
    })),
    ...[...builder.units.values()]
      .sort(
        (left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0)
      )
      .map((unit) => ({ channel: `unit:${unit.id}`, plan: unit })),
  ];
  for (const { channel, plan } of users) {
    const inputs = new Set(
      [channel, ...audibleSidechainIds(plan.effects)].filter(
        (id) => !monitored.has(id)
      )
    );
    const added = inputs.size * LANE_CHANNELS;
    plan.backend = estimateBackend(
      plan.effects,
      env,
      monitoringChannels,
      added
    );
    if (plan.backend === "official") {
      monitoringChannels += added;
      for (const id of inputs) {
        monitored.add(id);
      }
    }
  }

  alignCables(builder);
  return {
    cables: builder.cables,
    issues: prepared.issues,
    lanes: builder.lanes,
    modules: builder.modules,
    monitoringChannels,
    sinks,
    units: builder.units,
  };
}

/** The outputs each lane reaches, through any units and modules. */
export function laneRoutes(plan: EnginePlan): Map<string, Set<string>> {
  const out = new Map<string, Endpoint[]>();
  for (const cable of plan.cables.values()) {
    const key = endpointKey(cable.from);
    out.set(key, [...(out.get(key) ?? []), cable.to]);
  }
  const routes = new Map<string, Set<string>>();
  for (const laneId of plan.lanes.keys()) {
    const reached = new Set<string>();
    const seen = new Set<string>();
    const queue: Endpoint[] = [{ id: laneId, kind: "lane" }];
    for (let at = queue.pop(); at; at = queue.pop()) {
      const key = endpointKey(at);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (at.kind === "sink") {
        reached.add(at.id);
      }
      queue.push(...(out.get(key) ?? []));
    }
    routes.set(laneId, reached);
  }
  return routes;
}

/**
 * What the compiler made of each Merge: `closes` when it joins a split's
 * branches inside one chain, `sum` when it mixes cables from different
 * places into one signal. A Merge fed by nothing has no role.
 */
export type MergeRole = "closes" | "sum";

export function mergeRoles(
  graph: Pick<NodeGraph, "nodes" | "edges">,
  plan: EnginePlan
): Map<string, MergeRole> {
  const inChains = new Set(
    [...plan.lanes.values(), ...plan.units.values()].flatMap(
      (chain) => chain.nodes
    )
  );
  const inputs = new Map<string, number>();
  for (const cable of plan.cables.values()) {
    if (cable.to.kind === "sum" || cable.to.kind === "unit") {
      inputs.set(cable.to.id, (inputs.get(cable.to.id) ?? 0) + 1);
    }
  }
  const roles = new Map<string, MergeRole>();
  for (const node of graph.nodes) {
    if (node.type !== "merge") {
      continue;
    }
    const point =
      plan.modules.has(endpointKey({ id: node.id, kind: "sum" })) ||
      plan.units.has(node.id);
    if (point && (inputs.get(node.id) ?? 0) > 1) {
      roles.set(node.id, "sum");
    } else if (point || inChains.has(node.id)) {
      roles.set(node.id, "closes");
    }
  }
  return roles;
}

function effectsById(
  effects: readonly EffectConfig[],
  into = new Map<string, EffectConfig>()
): Map<string, EffectConfig> {
  for (const effect of effects) {
    into.set(effect.id, effect);
    if (isEffectContainer(effect)) {
      for (const chain of effect.chains) {
        effectsById(chain.effects, into);
      }
    }
  }
  return into;
}

const EMPTY_SOURCE_REASONS = {
  file: "The File is empty",
  platform: "The Track is empty",
  station: "The station slot is empty",
} as const;

/** Why a source has no lane to key from, or null when it has one. */
function silentSource(node: GraphNode | undefined): string | null {
  if (node?.type === "deviceIn" && !isDeviceInLive(node)) {
    return "Pick the input's device first";
  }
  if (!isRadioSourceNode(node) || isRadioSourceLive(node)) {
    return null;
  }
  if (!node.data.radio) {
    return EMPTY_SOURCE_REASONS[node.type];
  }
  return isLocalFileGone(node.data.radio)
    ? "Pick the file again"
    : "The station is hidden";
}

/** Every lane's and unit's effects by id, and the ones that hear audio. */
function chainEffects(plan: EnginePlan) {
  const byId = new Map<string, EffectConfig>();
  const active = new Set<EffectConfig>();
  for (const chain of [...plan.lanes.values(), ...plan.units.values()]) {
    effectsById(chain.effects, byId);
    for (const effect of audibleEffects(chain.effects)) {
      active.add(effect);
    }
  }
  return { active, byId };
}

/**
 * Why each key cable that keys nothing is idle, by cable id, as the canvas
 * says it: the issue that refused it, a mute, an empty or hidden source, an
 * effect switched off, or a second key the compatibility engine can't
 * bind. A key that reaches its effect's sidechain is left out. `badges` are
 * the live backend badges by FX node id, as node playback publishes them:
 * a chain the runtime moved to compatibility shows it too.
 */
export function idleKeys(
  graph: Pick<NodeGraph, "nodes" | "edges">,
  plan: EnginePlan,
  badges: Readonly<Record<string, string>> = {}
): Map<string, string> {
  const { active, byId: inChain } = chainEffects(plan);
  // The compatibility engine keys a chain from one key: its first.
  const compatOnly = new Set<EffectConfig>();
  for (const chain of [...plan.lanes.values(), ...plan.units.values()]) {
    const audible = audibleEffects(chain.effects);
    if (
      chain.backend === "compat" ||
      audible.some((effect) => badges[effect.id] === "compat")
    ) {
      const [key] = audibleSidechainIds(chain.effects);
      for (const effect of audible) {
        if (effect.sidechain && effect.sidechain.channelId !== key) {
          compatOnly.add(effect);
        }
      }
    }
  }
  const issues = new Map(
    plan.issues.map((issue) => [`${issue.target}:${issue.id}`, issue.message])
  );
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const idle = new Map<string, string>();
  // A shared key's cable stands for every equal key cable it took over.
  const bound = new Set(
    [...plan.cables.values()].flatMap((cable) =>
      cable.kind === "key" ? cable.edges : []
    )
  );
  const reasonFor = (edge: GraphEdge): string | null => {
    if (edge.muted || edge.gain === 0) {
      return "This key is muted";
    }
    const effect = inChain.get(edge.target);
    if (!(bound.has(edge.id) && effect?.sidechain)) {
      return (
        issues.get(`node:${edge.target}`) ??
        silentSource(byId.get(edge.source)) ??
        issues.get(`node:${edge.source}`) ??
        "This key isn't used"
      );
    }
    if (!effect.enabled) {
      return "Switch the effect on to use its key";
    }
    if (!active.has(effect)) {
      // The runtime binds no key under an off Split or a silent branch.
      return "Its branch is off, so the key isn't used";
    }
    return compatOnly.has(effect) ? "This key needs the openDAW engine" : null;
  };
  for (const edge of graph.edges) {
    if (parseHandleId(edge.targetHandle)?.kind !== "sidechain") {
      continue;
    }
    const reason = issues.get(`edge:${edge.id}`) ?? reasonFor(edge);
    if (reason) {
      idle.set(edge.id, reason);
    }
  }
  return idle;
}
