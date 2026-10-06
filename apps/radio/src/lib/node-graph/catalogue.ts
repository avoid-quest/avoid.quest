/**
 * Node Catalogue
 *
 * One definition per node type: its ports, its category and when it ships.
 * FX nodes link to the effect definitions, so names and defaults come from
 * the same place as the effect racks in Single and DJ.
 */

import { createDefaultEffectConfig } from "@/lib/audio/dsp/effects/registry";
import { EFFECT_DEFINITIONS } from "@/lib/audio/dsp/effects/schema";
import type { EffectConfig, EffectType } from "@/lib/audio/dsp/effects/types";
import {
  EFFECT_NODE_TYPES,
  type EffectNodeType,
  type NodeType,
} from "./schema";

export type PortKind = "audio" | "sidechain" | "control" | "midi";
export type PortDirection = "in" | "out";

/** v1 ships first; v2 and later node types are refused until they land. */
export const SHIP_LEVELS = ["v1", "v2", "later"] as const;
export type ShipLevel = (typeof SHIP_LEVELS)[number];

export type NodeCategory = "source" | "fx" | "routing" | "control" | "output";

export type NodePort = {
  /** The `<name>` part of the handle id `"<dir>:<kind>:<name>"`. */
  id: string;
  kind: PortKind;
  direction: PortDirection;
  /** Most cables this port takes. */
  max: number;
  /** Sentence-case label shown on hover and focus. */
  label: string;
  /** Set when the port lands later than its node. */
  ship?: ShipLevel;
};

export type NodeDefinition = {
  type: NodeType;
  name: string;
  category: NodeCategory;
  ports: readonly NodePort[];
  ship: ShipLevel;
  /** Set on FX nodes; the node lowers to this EffectConfig type. */
  effectType?: EffectType;
  /** Set on the lane strip nodes that map onto native Web Audio nodes. */
  native?: "filter" | "pan" | "gain";
  /** Starts a lane: one managed sound. */
  source?: true;
  /** Plays a stream and so counts toward the playing budget. */
  stream?: true;
};

const UNLIMITED = Number.POSITIVE_INFINITY;

/** Effects whose external sidechain a key cable can drive. */
export const SIDECHAIN_EFFECT_TYPES = [
  "compressor",
  "gate",
  "vocoder",
] as const satisfies readonly EffectType[];

function audioIn(id = "main", label = "In", max = 1): NodePort {
  return { direction: "in", id, kind: "audio", label, max };
}

function audioOut(id = "main", label = "Out"): NodePort {
  return { direction: "out", id, kind: "audio", label, max: UNLIMITED };
}

function controlIn(id: string, label: string, ship?: ShipLevel): NodePort {
  return { direction: "in", id, kind: "control", label, max: UNLIMITED, ship };
}

function controlOut(id = "main", label = "Out", ship?: ShipLevel): NodePort {
  return {
    direction: "out",
    id,
    kind: "control",
    label,
    max: UNLIMITED,
    ship,
  };
}

const keyIn: NodePort = {
  direction: "in",
  id: "key",
  kind: "sidechain",
  label: "Key",
  max: 1,
};

function numberedOuts(prefix: string, label: string): NodePort[] {
  return [1, 2, 3, 4].map((index) =>
    audioOut(`${prefix}-${index}`, `${label} ${index}`)
  );
}

const CONTAINER_NAMES: Partial<Record<EffectType, string>> = {
  frequencySplit: "Band Split",
  fxComposite: "Split",
  stereoSplit: "Stereo Split",
};

function containerOuts(type: EffectType): NodePort[] {
  switch (type) {
    case "fxComposite":
      return numberedOuts("branch", "Branch");
    case "stereoSplit":
      return [audioOut("left", "Left"), audioOut("right", "Right")];
    case "frequencySplit":
      return numberedOuts("band", "Band");
    default:
      return [audioOut()];
  }
}

function effectDefinition(type: EffectNodeType): NodeDefinition {
  const container = CONTAINER_NAMES[type];
  const keyed = (SIDECHAIN_EFFECT_TYPES as readonly EffectType[]).includes(
    type
  );
  return {
    category: container ? "routing" : "fx",
    effectType: type,
    name: container ?? EFFECT_DEFINITIONS[type].name,
    ports: [
      audioIn(),
      ...(keyed ? [keyIn] : []),
      controlIn("parameter", "Parameter"),
      ...containerOuts(type),
    ],
    // Werkstatt needs the official openDAW backend; it waits for PR 8.
    ship: type === "werkstatt" ? "later" : "v1",
    type,
  };
}

type NonEffectNodeType = Exclude<NodeType, EffectNodeType>;

const OTHER_DEFINITIONS: Record<
  NonEffectNodeType,
  Omit<NodeDefinition, "type">
> = {
  clock: {
    category: "control",
    name: "Clock",
    ports: [controlOut()],
    ship: "v1",
  },
  crossfade: {
    category: "routing",
    name: "Crossfade",
    ports: [
      audioIn("a", "A"),
      audioIn("b", "B"),
      controlIn("position", "Position"),
      audioOut(),
    ],
    ship: "v2",
  },
  curve: {
    category: "control",
    name: "Curve",
    ports: [controlIn("gate", "Trigger"), controlOut()],
    ship: "v1",
  },
  // DJ's word for a mic or line-in; its lane is a live capture, not a stream.
  deviceIn: {
    category: "source",
    name: "Audio input",
    ports: [controlIn("parameter", "Parameter"), audioOut()],
    ship: "v1",
    source: true,
  },
  // One more place a lane can play, beside Speakers, through setSinkId.
  deviceOut: {
    category: "output",
    name: "Output device",
    ports: [audioIn("main", "In", UNLIMITED)],
    ship: "v1",
  },
  dial: {
    category: "routing",
    name: "Dial",
    ports: [audioIn("main", "In", 8), controlIn("tune", "Tune"), audioOut()],
    ship: "v2",
  },
  envelope: {
    category: "control",
    name: "ADSR",
    ports: [controlIn("gate", "Gate"), controlOut()],
    ship: "v1",
  },
  // A local file or a static audio URL (MP3, M3U, PLS), on its own lane.
  file: {
    category: "source",
    name: "File",
    ports: [controlIn("parameter", "Parameter"), audioOut()],
    ship: "v1",
    source: true,
    stream: true,
  },
  filter: {
    category: "fx",
    name: "Filter",
    native: "filter",
    ports: [
      audioIn(),
      controlIn("parameter", "Parameter"),
      controlIn("cutoff", "Cutoff", "v2"),
      audioOut(),
    ],
    ship: "v1",
  },
  follower: {
    category: "control",
    name: "Follower",
    ports: [audioIn(), controlOut()],
    ship: "v1",
  },
  gain: {
    category: "fx",
    name: "Gain",
    native: "gain",
    ports: [
      audioIn(),
      controlIn("parameter", "Parameter"),
      controlIn("gain", "Gain", "v2"),
      audioOut(),
    ],
    ship: "v1",
  },
  headphones: {
    category: "output",
    name: "Headphones",
    ports: [audioIn()],
    ship: "v2",
  },
  lfo: {
    category: "control",
    name: "LFO",
    ports: [
      controlIn("gate", "Reset"),
      controlIn("rate", "Rate", "v2"),
      controlOut(),
    ],
    ship: "v1",
  },
  loop: {
    category: "routing",
    name: "Loop",
    ports: [audioIn(), audioIn("return", "Return"), audioOut()],
    ship: "v2",
  },
  macro: {
    category: "control",
    name: "Macro",
    ports: [
      {
        direction: "in",
        id: "main",
        kind: "midi",
        label: "MIDI",
        max: 1,
        ship: "v2",
      },
      controlOut(),
    ],
    ship: "v1",
  },
  merge: {
    category: "routing",
    name: "Merge",
    ports: [audioIn("main", "In", 8), audioOut()],
    ship: "v1",
  },
  midiIn: {
    category: "control",
    name: "MIDI in",
    ports: [
      controlOut(),
      {
        direction: "out",
        id: "cc",
        kind: "midi",
        label: "CC",
        max: UNLIMITED,
        ship: "v2",
      },
    ],
    ship: "v1",
  },
  multiEnvelope: {
    category: "control",
    name: "Multi-stage envelope",
    ports: [controlIn("gate", "Gate"), controlOut()],
    ship: "v1",
  },
  muteSolo: {
    category: "routing",
    name: "Mute / Solo",
    ports: [audioIn(), audioOut()],
    ship: "v2",
  },
  pan: {
    category: "fx",
    name: "Pan",
    native: "pan",
    ports: [
      audioIn(),
      controlIn("parameter", "Parameter"),
      controlIn("pan", "Pan", "v2"),
      audioOut(),
    ],
    ship: "v1",
  },
  // A YouTube, SoundCloud, Bandcamp or Spotify track, album or playlist, or
  // a Mixcloud show.
  platform: {
    category: "source",
    name: "Track",
    ports: [controlIn("parameter", "Parameter"), audioOut()],
    ship: "v1",
    source: true,
    stream: true,
  },
  randomiser: {
    category: "control",
    name: "Randomiser",
    ports: [
      controlIn("gate", "Reset"),
      controlIn("trigger", "Trigger", "v2"),
      controlOut(),
    ],
    ship: "v1",
  },
  recorder: {
    category: "output",
    name: "Recorder",
    ports: [audioIn()],
    ship: "v2",
  },
  return: {
    category: "routing",
    name: "Return",
    ports: [audioIn("main", "In", UNLIMITED), audioOut()],
    ship: "v2",
  },
  scope: {
    category: "output",
    name: "Scope",
    ports: [audioIn()],
    ship: "v2",
  },
  send: {
    category: "routing",
    name: "Send",
    ports: [audioIn(), audioOut("main", "To return")],
    ship: "v2",
  },
  shapedLfo: {
    category: "control",
    name: "Shaped LFO",
    ports: [controlIn("gate", "Reset"), controlOut()],
    ship: "v1",
  },
  slew: {
    category: "control",
    name: "Slew",
    ports: [controlIn("main", "Control"), controlOut()],
    ship: "v1",
  },
  speakers: {
    category: "output",
    name: "Speakers",
    ports: [audioIn("main", "In", UNLIMITED)],
    ship: "v1",
  },
  static: {
    category: "source",
    name: "Static",
    ports: [controlIn("level", "Level"), audioOut()],
    ship: "v2",
    source: true,
  },
  station: {
    category: "source",
    name: "Station",
    ports: [
      controlIn("parameter", "Parameter"),
      controlIn("volume", "Volume", "v2"),
      controlIn("pan", "Pan", "v2"),
      controlIn("station", "Station", "v2"),
      audioOut(),
      controlOut("songChange", "Song change", "v2"),
      controlOut("titleHash", "Title hash", "v2"),
    ],
    ship: "v1",
    source: true,
    stream: true,
  },
  steps: {
    category: "control",
    name: "Steps",
    ports: [controlIn("gate", "Reset"), controlOut()],
    ship: "v1",
  },
  sundial: {
    category: "control",
    name: "Sundial",
    ports: [
      controlOut("dayPhase", "Day phase"),
      controlOut("atTime", "At time"),
    ],
    ship: "v2",
  },
  tapeWarp: {
    category: "routing",
    name: "Tape Warp",
    ports: [
      audioIn(),
      controlIn("time", "Time"),
      controlIn("freeze", "Freeze"),
      audioOut(),
    ],
    ship: "v2",
  },
  titleTrigger: {
    category: "control",
    name: "Title trigger",
    ports: [controlIn("main", "In"), controlOut()],
    ship: "v2",
  },
};

export const NODE_DEFINITIONS = {
  ...Object.fromEntries(
    Object.entries(OTHER_DEFINITIONS).map(([type, definition]) => [
      type,
      { ...definition, type: type as NonEffectNodeType },
    ])
  ),
  ...Object.fromEntries(
    EFFECT_NODE_TYPES.map((type) => [type, effectDefinition(type)])
  ),
} as Readonly<Record<NodeType, NodeDefinition>>;

export function getNodeDefinition(type: NodeType): NodeDefinition {
  return NODE_DEFINITIONS[type];
}

export function isShipped(ship: ShipLevel, release: ShipLevel): boolean {
  return SHIP_LEVELS.indexOf(ship) <= SHIP_LEVELS.indexOf(release);
}

/** The React Flow handle id for a port: `"<dir>:<kind>:<name>"`. */
export function portHandleId(port: NodePort): string {
  return `${port.direction}:${port.kind}:${port.id}`;
}

export function findPort(
  type: NodeType,
  direction: PortDirection,
  kind: PortKind,
  id: string
): NodePort | undefined {
  return NODE_DEFINITIONS[type].ports.find(
    (port) =>
      port.direction === direction && port.kind === kind && port.id === id
  );
}

export function isEffectNodeType(type: NodeType): type is EffectNodeType {
  return NODE_DEFINITIONS[type].effectType !== undefined;
}

/** The default EffectConfig an FX node starts with; its id is the node id. */
export function createNodeEffectConfig<TType extends EffectNodeType>(
  type: TType,
  nodeId: string
): Extract<EffectConfig, { type: TType }> {
  return createDefaultEffectConfig(type, nodeId, 0);
}
