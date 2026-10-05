/**
 * Node Templates
 *
 * Pure builders for the patches a node session can start from:
 *
 * - "starter": the default, one empty Station slot wired to Speakers;
 * - "start-from-multiple": every enabled saved station, then the session
 *   stations, in Multiple's order, each wired to Speakers at its volume;
 * - "duck": a talk station keys a Compressor on a music station, so the
 *   music dips whenever the talk speaks;
 * - "blank": Speakers only.
 *
 * Session compilation lives in template-sessions.ts, loaded only with Node.
 */

import type { Radio } from "@/lib/audio/playback/types";
import { createNodeEffectConfig } from "./catalogue";
import {
  type GraphEdge,
  type GraphNode,
  NODE_GRAPH_VERSION,
  type NodeGraph,
  stripForType,
} from "./schema";

export const NODE_TEMPLATE_IDS = [
  "starter",
  "start-from-multiple",
  "duck",
  "blank",
] as const;
export type NodeTemplateId = (typeof NODE_TEMPLATE_IDS)[number];

export const SPEAKERS_NODE_ID = "speakers";

const STATION_WIDTH = 240;
/** Station node width plus a gutter. */
const COLUMN_WIDTH = STATION_WIDTH + 40;
/** A Station card with now-playing, genre chips and its strip, plus a gutter. */
export const STATION_ROW_HEIGHT = 190;
/** Past this many stations the template lays them out in two columns. */
const SINGLE_COLUMN_MAX = 8;
/** Gap between the last station column and Speakers. */
const SPEAKERS_GAP = 200;

export const AUDIO_OUT_HANDLE = "out:audio:main";
export const AUDIO_IN_HANDLE = "in:audio:main";
export const KEY_IN_HANDLE = "in:sidechain:key";

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

/** `base`, suffixed until no node has it, then marked taken. */
function claimId(base: string, taken: Set<string>): string {
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) {
    id = `${base}-${suffix}`;
  }
  taken.add(id);
  return id;
}

/** `src-<radio id or name slug>`, suffixed when two stations collide. */
export function stationNodeId(radio: Radio, taken: Set<string>): string {
  return claimId(
    `src-${radio.id === undefined ? slug(radio.name) : String(radio.id)}`,
    taken
  );
}

function speakersNode(position: { x: number; y: number }): GraphNode {
  return {
    data: { muted: false },
    id: SPEAKERS_NODE_ID,
    position,
    type: "speakers",
  };
}

/** The Starter template's empty Station slot. */
export const STARTER_STATION_ID = "src-station";

/**
 * The smallest patch that plays: one empty Station slot to search, wired to
 * Speakers, in Duck's columns.
 */
function starter(): NodeGraph {
  return {
    edges: [
      {
        gain: 1,
        id: `${STARTER_STATION_ID}->${SPEAKERS_NODE_ID}`,
        muted: false,
        source: STARTER_STATION_ID,
        sourceHandle: AUDIO_OUT_HANDLE,
        target: SPEAKERS_NODE_ID,
        targetHandle: AUDIO_IN_HANDLE,
      },
    ],
    nodes: [
      {
        data: {
          muted: false,
          radio: null,
          strip: stripForType("station"),
          volume: 1,
        },
        id: STARTER_STATION_ID,
        position: { x: 0, y: 0 },
        type: "station",
      },
      // A cable's length right of the slot, as in Duck.
      speakersNode({ x: STATION_WIDTH + 120, y: 0 }),
    ],
    version: NODE_GRAPH_VERSION,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** A station to lay out, with its level. */
export type StationSeed = { radio: Radio } & Partial<NodeTemplateLevels>;

/**
 * Stations in order in one column, or two past eight, each wired to a
 * Speakers node centred on their right. Shared by "All my stations" and
 * the Multiple → Node migration.
 */
export function buildStationPatch(seeds: readonly StationSeed[]): NodeGraph {
  const columns = seeds.length > SINGLE_COLUMN_MAX ? 2 : 1;
  const rows = Math.max(1, Math.ceil(seeds.length / columns));
  const taken = new Set([SPEAKERS_NODE_ID]);
  const stations = seeds.map(
    ({ muted = false, radio, volume = 1 }, index): StationNode => ({
      data: { muted, radio, strip: stripForType("station"), volume },
      id: stationNodeId(radio, taken),
      position: {
        x: Math.floor(index / rows) * COLUMN_WIDTH,
        y: (index % rows) * STATION_ROW_HEIGHT,
      },
      type: "station",
    })
  );
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

function startFromMultiple(sources: NodeTemplateSources): NodeGraph {
  return buildStationPatch(
    orderedStations(sources).map((radio) => ({
      radio,
      ...sources.levels?.(radio),
    }))
  );
}

/** The Duck template's Compressor. */
export const DUCK_NODE_ID = "duck";

/**
 * Station names that read as talk rather than music. Names only: station
 * blurbs mention podcasts and talks far too often to go by.
 */
const TALK_STATION = /\b(talk|news|speech|spoken|radio 4|world service)\b/i;

/**
 * A ducking Compressor: keyed, a talk station at speaking level pulls the
 * music down by about 12 dB, and lets it back up over 400 ms. Auto makeup
 * stays off, or it would undo the dip.
 */
const DUCK_PARAMS = {
  attack: 5,
  autoMakeup: false,
  automakeup: false,
  makeup: 0,
  ratio: 6,
  release: 400,
  threshold: -30,
};

/** Where the Duck Compressor sits: a cable's length right of the stations. */
const DUCK_FX_X = STATION_WIDTH + 120;
/** The Compressor body, three knobs wide, plus a cable's length. */
const DUCK_SPEAKERS_X = DUCK_FX_X + 224 + 120;

/**
 * Two stations and a Compressor: the music plays through the Compressor,
 * the talk plays straight to Speakers and also keys the Compressor. The
 * voice is Radio BlackOut when available, then the first station that reads
 * as talk, else the second; music is the first of the rest. A missing one
 * is an empty slot to search.
 */
function duck(sources: NodeTemplateSources): NodeGraph {
  const stations = orderedStations(sources);
  const talkRadio =
    stations.find((radio) => radio.name.toLowerCase() === "radio blackout") ??
    stations.find((radio) => TALK_STATION.test(radio.name)) ??
    stations[1];
  const musicRadio = stations.find((radio) => radio !== talkRadio);
  const taken = new Set([SPEAKERS_NODE_ID, DUCK_NODE_ID]);
  const station = (
    radio: Radio | undefined,
    role: string,
    y: number
  ): StationNode => ({
    data: {
      muted: false,
      radio: radio ?? null,
      strip: stripForType("station"),
      volume: 1,
      ...(radio ? sources.levels?.(radio) : undefined),
    },
    id: radio ? stationNodeId(radio, taken) : claimId(`src-${role}`, taken),
    position: { x: 0, y },
    type: "station",
  });
  const music = station(musicRadio, "music", 0);
  const talk = station(talkRadio, "talk", STATION_ROW_HEIGHT);
  const cable = (
    source: string,
    target: string,
    targetHandle = AUDIO_IN_HANDLE
  ): GraphEdge => ({
    gain: 1,
    id: `${source}->${target}`,
    muted: false,
    source,
    sourceHandle: AUDIO_OUT_HANDLE,
    target,
    targetHandle,
  });
  return {
    edges: [
      cable(music.id, DUCK_NODE_ID),
      cable(DUCK_NODE_ID, SPEAKERS_NODE_ID),
      cable(talk.id, SPEAKERS_NODE_ID),
      cable(talk.id, DUCK_NODE_ID, KEY_IN_HANDLE),
    ],
    nodes: [
      music,
      talk,
      {
        data: {
          effect: {
            ...createNodeEffectConfig("compressor", DUCK_NODE_ID),
            ...DUCK_PARAMS,
            enabled: true,
          },
        },
        id: DUCK_NODE_ID,
        position: { x: DUCK_FX_X, y: 0 },
        type: "compressor",
      },
      speakersNode({ x: DUCK_SPEAKERS_X, y: STATION_ROW_HEIGHT / 2 }),
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
    case "starter":
      return starter();
    case "start-from-multiple":
      return startFromMultiple(sources);
    case "duck":
      return duck(sources);
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
