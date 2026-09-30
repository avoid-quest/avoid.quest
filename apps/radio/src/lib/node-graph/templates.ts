/**
 * Node Templates
 *
 * Pure builders for the patches a node session can start from:
 *
 * - "start-from-multiple": every enabled saved station, then the session
 *   stations, in Multiple's order, each wired to Speakers at its volume;
 * - "blank": Speakers only.
 *
 * `buildNodeSessionFromTemplate` also compiles the patch, so the session it
 * returns carries the derived lane channels and passes the session schema.
 */

import { DEFAULT_EFFECT_TEMPO } from "@/lib/audio/dsp/routing/effect-tree";
import type { Radio } from "@/lib/audio/playback/types";
import type { PlaybackSessionRecord } from "@/lib/collections/playback-sessions";
import { type CompileEnv, compile } from "./compile";
import {
  type GraphEdge,
  type GraphNode,
  NODE_GRAPH_VERSION,
  type NodeGraph,
} from "./schema";
import { deriveNodeChannels } from "./session-channels";

export const NODE_TEMPLATE_IDS = ["start-from-multiple", "blank"] as const;
export type NodeTemplateId = (typeof NODE_TEMPLATE_IDS)[number];

export const SPEAKERS_NODE_ID = "speakers";

/** Station node width (240 px) plus a gutter. */
const COLUMN_WIDTH = 280;
/** A Station card with now-playing, badges and controls, plus a gutter. */
export const STATION_ROW_HEIGHT = 160;
/** Past this many stations the template lays them out in two columns. */
const SINGLE_COLUMN_MAX = 8;
/** Gap between the last station column and Speakers. */
const SPEAKERS_GAP = 200;

export const AUDIO_OUT_HANDLE = "out:audio:main";
export const AUDIO_IN_HANDLE = "in:audio:main";

export type NodeTemplateLevels = { volume: number; muted: boolean };

export type NodeTemplateSources = {
  /** Saved stations; only enabled ones are used, sorted by `order`. */
  saved?: readonly Radio[];
  /** Session stations, after the saved ones; duplicates of saved are skipped. */
  session?: readonly Radio[];
  /** A station's volume and mute; defaults to full and unmuted. */
  levels?: (radio: Radio) => NodeTemplateLevels | undefined;
  /** The Speakers gain. */
  masterVolume?: number;
};

type StationNode = Extract<GraphNode, { type: "station" }>;

/** Multiple's station order: enabled saved by `order`, then session. */
function orderedStations({
  saved = [],
  session = [],
}: NodeTemplateSources): Radio[] {
  const enabled = saved
    .filter((radio) => radio.enabled)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return [
    ...enabled,
    ...session.filter(
      (radio) =>
        radio.id === undefined ||
        !enabled.some((station) => station.id === radio.id)
    ),
  ];
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "station"
  );
}

/** `src-<radio id or name slug>`, suffixed when two stations collide. */
export function stationNodeId(radio: Radio, taken: Set<string>): string {
  const base = `src-${radio.id === undefined ? slug(radio.name) : String(radio.id)}`;
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) {
    id = `${base}-${suffix}`;
  }
  taken.add(id);
  return id;
}

function speakersNode(position: { x: number; y: number }): GraphNode {
  return {
    data: { muted: false },
    id: SPEAKERS_NODE_ID,
    position,
    type: "speakers",
  };
}

function startFromMultiple(sources: NodeTemplateSources): NodeGraph {
  const radios = orderedStations(sources);
  const columns = radios.length > SINGLE_COLUMN_MAX ? 2 : 1;
  const rows = Math.max(1, Math.ceil(radios.length / columns));
  const taken = new Set([SPEAKERS_NODE_ID]);
  const stations = radios.map((radio, index): StationNode => {
    const levels = sources.levels?.(radio);
    return {
      data: {
        muted: levels?.muted ?? false,
        radio,
        volume: levels?.volume ?? 1,
      },
      id: stationNodeId(radio, taken),
      position: {
        x: Math.floor(index / rows) * COLUMN_WIDTH,
        y: (index % rows) * STATION_ROW_HEIGHT,
      },
      type: "station",
    };
  });
  const edges = stations.map(
    (station): GraphEdge => ({
      gain: 1,
      id: `${station.id}->${SPEAKERS_NODE_ID}`,
      muted: false,
      source: station.id,
      sourceHandle: AUDIO_OUT_HANDLE,
      target: SPEAKERS_NODE_ID,
      targetHandle: AUDIO_IN_HANDLE,
    })
  );
  return {
    edges,
    nodes: [
      ...stations,
      speakersNode({
        x: columns * COLUMN_WIDTH + SPEAKERS_GAP,
        y: ((rows - 1) * STATION_ROW_HEIGHT) / 2,
      }),
    ],
    version: NODE_GRAPH_VERSION,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function buildNodeGraphFromTemplate(
  template: NodeTemplateId,
  sources: NodeTemplateSources = {}
): NodeGraph {
  switch (template) {
    case "start-from-multiple":
      return startFromMultiple(sources);
    case "blank":
      return {
        edges: [],
        nodes: [speakersNode({ x: COLUMN_WIDTH + SPEAKERS_GAP, y: 0 })],
        version: NODE_GRAPH_VERSION,
        viewport: { x: 0, y: 0, zoom: 1 },
      };
    default: {
      const exhaustive: never = template;
      return exhaustive;
    }
  }
}

/** The `"node"` playback session for a template, lane channels included. */
export function buildNodeSessionFromTemplate(
  template: NodeTemplateId,
  sources: NodeTemplateSources = {},
  env: CompileEnv = { crossOriginIsolated: false }
): PlaybackSessionRecord {
  const graph = buildNodeGraphFromTemplate(template, sources);
  return {
    activeChannelId: null,
    channels: deriveNodeChannels(compile(graph, env)),
    crossfadePosition: 0.5,
    graph,
    headphoneVolume: 1,
    id: "node",
    masterVolume: sources.masterVolume ?? 1,
    tempo: DEFAULT_EFFECT_TEMPO,
  };
}
