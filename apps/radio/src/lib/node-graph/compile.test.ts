import { describe, expect, test } from "bun:test";
import { convertEffectConfigToEngine } from "@/lib/audio/dsp/effects/engine-conversion";
import type {
  EffectConfig,
  EffectType,
  FrequencySplitConfig,
} from "@/lib/audio/dsp/effects/types";
import { EffectSource } from "@/lib/audio/dsp/processor-source";
import {
  normalizeEffectTree,
  visitEffectTree,
} from "@/lib/audio/dsp/routing/effect-tree";
import { parsePlaybackSessionRecord } from "@/lib/collections/playback-sessions";
import { setBandCount, setCrossover } from "./branches";
import { createNodeEffectConfig } from "./catalogue";
import {
  type CompileEnv,
  compile,
  type EnginePlan,
  idleKeys,
  isSoloActive,
  isSourceLive,
  type LanePlan,
  layoutSignature,
  MONITORING_CHANNEL_CAP,
  mergeRoles,
} from "./compile";
import { removeEdges } from "./graph-edits";
import { commitNodeGraph, createNodeStore, undoNodeGraph } from "./node-store";
import {
  type GraphEdge,
  type NodeGraph,
  type NodeGraphInput,
  type NodeType,
  nodeGraphSchema,
} from "./schema";
import { deriveNodeChannels } from "./session-channels";
import { forgetLocalFileUrls, keepLocalFileUrl } from "./sources";
import { validateConnection } from "./validate";

type NodeInput = NodeGraphInput["nodes"][number];
type EdgeInput = NodeGraphInput["edges"][number];

const position = { x: 0, y: 0 };

function station(id: string, radio = true): NodeInput {
  return {
    data: {
      radio: radio
        ? { id, name: id, streamUrl: `https://example.com/${id}.mp3` }
        : null,
    },
    id,
    position,
    type: "station",
  };
}

function fx(
  id: string,
  type: EffectType,
  overrides: Partial<EffectConfig> = {}
): NodeInput {
  return {
    data: {
      effect: { ...createNodeEffectConfig(type, id), ...overrides },
    },
    id,
    position,
    type,
  } as NodeInput;
}

function node(
  id: string,
  type: Exclude<NodeType, EffectType | "station">,
  data: Record<string, unknown> = {}
): NodeInput {
  return { data, id, position, type } as NodeInput;
}

const speakers = node("speakers", "speakers");

function audio(
  source: string,
  target: string,
  {
    from = "main",
    to = "main",
    id = `${source}->${target}`,
    gain,
    muted,
  }: {
    from?: string;
    to?: string;
    id?: string;
    gain?: number;
    muted?: boolean;
  } = {}
): EdgeInput {
  return {
    gain,
    id,
    muted,
    source,
    sourceHandle: `out:audio:${from}`,
    target,
    targetHandle: `in:audio:${to}`,
  };
}

function key(source: string, target: string): EdgeInput {
  return {
    id: `${source}~>${target}`,
    source,
    sourceHandle: "out:audio:main",
    target,
    targetHandle: "in:sidechain:key",
  };
}

function graph(nodes: NodeInput[], edges: EdgeInput[] = []): NodeGraph {
  return nodeGraphSchema.parse({ edges, nodes, version: 2 });
}

function lastEdge(patch: NodeGraph): GraphEdge {
  const edge = patch.edges.at(-1);
  if (!edge) {
    throw new Error("No cable in test patch");
  }
  return edge;
}

const ENV: CompileEnv = { crossOriginIsolated: true };

function build(
  nodes: NodeInput[],
  edges: EdgeInput[] = [],
  env: Partial<CompileEnv> = {}
): EnginePlan {
  return compile(graph(nodes, edges), { ...ENV, ...env });
}

function lane(plan: EnginePlan, id: string): LanePlan {
  const found = plan.lanes.get(id);
  if (!found) {
    throw new Error(`No lane ${id}`);
  }
  return found;
}

function codes(plan: EnginePlan): string[] {
  return plan.issues.map((issue) => `${issue.code}@${issue.id}`);
}

/** The tree as [type, id] pairs, with chains as nested arrays. */
function shape(effects: readonly EffectConfig[]): unknown[] {
  return effects.map((effect) =>
    "chains" in effect
      ? [effect.type, effect.id, effect.chains.map((c) => shape(c.effects))]
      : [effect.type, effect.id]
  );
}

function effectIds(effects: readonly EffectConfig[]): string[] {
  const ids: string[] = [];
  visitEffectTree(effects, (effect) => {
    ids.push(effect.id);
  });
  return ids;
}

/** Runs the compiler's actual compatibility-backend payload. */
function render(effects: readonly EffectConfig[]): number {
  const source = new EffectSource("test", 48_000);
  for (const effect of effects) {
    expect(
      source.addEffect(
        effect.id,
        effect.type,
        convertEffectConfigToEngine(effect),
        effect.order
      )
    ).toBe(true);
  }
  const outputL = new Float32Array(128);
  const outputR = new Float32Array(128);
  source.start();
  source.process(
    new Float32Array(128).fill(0.2),
    new Float32Array(128).fill(0.2),
    outputL,
    outputR,
    0,
    128
  );
  expect(outputR[0]).toBeCloseTo(outputL[0] ?? 0);
  return outputL[0] ?? 0;
}

describe("compile: the migrated Multiple layout", () => {
  test("gives one lane per station and a cable per edge", () => {
    const plan = build(
      [station("a"), station("b"), speakers],
      [audio("a", "speakers"), audio("b", "speakers")]
    );
    expect(plan.issues).toEqual([]);
    expect([...plan.lanes.keys()]).toEqual(["a", "b"]);
    expect(lane(plan, "a")).toMatchObject({
      backend: null,
      channelId: "n:a",
      effects: [],
      filter: null,
      nodes: ["a"],
      pan: 0,
      soundId: "node:n:a",
    });
    expect(plan.edges.get("a->speakers")).toEqual({
      from: { id: "a", kind: "lane" },
      gain: 1,
      id: "a->speakers",
      muted: false,
      to: { id: "speakers", kind: "sink" },
    });
    expect([...plan.sinks.values()]).toEqual([
      { id: "speakers", type: "speakers" },
    ]);
  });

  test("an empty station slot has no lane, and its cables survive in the graph", () => {
    const plan = build(
      [station("a"), station("empty", false), speakers],
      [audio("a", "speakers"), audio("empty", "speakers")]
    );
    expect(plan.issues).toEqual([]);
    expect([...plan.lanes.keys()]).toEqual(["a"]);
    expect([...plan.edges.keys()]).toEqual(["a->speakers"]);
  });

  test("a hidden station is disabled: no lane, and its cables survive", () => {
    const hidden: NodeInput = {
      data: {
        radio: {
          enabled: false,
          id: "hidden",
          name: "hidden",
          streamUrl: "https://example.com/hidden.mp3",
        },
      },
      id: "hidden",
      position,
      type: "station",
    };
    const patch = graph(
      [station("a"), hidden, speakers],
      [audio("a", "speakers"), audio("hidden", "speakers")]
    );
    const plan = compile(patch, ENV);
    expect(plan.issues).toEqual([]);
    expect([...plan.lanes.keys()]).toEqual(["a"]);
    expect(patch.edges.map((edge) => edge.id)).toContain("hidden->speakers");
  });
});

describe("compile: audio inputs and output devices", () => {
  const mic = (deviceId: string | null = "usb-mic") =>
    node("mic", "deviceIn", {
      channelSelection: { left: 1, right: 1 },
      deviceId,
      deviceLabel: "Desk mic",
      echoCancellation: true,
      volume: 0.6,
    });

  test("an Audio input is a lane of its own, with its device as the source", () => {
    const plan = build(
      [mic(), node("pan", "pan", { pan: -0.5 }), speakers],
      [audio("mic", "pan"), audio("pan", "speakers")]
    );

    expect(codes(plan)).toEqual([]);
    expect(lane(plan, "mic")).toMatchObject({
      channelId: "n:mic",
      muted: false,
      nodes: ["mic", "pan"],
      pan: -0.5,
      soundId: "node:n:mic",
      source: {
        channelSelection: { left: 1, right: 1 },
        deviceId: "usb-mic",
        echoCancellation: true,
        kind: "device",
      },
      volume: 0.6,
    });
    // The channel carries DJ's device-input radio, so restore knows it.
    expect(lane(plan, "mic").radio).toMatchObject({
      name: "Desk mic",
      platformMetadata: {
        channelSelection: { left: 1, right: 1 },
        deviceId: "usb-mic",
        platform: "device-input",
      },
      streamUrl: "",
    });
  });

  test("a Station's lane names its stream as the source", () => {
    const plan = build([station("a"), speakers], [audio("a", "speakers")]);

    expect(lane(plan, "a").source).toEqual({
      kind: "radio",
      radio: { id: "a", name: "a", streamUrl: "https://example.com/a.mp3" },
    });
  });

  test("an Audio input with no device has no lane, like an empty Station", () => {
    const plan = build([mic(null), speakers], [audio("mic", "speakers")]);

    expect(plan.lanes.size).toBe(0);
    expect(codes(plan)).toEqual([]);
  });

  test("an Output device is a sink with its device and mute", () => {
    const plan = build(
      [
        station("a"),
        node("desk", "deviceOut", { deviceId: "usb", muted: true }),
        speakers,
      ],
      [audio("a", "desk"), audio("a", "speakers")]
    );

    expect(plan.sinks.get("desk")).toEqual({
      deviceId: "usb",
      id: "desk",
      muted: true,
      type: "deviceOut",
    });
    expect(
      [...plan.edges.values()].map((edge) => `${edge.from.id}>${edge.to.id}`)
    ).toEqual(["a>desk", "a>speakers"]);
  });

  test("multiple Output device nodes on one device retain independent routes", () => {
    const plan = build(
      [
        station("a"),
        node("desk", "deviceOut", { deviceId: "usb" }),
        node("booth", "deviceOut", { deviceId: "usb" }),
        speakers,
      ],
      [audio("a", "desk"), audio("a", "booth")]
    );

    expect(codes(plan)).toEqual([]);
    expect(plan.sinks.has("booth")).toBe(true);
    expect([...plan.edges.values()].map((edge) => edge.to.id)).toEqual([
      "desk",
      "booth",
    ]);
  });
});

describe("compile: Track and File sources", () => {
  const youtube = {
    id: "yt-1",
    name: "A video",
    platformMetadata: {
      itemType: "video",
      platform: "youtube",
      url: "https://www.youtube.com/watch?v=abc",
      videoId: "abc",
    },
    streamUrl: "https://media.example/abc.m4a",
  };
  const picked = {
    id: "local-1",
    name: "Demo",
    platformMetadata: { itemType: "track", platform: "local-file", url: "" },
    streamUrl: "blob:https://radio.example/demo",
  };

  function source(
    id: string,
    type: "platform" | "file",
    radio: Record<string, unknown> | null
  ): NodeInput {
    return { data: { radio }, id, position, type } as NodeInput;
  }

  test("a filled Track and a picked File each get their own radio lane", () => {
    keepLocalFileUrl(picked.streamUrl);
    try {
      const plan = build(
        [
          source("track", "platform", youtube),
          source("file", "file", picked),
          speakers,
        ],
        [audio("track", "speakers"), audio("file", "speakers")]
      );
      expect(plan.issues).toEqual([]);
      expect(lane(plan, "track")).toMatchObject({
        channelId: "n:track",
        radio: { id: "yt-1" },
        source: { kind: "radio" },
      });
      expect(lane(plan, "file").radio).toMatchObject({ id: "local-1" });
      expect(plan.edges.get("track->speakers")?.to.id).toBe("speakers");
    } finally {
      forgetLocalFileUrls();
    }
  });

  test("an empty Track and a File from an earlier page have no lane, and a key from them says why", () => {
    const nodes = [
      station("music"),
      source("track", "platform", null),
      source("file", "file", picked),
      fx("comp", "compressor", { enabled: true }),
      fx("gate", "gate", { enabled: true }),
      speakers,
    ];
    const edges = [
      audio("music", "comp"),
      audio("comp", "gate"),
      audio("gate", "speakers"),
      audio("track", "speakers"),
      audio("file", "speakers"),
      key("track", "comp"),
    ];
    const patch = graph(nodes, edges);
    const plan = compile(patch, ENV);
    expect([...plan.lanes.keys()]).toEqual(["music"]);
    expect(patch.nodes.filter(isSourceLive).map((entry) => entry.id)).toEqual([
      "music",
    ]);
    expect(idleKeys(patch, plan).get("track~>comp")).toBe("The Track is empty");
    const fromFile = graph(nodes, [...edges.slice(0, 5), key("file", "comp")]);
    expect(idleKeys(fromFile, compile(fromFile, ENV)).get("file~>comp")).toBe(
      "Pick the file again"
    );
  });
});

describe("compile: channel strips", () => {
  function withStrip(input: NodeInput, strip: Record<string, unknown>) {
    return {
      ...input,
      data: { ...(input.data as object), strip },
    } as NodeInput;
  }

  test("a Station's trim multiplies into its exits and leaves the fader alone", () => {
    const plan = build(
      [
        withStrip(station("a"), { trimDb: 6 }),
        node("warm", "gain", { gainDb: 0 }),
        speakers,
      ],
      [audio("a", "warm"), audio("warm", "speakers", { gain: 0.5 })]
    );
    expect(plan.edges.get("warm->speakers")?.gain).toBeCloseTo(
      0.5 * 10 ** (6 / 20)
    );
    expect(10 ** (6 / 20)).toBeCloseTo(2, 0);
    expect(lane(plan, "a").volume).toBe(1);
  });

  test("strip pan adds to the lane's Pan node, clamped", () => {
    const plan = build(
      [
        withStrip(station("a"), { pan: 0.5 }),
        node("pan", "pan", { pan: 0.75 }),
        withStrip(station("b"), { pan: -0.25 }),
        speakers,
      ],
      [audio("a", "pan"), audio("pan", "speakers"), audio("b", "speakers")]
    );
    expect(lane(plan, "a").pan).toBe(1);
    expect(lane(plan, "b").pan).toBe(-0.25);
  });

  test("a solo mutes every unsoloed lane's exits, never its fader", () => {
    const stations = [
      withStrip(station("a"), { solo: true }),
      station("b"),
      station("c"),
    ];
    const edges = ["a", "b", "c"].map((id) => audio(id, "speakers"));
    const soloed = build([...stations, speakers], edges);
    expect(
      [...soloed.edges.values()].map((edge) => [edge.id, edge.muted])
    ).toEqual([
      ["a->speakers", false],
      ["b->speakers", true],
      ["c->speakers", true],
    ]);
    expect([...soloed.lanes.values()].map((entry) => entry.muted)).toEqual([
      false,
      false,
      false,
    ]);

    const unsoloed = build(
      [station("a"), station("b"), station("c"), speakers],
      edges
    );
    expect([...unsoloed.edges.values()].every((edge) => !edge.muted)).toBe(
      true
    );
  });

  test("a solo on an empty slot has no lane, so it silences nothing", () => {
    const plan = build(
      [
        withStrip(station("gone", false), { solo: true }),
        station("b"),
        speakers,
      ],
      [audio("gone", "speakers"), audio("b", "speakers")]
    );
    expect(plan.edges.get("b->speakers")?.muted).toBe(false);
  });

  test("isSoloActive counts only soloed sources with a lane, as compile does", () => {
    const soloActive = (nodes: NodeInput[]) =>
      isSoloActive(graph(nodes, []).nodes);
    expect(
      soloActive([withStrip(station("gone", false), { solo: true }), speakers])
    ).toBe(false);
    expect(
      soloActive([
        withStrip(station("a"), { solo: true }),
        station("b"),
        speakers,
      ])
    ).toBe(true);
    expect(soloActive([station("a"), speakers])).toBe(false);
  });

  test("a Track or File carries its transport; a Station and an input don't", () => {
    const track = {
      data: {
        radio: {
          id: "yt-1",
          name: "A video",
          platformMetadata: {
            itemType: "video",
            platform: "youtube",
            url: "https://www.youtube.com/watch?v=abc",
            videoId: "abc",
          },
          streamUrl: "https://media.example/abc.m4a",
        },
        strip: { cueListen: true, keyLock: false, loop: true, speed: 1.5 },
      },
      id: "track",
      position,
      type: "platform",
    } as NodeInput;
    const plan = build(
      [
        track,
        station("a"),
        node("mic", "deviceIn", { deviceId: "mic" }),
        speakers,
      ],
      [
        audio("track", "speakers"),
        audio("a", "speakers"),
        audio("mic", "speakers"),
      ]
    );
    expect(lane(plan, "track").transport).toEqual({
      keyLock: false,
      loop: true,
      speed: 1.5,
    });
    expect(lane(plan, "track").cueListen).toBe(true);
    expect(lane(plan, "a").transport).toBeNull();
    expect(lane(plan, "mic").transport).toBeNull();
    expect(lane(plan, "mic").cueListen).toBe(false);
  });
});

describe("compile: lanes in series", () => {
  test("FX become EffectConfig entries whose id is the node id", () => {
    const plan = build(
      [
        station("a"),
        fx("verb", "cheapReverb"),
        fx("crush", "crusher"),
        speakers,
      ],
      [audio("a", "verb"), audio("verb", "crush"), audio("crush", "speakers")]
    );
    const { effects, nodes } = lane(plan, "a");
    expect(shape(effects)).toEqual([
      ["cheapReverb", "verb"],
      ["crusher", "crush"],
    ]);
    expect(effects.map((effect) => effect.order)).toEqual([0, 1]);
    expect(nodes).toEqual(["a", "verb", "crush"]);
    expect(plan.edges.get("crush->speakers")?.from).toEqual({
      id: "a",
      kind: "lane",
    });
  });

  test("a leading Filter and Pan map onto the native strip", () => {
    const plan = build(
      [
        station("a"),
        node("pan", "pan", { pan: -0.5 }),
        node("cut", "filter", { frequency: 400, type: "highpass" }),
        fx("verb", "cheapReverb"),
        speakers,
      ],
      [
        audio("a", "pan"),
        audio("pan", "cut"),
        audio("cut", "verb"),
        audio("verb", "speakers"),
      ]
    );
    expect(plan.issues).toEqual([]);
    const lowered = lane(plan, "a");
    expect(lowered.pan).toBe(-0.5);
    expect(lowered.filter).toEqual({
      frequency: 400,
      Q: 1,
      type: "highpass",
    });
    expect(shape(lowered.effects)).toEqual([["cheapReverb", "verb"]]);
  });

  test("a Filter after FX compiles as its own processor", () => {
    const plan = build(
      [
        station("a"),
        fx("verb", "cheapReverb"),
        node("cut", "filter"),
        speakers,
      ],
      [audio("a", "verb"), audio("verb", "cut"), audio("cut", "speakers")]
    );
    expect(codes(plan)).toEqual([]);
    expect(plan.patch?.nodes.has("cut")).toBe(true);
    expect(lane(plan, "a").effects).toEqual([]);
    expect(plan.edges.size).toBe(1);
  });

  test("Gain nodes and cable trims fold into whole-signal trim or the exit", () => {
    const plan = build(
      [
        station("a"),
        node("trim", "gain", { gainDb: -6 }),
        fx("verb", "cheapReverb", { enabled: true }),
        node("out", "gain", { gainDb: 6 }),
        speakers,
      ],
      [
        audio("a", "trim", { gain: 0.5 }),
        audio("trim", "verb"),
        audio("verb", "out"),
        audio("out", "speakers", { gain: 2 }),
      ]
    );
    const [verb] = lane(plan, "a").effects;
    expect(verb?.signalGain).toBeCloseTo(0.5 * 10 ** (-6 / 20));
    expect(verb?.inputGain).toBe(1);
    expect(plan.edges.get("out->speakers")?.gain).toBeCloseTo(
      2 * 10 ** (6 / 20)
    );
  });

  test("a muted cable before an FX silences its input", () => {
    const plan = build(
      [station("a"), fx("verb", "cheapReverb", { enabled: true }), speakers],
      [audio("a", "verb", { muted: true }), audio("verb", "speakers")]
    );
    expect(lane(plan, "a").effects[0]?.signalGain).toBe(0);
    expect(plan.edges.get("verb->speakers")?.muted).toBe(true);
  });

  test("switching on an FX behind a muted cable keeps its exits muted", () => {
    // The send must not open before the async FX update silences the input.
    const plans = [false, true].map((enabled) =>
      build(
        [station("a"), fx("verb", "cheapReverb", { enabled }), speakers],
        [audio("a", "verb", { muted: true }), audio("verb", "speakers")]
      )
    );
    for (const plan of plans) {
      expect(plan.edges.get("verb->speakers")?.muted).toBe(true);
    }
    expect(lane(plans[1] as EnginePlan, "a").effects[0]?.signalGain).toBe(0);
  });

  test("a lane whose trims push a Post-FX trim past its slider still saves", () => {
    const plan = build(
      [
        station("a"),
        fx("first", "compressor", { enabled: true, outputGain: 2 }),
        fx("second", "compressor", { enabled: true }),
        speakers,
      ],
      [
        audio("a", "first"),
        audio("first", "second", { gain: 4 }),
        audio("second", "speakers"),
      ]
    );
    expect(lane(plan, "a").effects[0]?.outputGain).toBe(8);
    const session = parsePlaybackSessionRecord({
      channels: deriveNodeChannels(plan),
      id: "node",
    });
    expect(session.channels[0]?.effects[0]?.outputGain).toBe(8);
  });

  test("a trim passes a bypassed FX untouched, since bypass drops its gains", () => {
    const plan = build(
      [
        station("a"),
        node("trim", "gain", { gainDb: -6 }),
        fx("verb", "cheapReverb"),
        speakers,
      ],
      [
        audio("a", "trim", { muted: true }),
        audio("trim", "verb"),
        audio("verb", "speakers", { gain: 0.5 }),
      ]
    );
    expect(lane(plan, "a").effects[0]?.inputGain).toBe(1);
    expect(plan.edges.get("verb->speakers")).toMatchObject({
      gain: 0.5 * 10 ** (-6 / 20),
      muted: true,
    });
  });

  test("a trim between FX lands on the previous FX's post trim", () => {
    const plan = build(
      [
        station("a"),
        fx("crush", "crusher", { enabled: true }),
        fx("off", "fold"),
        fx("verb", "cheapReverb", { dryWet: 0.5, enabled: true }),
        speakers,
      ],
      [
        audio("a", "crush"),
        audio("crush", "off", { gain: 0.5 }),
        audio("off", "verb", { gain: 0.5 }),
        audio("verb", "speakers"),
      ]
    );
    const [crush, off, verb] = lane(plan, "a").effects;
    expect(crush?.outputGain).toBeCloseTo(0.25);
    expect(off?.outputGain).toBe(1);
    // Below 100% mix the pre trim misses the dry path, so it stays at unity.
    expect(verb?.inputGain).toBe(1);
  });

  test("a mute before a part-wet first FX also silences its dry path", () => {
    const plan = build(
      [
        station("a"),
        fx("verb", "cheapReverb", { dryWet: 0.5, enabled: true }),
        speakers,
      ],
      [audio("a", "verb", { muted: true }), audio("verb", "speakers")]
    );
    const [verb] = lane(plan, "a").effects;
    expect(verb?.signalGain).toBe(0);
    expect(verb?.inputGain).toBe(1);
    expect(verb?.outputGain).toBe(0);
  });

  test.each([0, 0.5, 1])(
    "leading Gain and cable trim affect dry and wet audio at mix %p",
    (dryWet) => {
      const plan = build(
        [
          station("a"),
          node("trim", "gain", { gainDb: -6 }),
          fx("tool", "stereoTool", {
            dryWet,
            enabled: true,
            panLaw: "linear",
            volume: 6,
          }),
          speakers,
        ],
        [
          audio("a", "trim", { gain: 0.5 }),
          audio("trim", "tool"),
          audio("tool", "speakers"),
        ]
      );
      const lowered = lane(plan, "a");
      const output = render(lowered.effects);
      const level = 0.5 * 10 ** (-6 / 20);
      expect(output).toBeCloseTo(
        0.2 * level * (1 - dryWet + 10 ** (6 / 20) * dryWet)
      );
      expect(lowered.layoutSignature).toBe(
        layoutSignature(
          lowered.effects.map((effect) => ({ ...effect, signalGain: 1 }))
        )
      );
    }
  );

  test.each([0, 0.5, 1])(
    "leading trim inside a branch affects both paths at mix %p",
    (dryWet) => {
      const plan = build(
        [
          station("a"),
          fx("split", "fxComposite", { enabled: true }),
          node("trim", "gain", { gainDb: -6 }),
          fx("tool", "stereoTool", {
            dryWet,
            enabled: true,
            panLaw: "linear",
            volume: 6,
          }),
          node("merge", "merge"),
          speakers,
        ],
        [
          audio("a", "split"),
          audio("split", "trim", { from: "branch-1" }),
          audio("trim", "tool", { gain: 0.5 }),
          audio("tool", "merge"),
          audio("merge", "speakers"),
        ]
      );
      expect(plan.issues).toEqual([]);
      const { effects } = lane(plan, "a");
      const [split] = effects;
      if (split?.type !== "fxComposite") {
        throw new Error("Missing compiled Split");
      }
      const branchGain = split.chains[0]?.gain ?? 0;
      const level = 0.5 * 10 ** (-6 / 20);
      expect(render(effects)).toBeCloseTo(
        0.2 *
          branchGain *
          Math.SQRT1_2 *
          level *
          (1 - dryWet + 10 ** (6 / 20) * dryWet)
      );
    }
  );

  test("a dangling FX is skipped until it reaches an output", () => {
    const plan = build(
      [station("a"), fx("verb", "cheapReverb"), speakers],
      [audio("a", "verb")]
    );
    expect(plan.issues).toEqual([]);
    expect(lane(plan, "a").effects).toEqual([]);
    expect(plan.edges.size).toBe(0);
  });
});

describe("native effects in a patch", () => {
  test.each(["filter", "pan"] as const)(
    "%s can follow FX or sit on an independent branch",
    (type) => {
      for (const edges of [
        [
          audio("a", "verb"),
          audio("verb", "native"),
          audio("native", "speakers"),
        ],
        [
          audio("a", "verb"),
          audio("a", "native"),
          audio("verb", "speakers"),
          audio("native", "speakers"),
        ],
      ]) {
        const patch = graph(
          [
            station("a"),
            fx("verb", "cheapReverb"),
            node("native", type),
            speakers,
          ],
          edges
        );
        const candidate = lastEdge(patch);
        expect(
          validateConnection(
            { ...patch, edges: patch.edges.slice(0, -1) },
            candidate
          )
        ).toEqual([]);
        const plan = compile(patch, ENV);
        expect(plan.issues).toEqual([]);
        expect(plan.patch?.nodes.has("native")).toBe(true);
        expect(plan.patch?.edges.size).toBe(edges.length);
        expect([...plan.edges.values()]).toEqual([
          expect.objectContaining({
            from: { id: "a", kind: "lane" },
            to: { id: "speakers", kind: "sink" },
          }),
        ]);
      }
    }
  );
  test("repeated native effects remain separate processors", () => {
    const plan = build(
      [
        station("a"),
        node("f1", "filter", { frequency: 400 }),
        node("f2", "filter", { frequency: 800 }),
        speakers,
      ],
      [audio("a", "f1"), audio("f1", "f2"), audio("f2", "speakers")]
    );
    expect(plan.issues).toEqual([]);
    expect(plan.patch?.nodes.get("f1")?.data).toMatchObject({ frequency: 400 });
    expect(plan.patch?.nodes.get("f2")?.data).toMatchObject({ frequency: 800 });
  });
});

describe("compile: series-parallel regions", () => {
  test("a Split closed by a Merge lowers to fxComposite", () => {
    const plan = build(
      [
        station("a"),
        fx("split", "fxComposite", { enabled: true }),
        fx("verb", "cheapReverb"),
        node("merge", "merge"),
        speakers,
      ],
      [
        audio("a", "split"),
        audio("split", "verb", { from: "branch-1", gain: 0.5 }),
        audio("split", "merge", { from: "branch-2" }),
        audio("verb", "merge"),
        audio("merge", "speakers"),
      ]
    );
    expect(plan.issues).toEqual([]);
    const { effects } = lane(plan, "a");
    expect(shape(effects)).toEqual([
      ["fxComposite", "split", [[["cheapReverb", "verb"]], []]],
    ]);
    const [split] = effects;
    if (split?.type !== "fxComposite") {
      throw new Error("Expected a composite");
    }
    expect(split.chains.map((chain) => chain.id)).toEqual([
      "split:chain-a",
      "split:chain-b",
    ]);
    expect(split.chains[0]?.gain).toBeCloseTo(Math.SQRT1_2 * 0.5);
    expect(split.chains[1]?.gain).toBeCloseTo(Math.SQRT1_2);
    expect(plan.edges.get("merge->speakers")?.from.id).toBe("a");
  });

  test("a Stereo Split lowers to stereoSplit and mutes an unused side", () => {
    const plan = build(
      [
        station("a"),
        fx("lr", "stereoSplit", { enabled: true }),
        fx("crush", "crusher"),
        node("merge", "merge"),
        speakers,
      ],
      [
        audio("a", "lr"),
        audio("lr", "crush", { from: "left" }),
        audio("crush", "merge"),
        audio("merge", "speakers"),
      ]
    );
    expect(plan.issues).toEqual([]);
    const [split] = lane(plan, "a").effects;
    if (split?.type !== "stereoSplit") {
      throw new Error("Expected a stereo split");
    }
    expect(shape([split])).toEqual([
      ["stereoSplit", "lr", [[["crusher", "crush"]], []]],
    ]);
    expect(split.chains.map((chain) => chain.muted)).toEqual([false, true]);
  });

  test("a Band Split lowers to frequencySplit with its crossovers", () => {
    const plan = build(
      [
        station("a"),
        fx("bands", "frequencySplit", { enabled: true }),
        fx("crush", "crusher"),
        node("merge", "merge"),
        speakers,
      ],
      [
        audio("a", "bands"),
        audio("bands", "crush", { from: "band-1" }),
        audio("crush", "merge"),
        audio("bands", "merge", { from: "band-2" }),
        audio("bands", "merge", { from: "band-3" }),
        audio("bands", "merge", { from: "band-4" }),
        audio("merge", "speakers"),
      ].map((edge, index) => ({ ...edge, id: `e${index}` }))
    );
    expect(plan.issues).toEqual([]);
    const [split] = lane(plan, "a").effects;
    if (split?.type !== "frequencySplit") {
      throw new Error("Expected a band split");
    }
    expect(shape([split])).toEqual([
      ["frequencySplit", "bands", [[["crusher", "crush"]], [], [], []]],
    ]);
    expect(split.crossoverFrequencies).toEqual([200, 1000, 5000]);
    expect(split.frequencyBandCount).toBe(4);
  });

  test("a Band Split set to 3 bands lowers to a 3-band frequencySplit in the lane", () => {
    const base = graph(
      [
        station("a"),
        fx("bands", "frequencySplit", { enabled: true }),
        fx("crush", "crusher", { enabled: true }),
        node("merge", "merge"),
        speakers,
      ],
      [
        audio("a", "bands"),
        audio("bands", "crush", { from: "band-1", id: "low" }),
        audio("crush", "merge"),
        audio("bands", "merge", { from: "band-2", id: "mid" }),
        audio("bands", "merge", { from: "band-3", id: "high" }),
        audio("bands", "merge", { from: "band-4", id: "top" }),
        audio("merge", "speakers"),
      ]
    );
    const three = setCrossover(
      setBandCount(base, "bands", 3),
      "bands",
      1,
      3000
    );

    const plan = compile(three, ENV);
    expect(plan.issues).toEqual([]);
    // The fourth band's cable went with its band.
    expect(three.edges.some((edge) => edge.id === "top")).toBe(false);
    const [split] = lane(plan, "a").effects;
    if (split?.type !== "frequencySplit") {
      throw new Error("Expected a band split");
    }
    expect(shape([split])).toEqual([
      ["frequencySplit", "bands", [[["crusher", "crush"]], [], []]],
    ]);
    expect(split.crossoverFrequencies).toEqual([200, 3000]);
    expect(split.frequencyBandCount).toBe(3);
    expect(split.chains.map((chain) => chain.name)).toEqual([
      "Low",
      "Mid",
      "High",
    ]);
    expect(lane(plan, "a").nodes).toEqual(["a", "bands", "crush", "merge"]);
    expect(mergeRoles(three, plan)).toEqual(new Map([["merge", "in-lane"]]));
  });

  test("a branch cable's gain, pan, mute and solo reach its chain", () => {
    const plan = build(
      [
        station("a"),
        fx("lr", "stereoSplit", { enabled: true }),
        node("merge", "merge"),
        speakers,
      ],
      [
        audio("a", "lr"),
        {
          ...audio("lr", "merge", { from: "left", gain: 0.5, id: "left" }),
          pan: -0.75,
          solo: true,
        },
        {
          ...audio("lr", "merge", { from: "right", id: "right", muted: true }),
          pan: 0.25,
        },
        audio("merge", "speakers"),
      ]
    );
    expect(plan.issues).toEqual([]);
    const [split] = lane(plan, "a").effects;
    if (split?.type !== "stereoSplit") {
      throw new Error("Expected a stereo split");
    }
    expect(
      split.chains.map(({ gain, muted, pan, solo }) => ({
        gain,
        muted,
        pan,
        solo,
      }))
    ).toEqual([
      { gain: 0.5, muted: false, pan: -0.75, solo: true },
      { gain: 1, muted: true, pan: 0.25, solo: false },
    ]);
  });

  test("a soloed cable among several on one Split port solos its branch too", () => {
    const plan = build(
      [
        station("a"),
        fx("x", "fxComposite", { enabled: true }),
        fx("delay", "delay"),
        fx("crush", "crusher"),
        fx("fold", "cheapReverb"),
        node("merge", "merge"),
        speakers,
      ],
      [
        audio("a", "x"),
        { ...audio("x", "delay", { from: "branch-1" }), solo: true },
        audio("x", "crush", { from: "branch-1" }),
        audio("x", "fold", { from: "branch-2" }),
        audio("delay", "merge"),
        audio("crush", "merge"),
        audio("fold", "merge"),
        audio("merge", "speakers"),
      ]
    );
    expect(plan.issues).toEqual([]);
    const [split] = lane(plan, "a").effects;
    if (split?.type !== "fxComposite") {
      throw new Error("Expected a composite");
    }
    // Branch 2 goes quiet behind the soloed Branch 1 ...
    expect(split.chains.map((chain) => chain.solo)).toEqual([true, false]);
    // ... and inside Branch 1 only the soloed cable plays.
    const [fanOut] = split.chains[0]?.effects ?? [];
    if (fanOut?.type !== "fxComposite") {
      throw new Error("Expected a nested fan-out");
    }
    expect(fanOut.chains.map((chain) => chain.solo)).toEqual([true, false]);
  });

  test("an implicit fan-out ignores pan and solo the canvas can't show", () => {
    const plan = build(
      [
        station("a"),
        fx("delay", "delay"),
        fx("crush", "crusher"),
        node("merge", "merge"),
        speakers,
      ],
      [
        { ...audio("a", "delay"), pan: -1, solo: true },
        audio("a", "crush"),
        audio("delay", "merge"),
        audio("crush", "merge"),
        audio("merge", "speakers"),
      ]
    );
    expect(plan.issues).toEqual([]);
    const [fanOut] = lane(plan, "a").effects;
    if (fanOut?.type !== "fxComposite") {
      throw new Error("Expected an implicit fan-out");
    }
    expect(fanOut.chains.map(({ pan, solo }) => ({ pan, solo }))).toEqual([
      { pan: 0, solo: false },
      { pan: 0, solo: false },
    ]);
  });

  test("a Split's third branch mixes at the same level as its first two", () => {
    const plan = build(
      [
        station("a"),
        fx("split", "fxComposite", { enabled: true }),
        node("merge", "merge"),
        speakers,
      ],
      [
        audio("a", "split"),
        audio("split", "merge", { from: "branch-1", id: "one" }),
        audio("split", "merge", { from: "branch-2", id: "two" }),
        audio("split", "merge", { from: "branch-3", id: "three" }),
        audio("merge", "speakers"),
      ]
    );
    expect(plan.issues).toEqual([]);
    const [split] = lane(plan, "a").effects;
    if (split?.type !== "fxComposite") {
      throw new Error("Expected a split");
    }
    expect(split.chains.map((chain) => chain.gain)).toEqual([
      Math.SQRT1_2,
      Math.SQRT1_2,
      Math.SQRT1_2,
    ]);
  });

  test("a Merge sums two stations into one shared bus", () => {
    const merged = graph(
      [station("a"), station("b"), node("merge", "merge"), speakers],
      [audio("a", "merge"), audio("b", "merge"), audio("merge", "speakers")]
    );
    const plan = compile(merged, ENV);

    expect(mergeRoles(merged, plan)).toEqual(new Map([["merge", "bus"]]));
    expect(plan.issues).toEqual([]);
    expect(plan.patch?.nodes.has("merge")).toBe(true);
    expect(plan.edges.size).toBe(2);
  });

  test("an implicit fan-out that rejoins is treated as a Split", () => {
    const plan = build(
      [
        station("a"),
        fx("verb", "cheapReverb"),
        fx("crush", "crusher"),
        node("merge", "merge"),
        speakers,
      ],
      [
        audio("a", "verb"),
        audio("a", "crush", { muted: true }),
        audio("a", "merge", { gain: 0.25 }),
        audio("verb", "merge"),
        audio("crush", "merge"),
        audio("merge", "speakers"),
      ]
    );
    expect(plan.issues).toEqual([]);
    const [split] = lane(plan, "a").effects;
    if (split?.type !== "fxComposite") {
      throw new Error("Expected a composite");
    }
    expect(shape([split])).toEqual([
      [
        "fxComposite",
        "a:fan-out",
        [[["cheapReverb", "verb"]], [["crusher", "crush"]], []],
      ],
    ]);
    expect(split.enabled).toBe(true);
    expect(
      split.chains.map(({ gain, id, muted }) => ({ gain, id, muted }))
    ).toEqual([
      { gain: 1, id: "a:fan-out:a->verb", muted: false },
      { gain: 1, id: "a:fan-out:a->crush", muted: true },
      { gain: 0.25, id: "a:fan-out:a->merge", muted: false },
    ]);
  });

  test("a made-up fan-out id never takes a node's or a chain's id", () => {
    const plan = build(
      [
        station("a"),
        fx("a:fan-out", "cheapReverb", { enabled: true }),
        fx("crush", "crusher", { enabled: true }),
        node("merge", "merge"),
        speakers,
      ],
      [
        audio("a", "a:fan-out", { id: "e" }),
        audio("a", "crush", { id: "f" }),
        audio("a:fan-out", "merge"),
        audio("crush", "merge"),
        audio("merge", "speakers"),
      ]
    );
    expect(plan.issues).toEqual([]);
    const { effects } = lane(plan, "a");
    expect(shape(effects)).toEqual([
      [
        "fxComposite",
        "a:fan-out~2",
        [[["cheapReverb", "a:fan-out"]], [["crusher", "crush"]]],
      ],
    ]);
    const ids = effectIds(effects);
    expect(new Set(ids).size).toBe(ids.length);
    const [split] = effects;
    expect(
      split && "chains" in split ? split.chains.map((chain) => chain.id) : []
    ).toEqual(["a:fan-out~2:e", "a:fan-out~2:f"]);
  });

  test("regions nest, and branches may share their Merge", () => {
    const plan = build(
      [
        station("a"),
        fx("pre", "crusher"),
        fx("verb", "cheapReverb"),
        fx("echo", "delay"),
        node("merge", "merge"),
        speakers,
      ],
      [
        audio("a", "pre"),
        audio("a", "merge"),
        audio("pre", "verb"),
        audio("pre", "echo"),
        audio("verb", "merge"),
        audio("echo", "merge"),
        audio("merge", "speakers"),
      ]
    );
    expect(plan.issues).toEqual([]);
    expect(shape(lane(plan, "a").effects)).toEqual([
      [
        "fxComposite",
        "a:fan-out",
        [
          [
            ["crusher", "pre"],
            [
              "fxComposite",
              "pre:fan-out",
              [[["cheapReverb", "verb"]], [["delay", "echo"]]],
            ],
          ],
          [],
        ],
      ],
    ]);
  });

  test("branches that leave the lane without a Merge reach outputs independently", () => {
    const plan = build(
      [station("a"), fx("verb", "cheapReverb"), speakers],
      [audio("a", "verb"), audio("a", "speakers"), audio("verb", "speakers")]
    );
    expect(codes(plan)).toEqual([]);
    expect(plan.edges.size).toBe(1);
  });

  test("a Merge that joins branches of different splits is routed without copying shared nodes", () => {
    const plan = build(
      [
        station("a"),
        fx("x", "crusher"),
        fx("y", "fold"),
        node("m1", "merge"),
        node("m2", "merge"),
        node("m3", "merge"),
        speakers,
      ],
      [
        audio("a", "x"),
        audio("a", "y"),
        audio("x", "m1"),
        audio("x", "m2"),
        audio("y", "m1"),
        audio("y", "m2"),
        audio("m1", "m3"),
        audio("m2", "m3"),
        audio("m3", "speakers"),
      ]
    );
    expect(codes(plan)).toEqual([]);
  });

  /** `levels` splits inside each other, each an implicit fan-out. */
  function nested(levels: number) {
    const nodes: NodeInput[] = [station("a"), speakers];
    const edges: EdgeInput[] = [audio("a", "f1")];
    for (let level = 1; level <= levels + 1; level += 1) {
      nodes.push(fx(`f${level}`, "crusher"));
    }
    for (let level = 1; level <= levels; level += 1) {
      nodes.push(node(`m${level}`, "merge"));
      edges.push(
        audio(`f${level}`, `f${level + 1}`),
        audio(`f${level}`, `m${level}`)
      );
      edges.push(
        level === levels
          ? audio(`f${level + 1}`, `m${level}`)
          : audio(`m${level + 1}`, `m${level}`)
      );
    }
    edges.push(audio("m1", "speakers"));
    return build(nodes, edges);
  }

  test("splits nest up to depth 8", () => {
    const plan = nested(8);
    expect(plan.issues).toEqual([]);
    const { effects } = lane(plan, "a");
    expect(() => normalizeEffectTree(effects)).not.toThrow();
    expect(effectIds(effects)).toContain("f9");
    expect(plan.edges.has("m1->speakers")).toBe(true);
  });

  test("depth 9 uses explicit graph routing", () => {
    const plan = nested(9);
    expect(codes(plan)).toEqual([]);
    expect(lane(plan, "a").effects).toEqual([]);
    expect(plan.edges.size).toBe(1);
  });

  test("5 bands are rejected", () => {
    const patch = graph(
      [
        station("a"),
        fx("bands", "frequencySplit", { enabled: true }),
        node("merge", "merge"),
        speakers,
      ],
      [
        audio("a", "bands"),
        audio("bands", "merge", { from: "band-1", id: "b1" }),
        audio("bands", "merge", { from: "band-2", id: "b2" }),
        audio("merge", "speakers"),
      ]
    );
    // A stored config the schema would refuse, as a hostile import might.
    const bands = patch.nodes.find((entry) => entry.id === "bands");
    if (bands?.type !== "frequencySplit") {
      throw new Error("Expected a band split");
    }
    const effect = bands.data.effect as FrequencySplitConfig;
    const [chain] = effect.chains;
    if (!chain) {
      throw new Error("Expected a chain");
    }
    bands.data.effect = {
      ...effect,
      chains: [0, 1, 2, 3, 4].map((order) => ({
        ...chain,
        id: `band-${order}`,
        order,
      })),
      crossoverFrequencies: [100, 400, 1600, 6400],
    };
    const plan = compile(patch, ENV);
    expect(codes(plan)).toEqual(["split-branches@bands"]);
    expect(plan.issues[0]?.message).toBe(
      "Band Split needs 2 to 4 ordered bands with one chain per band"
    );
  });

  test("an implicit fan-out accepts five independent branches", () => {
    const ids = ["v1", "v2", "v3", "v4", "v5"];
    const plan = build(
      [
        station("a"),
        ...ids.map((id) => fx(id, "crusher")),
        node("merge", "merge"),
        speakers,
      ],
      [
        ...ids.flatMap((id) => [audio("a", id), audio(id, "merge")]),
        audio("merge", "speakers"),
      ]
    );
    expect(codes(plan)).toEqual([]);
  });

  test("every lowered FX keeps its node id", () => {
    const plan = build(
      [
        station("a"),
        fx("split", "fxComposite", { enabled: true }),
        fx("verb", "cheapReverb"),
        fx("lr", "stereoSplit", { enabled: true }),
        fx("crush", "crusher"),
        node("inner", "merge"),
        node("outer", "merge"),
        fx("comp", "compressor"),
        speakers,
      ],
      [
        audio("a", "split"),
        audio("split", "verb", { from: "branch-1" }),
        audio("verb", "outer"),
        audio("split", "lr", { from: "branch-2" }),
        audio("lr", "crush", { from: "left" }),
        audio("lr", "inner", { from: "right" }),
        audio("crush", "inner"),
        audio("inner", "outer"),
        audio("outer", "comp"),
        audio("comp", "speakers"),
      ]
    );
    expect(plan.issues).toEqual([]);
    expect(effectIds(lane(plan, "a").effects).sort()).toEqual(
      ["comp", "crush", "lr", "split", "verb"].sort()
    );
  });
});

describe("compile: exact key cables", () => {
  test("several processed or summed signals can key several FX independently", () => {
    const patch = graph(
      [
        station("a"),
        station("b"),
        node("mix", "merge"),
        node("trim", "gain", { gainDb: -6 }),
        fx("comp", "compressor", { enabled: true }),
        fx("gate", "gate", { enabled: true }),
        speakers,
      ],
      [
        audio("a", "mix"),
        audio("b", "mix"),
        audio("mix", "trim"),
        audio("trim", "comp"),
        audio("comp", "gate"),
        audio("gate", "speakers"),
        key("a", "comp"),
        key("b", "comp"),
        key("trim", "gate"),
      ]
    );
    const plan = compile(patch, ENV);
    expect(plan.issues).toEqual([]);
    expect(plan.patch?.edges.size).toBe(patch.edges.length);
    expect(idleKeys(patch, plan).size).toBe(0);
    const muted = {
      ...patch,
      edges: patch.edges.map((edge) =>
        edge.id === "a~>comp" ? { ...edge, muted: true } : edge
      ),
    };
    expect([...idleKeys(muted, compile(muted, ENV))]).toEqual([
      ["a~>comp", "This key cable is off"],
    ]);
  });
  test.each(["self", "noise-pink", "external"] as const)(
    "a key leaves the authored %s vocoder mode intact across remove and undo",
    (modulatorSource) => {
      const patch = graph(
        [
          station("a"),
          station("talk"),
          fx("v", "vocoder", { modulatorSource }),
          speakers,
        ],
        [audio("a", "v"), audio("v", "speakers"), key("talk", "v")]
      );
      const store = createNodeStore(patch);
      expect(compile(patch, ENV).patch?.nodes.get("v")?.data).toMatchObject({
        effect: { modulatorSource },
      });
      commitNodeGraph(
        (current) => removeEdges(current, ["talk~>v"]),
        store,
        "snapshot"
      );
      expect(
        lane(compile(store.state.graph ?? patch, ENV), "a").effects[0]
      ).toMatchObject({ modulatorSource });
      undoNodeGraph(store);
      expect(
        compile(store.state.graph ?? patch, ENV).patch?.edges.has("talk~>v")
      ).toBe(true);
    }
  );
  test("disabled FX and empty key sources report an idle reason", () => {
    const patch = graph(
      [
        station("a"),
        station("talk", false),
        fx("v", "vocoder", { enabled: false }),
        speakers,
      ],
      [audio("a", "v"), audio("v", "speakers"), key("talk", "v")]
    );
    expect(idleKeys(patch, compile(patch, ENV)).get("talk~>v")).toBe(
      "The station slot is empty"
    );
    const live = graph(
      [
        station("a"),
        station("talk"),
        fx("v", "vocoder", { enabled: false }),
        speakers,
      ],
      patch.edges
    );
    expect(idleKeys(live, compile(live, ENV)).get("talk~>v")).toBe(
      "Switch the effect on to use its key"
    );
  });
});

describe("compile: backend estimate", () => {
  function fxLanes(count: number, env: Partial<CompileEnv> = {}) {
    const ids = Array.from({ length: count }, (_, index) => `s${index + 1}`);
    return build(
      [
        ...ids.flatMap((id) => [
          station(id),
          fx(`${id}-comp`, "compressor", { enabled: true }),
        ]),
        speakers,
      ],
      ids.flatMap((id) => [
        audio(id, `${id}-comp`),
        audio(`${id}-comp`, "speakers"),
      ]),
      env
    );
  }

  test("a lane of openDAW FX is official when cross-origin isolated", () => {
    const plan = fxLanes(1);
    expect(lane(plan, "s1").backend).toBe("official");
    expect(plan.budget.monitoringChannels).toBe(2);
  });

  test("it flips to compat when crossOriginIsolated is false", () => {
    const plan = fxLanes(1, { crossOriginIsolated: false });
    expect(lane(plan, "s1").backend).toBe("compat");
    expect(plan.budget.monitoringChannels).toBe(0);
  });

  test("it flips to compat past the 8 monitoring channels", () => {
    const plan = fxLanes(5);
    expect([...plan.lanes.values()].map((entry) => entry.backend)).toEqual([
      "official",
      "official",
      "official",
      "official",
      "compat",
    ]);
    expect(plan.budget.monitoringChannels).toBe(MONITORING_CHANNEL_CAP);
  });

  test("keyed patches allocate their effects as graph processors", () => {
    // The runtime registers the keying lane as an openDAW input as well.
    const plan = build(
      [
        station("talk"),
        ...["s1", "s2", "s3"].flatMap((id) => [
          station(id),
          fx(`${id}-comp`, "compressor", { enabled: true }),
        ]),
        station("music"),
        fx("duck", "compressor", { enabled: true }),
        speakers,
      ],
      [
        audio("talk", "speakers"),
        ...["s1", "s2", "s3"].flatMap((id) => [
          audio(id, `${id}-comp`),
          audio(`${id}-comp`, "speakers"),
        ]),
        audio("music", "duck"),
        audio("duck", "speakers"),
        key("talk", "duck"),
      ]
    );
    expect(lane(plan, "talk").backend).toBeNull();
    expect(lane(plan, "music").backend).toBeNull();
    expect(plan.budget.monitoringChannels).toBe(0);
  });

  test("a processed key uses a shared graph processor", () => {
    const plan = build(
      [
        station("music"),
        fx("duck", "compressor", { enabled: true }),
        station("talk"),
        fx("talk-comp", "compressor", { enabled: true }),
        speakers,
      ],
      [
        audio("music", "duck"),
        audio("duck", "speakers"),
        audio("talk", "talk-comp"),
        audio("talk-comp", "speakers"),
        key("talk", "duck"),
      ]
    );
    expect(lane(plan, "music").backend).toBeNull();
    expect(lane(plan, "talk").backend).toBeNull();
    expect(plan.budget.monitoringChannels).toBe(0);
  });

  test("radio-only FX force compat, and a dry lane has no FX runtime", () => {
    const plan = build(
      [
        station("a"),
        fx("limit", "limiter", { enabled: true }),
        station("b"),
        fx("off", "compressor"),
        speakers,
      ],
      [
        audio("a", "limit"),
        audio("limit", "speakers"),
        audio("b", "off"),
        audio("off", "speakers"),
      ]
    );
    expect(lane(plan, "a").backend).toBe("compat");
    expect(lane(plan, "b").backend).toBeNull();
  });
});

describe("compile: validation first", () => {
  test("refused cables and nodes never reach the plan", () => {
    const plan = build(
      [station("a"), station("b"), fx("code", "werkstatt"), speakers],
      [
        audio("a", "code"),
        audio("code", "speakers"),
        {
          id: "bad",
          source: "b",
          sourceHandle: "out:audio",
          target: "speakers",
          targetHandle: "in:audio:main",
        },
      ]
    );
    expect(codes(plan)).toEqual(["unshipped@code", "bad-handle@bad"]);
    expect(lane(plan, "a").effects).toEqual([]);
    expect(plan.edges.size).toBe(0);
  });

  test("shared effects run on a bus", () => {
    const plan = build(
      [
        station("a"),
        station("b"),
        node("bus", "merge"),
        fx("verb", "cheapReverb"),
        speakers,
      ],
      [
        audio("a", "bus"),
        audio("b", "bus"),
        audio("bus", "verb"),
        audio("verb", "speakers"),
      ],
      { release: "v2" }
    );
    expect(codes(plan)).toEqual([]);
    expect([...plan.lanes.keys()]).toEqual(["a", "b"]);
    expect(plan.edges.size).toBe(2);
  });

  test("an issue a dropped node uncovers is reported too", () => {
    const ids = Array.from({ length: 25 }, (_, index) => `s${index + 1}`);
    const plan = build(
      [...ids.map((id) => station(id)), fx("comp", "compressor"), speakers],
      [audio("s25", "comp"), audio("comp", "speakers"), key("s1", "comp")]
    );
    // s25 is over the source budget; without it the key has no lane to key.
    expect(codes(plan)).toEqual(["budget-sources@s25"]);
    expect(plan.lanes.has("s25")).toBe(false);
    expect(plan.edges.size).toBe(0);
  });

  test("the playing budget keeps the lane in the plan", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const plan = build(
      [...ids.map((id) => station(id)), speakers],
      ids.map((id) => audio(id, "speakers")),
      { playing: ids, profile: "mobile" }
    );
    expect(codes(plan)).toEqual(["budget-playing@e"]);
    expect(plan.lanes.has("e")).toBe(true);
    expect(plan.edges.has("e->speakers")).toBe(true);
  });
});

describe("layoutSignature", () => {
  const verb = createNodeEffectConfig("cheapReverb", "verb");
  const crush = { ...createNodeEffectConfig("crusher", "crush"), order: 1 };

  test("ignores params", () => {
    expect(layoutSignature([verb, crush])).toBe(
      layoutSignature([{ ...verb, decay: 0.9, dryWet: 0.3 }, crush])
    );
  });

  test("changes with ids, order and chains", () => {
    const base = layoutSignature([verb, crush]);
    expect(layoutSignature([verb])).not.toBe(base);
    expect(
      layoutSignature([
        { ...crush, order: 0 },
        { ...verb, order: 1 },
      ])
    ).not.toBe(base);
    const split = createNodeEffectConfig("fxComposite", "split");
    const [first, second] = split.chains;
    if (!(first && second)) {
      throw new Error("Expected two chains");
    }
    expect(
      layoutSignature([
        { ...split, chains: [{ ...first, effects: [verb] }, second] },
      ])
    ).not.toBe(layoutSignature([split]));
  });
});
