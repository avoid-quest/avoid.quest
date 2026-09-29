/**
 * Node Graph Schema
 *
 * The versioned document Node mode persists: nodes, cables and the viewport.
 * `migrateNodeGraph` is the only way in from storage, backups or share links,
 * so an unknown future version is surfaced read-only instead of overwritten.
 */

import { z } from "zod";
import { effectConfigSchema } from "@/lib/audio/dsp/effects/effect-config-schema";
import { EFFECT_TYPES, type EffectConfig } from "@/lib/audio/dsp/effects/types";
import type { MidiTransform } from "@/lib/midi/types";

export const NODE_GRAPH_VERSION = 1;

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
  "station",
  "speakers",
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

const stationNodeSchema = z.object({
  ...nodeBase,
  data: z.object({
    muted: z.boolean().default(false),
    /** `null` is the empty slot, whose body is the station search. */
    radio: stationRadioSchema.nullable().default(null),
    volume: unitSchema.default(1),
  }),
  type: z.literal("station"),
});

const speakersNodeSchema = z.object({
  ...nodeBase,
  // Master volume stays the session's masterVolume.
  data: z.object({ muted: z.boolean().default(false) }).default({
    muted: false,
  }),
  type: z.literal("speakers"),
});

const filterNodeSchema = z.object({
  ...nodeBase,
  data: z.object({
    frequency: z.number().positive().default(1000),
    Q: z.number().positive().default(1),
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
    data: z.object({ effect: effectConfigSchema }),
    type: z.enum(EFFECT_NODE_TYPES),
  })
  .refine((node) => node.data.effect.type === node.type, {
    message: "Effect type must match the node type",
    path: ["data", "effect", "type"],
  })
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
  speakersNodeSchema,
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

/**
 * Upgrades a stored graph to the current version and parses it.
 * v1 is the first version, so there is nothing to upgrade from yet.
 */
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
  const parsed = nodeGraphSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error), status: "invalid" };
  }
  return { graph: parsed.data, status: "ok" };
}
