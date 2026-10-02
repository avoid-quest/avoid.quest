/**
 * Node Graph Schema
 *
 * The versioned document Node mode persists: nodes, cables and the viewport.
 * `migrateNodeGraph` is the only way in from storage, backups or share links,
 * so an unknown future version is surfaced read-only instead of overwritten.
 *
 * v2 gave every source a channel strip (`data.strip`): trim, pan and solo,
 * plus speed, key lock, loop and cue on a Track or File, and Monitor on an
 * Audio input. v1 documents upgrade to it with default strips.
 */

import { z } from "zod";
import { nodeEffectConfigSchema } from "@/lib/audio/dsp/effects/effect-config-schema";
import { EFFECT_TYPES, type EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  findEffectInTree,
  isEffectContainer,
} from "@/lib/audio/dsp/routing/effect-tree";
import type { MidiTransform } from "@/lib/midi/types";

export const NODE_GRAPH_VERSION = 2;

/**
 * The loudest a cable may be, matching the Branch gain slider in container
 * params, so an imported or shared patch cannot blast the speakers.
 */
export const MAX_EDGE_GAIN = 4;

export const SOURCE_NODE_TYPES = [
  "station",
  "file",
  "deviceIn",
  "platform",
  "static",
] as const;

/**
 * The Source family that plays a `Radio`: a live Station, a platform Track
 * ("platform") and a File. They share their data, their frame and their
 * lane; the radio's kind decides which one holds it (`sources.ts`).
 */
export const RADIO_SOURCE_NODE_TYPES = ["station", "platform", "file"] as const;

export type RadioSourceNodeType = (typeof RADIO_SOURCE_NODE_TYPES)[number];

/** The platforms a Track's search can lock to; unset searches them all. */
export const TRACK_SEARCH_PLATFORMS = [
  "youtube",
  "soundcloud",
  "bandcamp",
  "mixcloud",
] as const;

export type TrackSearchPlatform = (typeof TRACK_SEARCH_PLATFORMS)[number];

export const NATIVE_NODE_TYPES = ["filter", "pan", "gain"] as const;

/** FX nodes reuse the effect type ids, containers (Split…) included. */
export const EFFECT_NODE_TYPES = EFFECT_TYPES;

export const ROUTING_NODE_TYPES = [
  "merge",
  "crossfade",
  "send",
  "return",
  "muteSolo",
  "dial",
  "loop",
  "tapeWarp",
] as const;

export const CONTROL_NODE_TYPES = [
  "macro",
  "lfo",
  "clock",
  "randomiser",
  "follower",
  "titleTrigger",
  "sundial",
  "midiIn",
] as const;

export const OUTPUT_NODE_TYPES = [
  "speakers",
  "scope",
  "headphones",
  "deviceOut",
  "recorder",
] as const;

export const NODE_TYPES = [
  ...SOURCE_NODE_TYPES,
  ...NATIVE_NODE_TYPES,
  ...EFFECT_NODE_TYPES,
  ...ROUTING_NODE_TYPES,
  ...CONTROL_NODE_TYPES,
  ...OUTPUT_NODE_TYPES,
] as const;

export type NodeType = (typeof NODE_TYPES)[number];
export type EffectNodeType = (typeof EFFECT_NODE_TYPES)[number];

/** Node types whose data is typed today; the rest stay loose until they ship. */
const TYPED_NODE_TYPES = [
  ...RADIO_SOURCE_NODE_TYPES,
  "deviceIn",
  "speakers",
  "deviceOut",
  ...NATIVE_NODE_TYPES,
  ...EFFECT_NODE_TYPES,
  "merge",
  "loop",
  "tapeWarp",
] as const satisfies readonly NodeType[];

const LOOSE_NODE_TYPES = NODE_TYPES.filter(
  (type): type is Exclude<NodeType, (typeof TYPED_NODE_TYPES)[number]> =>
    !(TYPED_NODE_TYPES as readonly string[]).includes(type)
) as [
  Exclude<NodeType, (typeof TYPED_NODE_TYPES)[number]>,
  ...Exclude<NodeType, (typeof TYPED_NODE_TYPES)[number]>[],
];

const unitSchema = z.number().min(0).max(1);

/**
 * A radio snapshot, so a patch still opens when the saved station is gone.
 * Extra radio fields (logo, metadata config…) pass through untouched.
 */
const stationRadioSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).optional(),
  name: z.string(),
  streamUrl: z.string(),
});

const positionSchema = z.object({ x: z.number(), y: z.number() });

const nodeBase = {
  id: z.string().min(1),
  pinned: z.boolean().optional(),
  position: positionSchema,
};

/** A strip's trim, in dB, before the lane's cables. */
export const STRIP_TRIM_DB = { max: 12, min: -24 } as const;

/** Playback rate the engine takes (audio-manager `setPlaybackRate`). */
export const STRIP_SPEED = { max: 2, min: 0.5 } as const;

/**
 * What every source's channel strip holds. The fader and mute stay the
 * source's own `volume` and `muted`; trim, pan and solo act on the lane.
 */
const stripCommon = {
  /** Added to a Pan node's pan on the lane, clamped. */
  pan: z.number().min(-1).max(1).default(0),
  /** Any soloed source silences the lanes of every unsoloed one. */
  solo: z.boolean().default(false),
  trimDb: z.number().min(STRIP_TRIM_DB.min).max(STRIP_TRIM_DB.max).default(0),
};

/** A Station's strip: live radio has no transport to set. */
const stationStripSchema = z.object(stripCommon);

/** A Track's or File's strip: seekable media adds its transport. */
const mediaStripSchema = z.object({
  ...stripCommon,
  /** Seconds into the track Cue jumps to, once set. */
  cue: z.number().min(0).nullable().default(null),
  /** Plays the lane pre-fader on the headphone cue output. */
  cueListen: z.boolean().default(false),
  /** Keeps the pitch while the speed changes (`preservesPitch`). */
  keyLock: z.boolean().default(true),
  /** Repeats the whole track at its end instead of moving on. */
  loop: z.boolean().default(false),
  speed: z.number().min(STRIP_SPEED.min).max(STRIP_SPEED.max).default(1),
});

/** An Audio input's strip. */
const inputStripSchema = z.object({
  ...stripCommon,
  /**
   * Go live, as last set. Never restored: a mic opens only from a gesture,
   * so a loaded patch starts with it off.
   */
  monitor: z.boolean().default(false),
});

export type StationStrip = z.infer<typeof stationStripSchema>;
export type MediaStrip = z.infer<typeof mediaStripSchema>;
export type InputStrip = z.infer<typeof inputStripSchema>;
export type SourceStrip = StationStrip | MediaStrip | InputStrip;

export const DEFAULT_STATION_STRIP: StationStrip = {
  pan: 0,
  solo: false,
  trimDb: 0,
};

export const DEFAULT_MEDIA_STRIP: MediaStrip = {
  ...DEFAULT_STATION_STRIP,
  cue: null,
  cueListen: false,
  keyLock: true,
  loop: false,
  speed: 1,
};

export const DEFAULT_INPUT_STRIP: InputStrip = {
  ...DEFAULT_STATION_STRIP,
  monitor: false,
};

/** What every radio source holds: its radio snapshot, fader and mute. */
const radioSourceData = {
  muted: z.boolean().default(false),
  /** `null` is the empty slot, whose body is its search or file form. */
  radio: stationRadioSchema.nullable().default(null),
  volume: unitSchema.default(1),
};

const stationNodeSchema = z.object({
  ...nodeBase,
  data: z.object({
    ...radioSourceData,
    strip: stationStripSchema.default(() => ({ ...DEFAULT_STATION_STRIP })),
  }),
  type: z.literal("station"),
});

const mediaStrip = mediaStripSchema.default(() => ({
  ...DEFAULT_MEDIA_STRIP,
}));

const platformNodeSchema = z.object({
  ...nodeBase,
  data: z
    .object({
      ...radioSourceData,
      /** The platform chip an empty Track's search is locked to. */
      searchPlatform: z.enum(TRACK_SEARCH_PLATFORMS).optional(),
      strip: mediaStrip,
    })
    .default(() => ({
      muted: false,
      radio: null,
      strip: { ...DEFAULT_MEDIA_STRIP },
      volume: 1,
    })),
  type: z.literal("platform"),
});

const fileNodeSchema = z.object({
  ...nodeBase,
  data: z.object({ ...radioSourceData, strip: mediaStrip }).default(() => ({
    muted: false,
    radio: null,
    strip: { ...DEFAULT_MEDIA_STRIP },
    volume: 1,
  })),
  type: z.literal("file"),
});

/** A device's 0-based input channels feeding left and right. */
const channelSelectionSchema = z.object({
  left: z.number().int().min(0),
  right: z.number().int().min(0),
});

const deviceInNodeSchema = z.object({
  ...nodeBase,
  data: z
    .object({
      capture: z.literal("display").optional(),
      channelSelection: channelSelectionSchema.default({ left: 0, right: 1 }),
      /** `null` until a device is picked; an empty input has no lane. */
      deviceId: z.string().nullable().default(null),
      /** The label when picked, so the node still reads when unplugged. */
      deviceLabel: z.string().default(""),
      /** Off by default, like DJ's inputs; on is the feedback guard. */
      echoCancellation: z.boolean().default(false),
      muted: z.boolean().default(false),
      sourceUrl: z.string().optional(),
      strip: inputStripSchema.default(() => ({ ...DEFAULT_INPUT_STRIP })),
      volume: unitSchema.default(1),
    })
    .default(() => ({
      channelSelection: { left: 0, right: 1 },
      deviceId: null,
      deviceLabel: "",
      echoCancellation: false,
      muted: false,
      strip: { ...DEFAULT_INPUT_STRIP },
      volume: 1,
    })),
  type: z.literal("deviceIn"),
});

const deviceOutNodeSchema = z.object({
  ...nodeBase,
  data: z
    .object({
      /** `null` until a device is picked; its cables stay silent till then. */
      deviceId: z.string().nullable().default(null),
      deviceLabel: z.string().default(""),
      muted: z.boolean().default(false),
    })
    .default({ deviceId: null, deviceLabel: "", muted: false }),
  type: z.literal("deviceOut"),
});

const speakersNodeSchema = z.object({
  ...nodeBase,
  // Master volume stays the session's masterVolume.
  data: z.object({ muted: z.boolean().default(false) }).default({
    muted: false,
  }),
  type: z.literal("speakers"),
});

/**
 * A number pulled into `[min, max]` rather than refused. `z.number()`
 * still refuses NaN and the infinities, which have no place to clamp to.
 */
function clampedNumber(min: number, max: number) {
  return z.number().transform((value) => Math.min(max, Math.max(min, value)));
}

const filterNodeSchema = z.object({
  ...nodeBase,
  // An imported or shared patch can't scream: Q is resonance in dB here.
  // Clamped to what the old Filter allowed (Q up to 30), so a migrated
  // patch still opens rather than going invalid.
  data: z.object({
    frequency: clampedNumber(20, 20_000).default(1000),
    Q: clampedNumber(0.1, 30).default(1),
    type: z.enum(["lowpass", "highpass"]).default("lowpass"),
  }),
  type: z.literal("filter"),
});

const panNodeSchema = z.object({
  ...nodeBase,
  data: z.object({ pan: z.number().min(-1).max(1).default(0) }),
  type: z.literal("pan"),
});

const gainNodeSchema = z.object({
  ...nodeBase,
  data: z.object({ gainDb: z.number().max(24).default(0) }),
  type: z.literal("gain"),
});

const effectNodeSchema = z
  .object({
    ...nodeBase,
    data: z.object({ effect: nodeEffectConfigSchema }),
    type: z.enum(EFFECT_NODE_TYPES),
  })
  .refine((node) => node.data.effect.type === node.type, {
    message: "Effect type must match the node type",
    path: ["data", "effect", "type"],
  })
  // The effect takes the node's id below, after its own check for ids used
  // twice, so an effect inside it must not have that id already.
  .refine(
    ({ data: { effect }, id }) =>
      !(
        isEffectContainer(effect) &&
        effect.chains.some((chain) => findEffectInTree(chain.effects, id))
      ),
    {
      message: "An effect inside this node has the node's id",
      path: ["data", "effect", "chains"],
    }
  )
  .transform((node) => ({
    ...node,
    // The node id is the EffectConfig id, so openDAW can update in place.
    data: { effect: { ...node.data.effect, id: node.id } as EffectConfig },
  }));

const mergeNodeSchema = z.object({
  ...nodeBase,
  // Per-input gain and mute ride on the cables.
  data: z.object({}).default({}),
  type: z.literal("merge"),
});

const loopNodeSchema = z.object({
  ...nodeBase,
  data: z.object({
    feedback: z.number().min(0).max(0.95).default(0.5),
    /**
     * Seconds. Web Audio stretches a delay inside a cycle to one 128-frame
     * render quantum, so the compiler clamps to 128 / sampleRate as well.
     */
    time: z.number().min(0.003).max(2).default(0.25),
    tone: unitSchema.default(0.5),
  }),
  type: z.literal("loop"),
});

const tapeWarpNodeSchema = z.object({
  ...nodeBase,
  data: z.object({
    feedback: unitSchema.default(0.5),
    /** Seconds. */
    time: z.number().min(0).max(30).default(4),
  }),
  type: z.literal("tapeWarp"),
});

const looseNodeSchema = z.object({
  ...nodeBase,
  data: z.record(z.string(), z.unknown()).default({}),
  type: z.enum(LOOSE_NODE_TYPES),
});

export const graphNodeSchema = z.discriminatedUnion("type", [
  stationNodeSchema,
  platformNodeSchema,
  fileNodeSchema,
  deviceInNodeSchema,
  speakersNodeSchema,
  deviceOutNodeSchema,
  filterNodeSchema,
  panNodeSchema,
  gainNodeSchema,
  effectNodeSchema,
  mergeNodeSchema,
  loopNodeSchema,
  tapeWarpNodeSchema,
  looseNodeSchema,
]);

export const midiTransformSchema = z.object({
  curve: z.enum(["linear", "log", "exp"]),
  invert: z.boolean(),
  max: z.number(),
  min: z.number(),
}) satisfies z.ZodType<MidiTransform>;

export const graphEdgeSchema = z.object({
  /** User cable colour override. */
  color: z.string().optional(),
  /** Modulation depth on control cables. */
  depth: z.number().optional(),
  /** Linear, capped like a container branch gain (+12 dB). */
  gain: z.number().min(0).max(MAX_EDGE_GAIN).default(1),
  id: z.string().min(1),
  muted: z.boolean().default(false),
  /** A branch cable's pan, added to its chain's (Split, Stereo or Band Split). */
  pan: z.number().min(-1).max(1).optional(),
  /** A branch cable's solo: its chain plays and unsoloed siblings go quiet. */
  solo: z.boolean().optional(),
  source: z.string().min(1),
  sourceHandle: z.string().min(1),
  target: z.string().min(1),
  targetHandle: z.string().min(1),
  /** Macro and MIDI cables. */
  transform: midiTransformSchema.partial().optional(),
});

export const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
});

export const nodeGraphSchema = z
  .object({
    edges: z.array(graphEdgeSchema),
    nodes: z.array(graphNodeSchema),
    version: z.literal(NODE_GRAPH_VERSION),
    viewport: viewportSchema.default({ x: 0, y: 0, zoom: 1 }),
  })
  .superRefine((graph, context) => {
    if (graph.nodes.filter((node) => node.type === "speakers").length !== 1) {
      context.addIssue({
        code: "custom",
        message: "A patch must have exactly one Speakers",
        path: ["nodes"],
      });
    }
    const nodeIds = new Set<string>();
    for (const [index, node] of graph.nodes.entries()) {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate node id "${node.id}"`,
          path: ["nodes", index, "id"],
        });
      }
      nodeIds.add(node.id);
    }
    const edgeIds = new Set<string>();
    for (const [index, edge] of graph.edges.entries()) {
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate edge id "${edge.id}"`,
          path: ["edges", index, "id"],
        });
      }
      edgeIds.add(edge.id);
      for (const end of ["source", "target"] as const) {
        if (!nodeIds.has(edge[end])) {
          context.addIssue({
            code: "custom",
            message: `Edge "${edge.id}" points at missing node "${edge[end]}"`,
            path: ["edges", index, end],
          });
        }
      }
    }
  });

export type NodeGraph = z.infer<typeof nodeGraphSchema>;
export type NodeGraphInput = z.input<typeof nodeGraphSchema>;
export type GraphNode = NodeGraph["nodes"][number];
export type GraphEdge = NodeGraph["edges"][number];
export type RadioSourceNode = Extract<GraphNode, { type: RadioSourceNodeType }>;

export function isRadioSourceNode(
  node: GraphNode | undefined
): node is RadioSourceNode {
  return (
    node !== undefined &&
    (RADIO_SOURCE_NODE_TYPES as readonly string[]).includes(node.type)
  );
}

/** A node with a channel strip: a Station, Track, File or Audio input. */
export type StripSourceNode =
  | RadioSourceNode
  | Extract<GraphNode, { type: "deviceIn" }>;

export function isStripSource(
  node: GraphNode | undefined
): node is StripSourceNode {
  return isRadioSourceNode(node) || node?.type === "deviceIn";
}

/** Whether a source type plays seekable media: a Track or a File. */
export function isMediaSourceType(type: NodeType): type is "platform" | "file" {
  return type === "platform" || type === "file";
}

/**
 * The strip a source of `type` holds, from any strip: what they share
 * (trim, pan, solo) carries over, a Track's or File's transport only
 * between those two, and the rest takes its default. A Track turned into
 * a Station keeps its level and place in the mix.
 */
export function stripForType(
  type: "station",
  from?: Partial<SourceStrip>
): StationStrip;
export function stripForType(
  type: "platform" | "file",
  from?: Partial<SourceStrip>
): MediaStrip;
export function stripForType(
  type: "deviceIn",
  from?: Partial<SourceStrip>
): InputStrip;
export function stripForType(
  type: RadioSourceNodeType | "deviceIn",
  from?: Partial<SourceStrip>
): SourceStrip;
export function stripForType(
  type: RadioSourceNodeType | "deviceIn",
  from: Partial<SourceStrip> = {}
): SourceStrip {
  const common: StationStrip = {
    pan: from.pan ?? DEFAULT_STATION_STRIP.pan,
    solo: from.solo ?? DEFAULT_STATION_STRIP.solo,
    trimDb: from.trimDb ?? DEFAULT_STATION_STRIP.trimDb,
  };
  if (type === "station") {
    return common;
  }
  if (type === "deviceIn") {
    return { ...DEFAULT_INPUT_STRIP, ...common };
  }
  const media = "speed" in from ? (from as Partial<MediaStrip>) : {};
  return { ...DEFAULT_MEDIA_STRIP, ...media, ...common };
}

export type NodeGraphMigration =
  | { status: "ok"; graph: NodeGraph }
  /**
   * Written by a newer app. `graph` is a best-effort view for display when
   * the document still reads as the current shape; never write it back.
   */
  | { status: "read-only"; version: number; graph: NodeGraph | null }
  | { status: "invalid"; error: string };

function readVersion(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null || !("version" in raw)) {
    return null;
  }
  const { version } = raw;
  return typeof version === "number" && Number.isInteger(version)
    ? version
    : null;
}

/** A newer document must remain untouched, even if its shape is unknown. */
export function getNodeGraphReadOnlyVersion(raw: unknown): number | null {
  const version = readVersion(raw);
  return version !== null && version > NODE_GRAPH_VERSION ? version : null;
}

const STRIP_SOURCE_TYPES: ReadonlySet<string> = new Set([
  ...RADIO_SOURCE_NODE_TYPES,
  "deviceIn",
]);

/**
 * v1 → v2: every source gets its default channel strip. Read leniently,
 * since a v1 document is only parsed after the upgrade: anything that is
 * not a source node, or has no data object yet, passes through for the
 * schema to fill or refuse.
 */
function upgradeV1(raw: object): object {
  const { nodes } = raw as { nodes?: unknown };
  return {
    ...raw,
    nodes: Array.isArray(nodes)
      ? nodes.map((node: unknown) => {
          if (
            typeof node !== "object" ||
            node === null ||
            !STRIP_SOURCE_TYPES.has(String((node as { type?: unknown }).type))
          ) {
            return node;
          }
          const { data, type } = node as { data?: unknown; type: string };
          if (typeof data !== "object" || data === null || "strip" in data) {
            return node;
          }
          return {
            ...node,
            data: {
              ...data,
              strip: stripForType(type as RadioSourceNodeType | "deviceIn"),
            },
          };
        })
      : nodes,
    version: 2,
  };
}

/** Upgrade steps by the version they start from. */
const UPGRADES: Record<number, (raw: object) => object> = { 1: upgradeV1 };

/** Upgrades a stored graph to the current version and parses it. */
export function migrateNodeGraph(raw: unknown): NodeGraphMigration {
  const version = readVersion(raw);
  if (version === null || version < 1) {
    return { error: "Patch has no valid version", status: "invalid" };
  }
  if (version > NODE_GRAPH_VERSION) {
    const view = nodeGraphSchema.safeParse({
      ...(raw as object),
      version: NODE_GRAPH_VERSION,
    });
    return {
      graph: view.success ? view.data : null,
      status: "read-only",
      version,
    };
  }
  let upgraded = raw as object;
  for (let step = version; step < NODE_GRAPH_VERSION; step += 1) {
    upgraded = UPGRADES[step]?.(upgraded) ?? upgraded;
  }
  const parsed = nodeGraphSchema.safeParse(upgraded);
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error), status: "invalid" };
  }
  return { graph: parsed.data, status: "ok" };
}
