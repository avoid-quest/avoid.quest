import { describe, expect, test } from "bun:test";
import { convertEffectConfigToEngine } from "@/lib/audio/dsp/effects/engine-conversion";
import { MAX_MONITORING_CHANNELS } from "@/lib/audio/dsp/effects/official-opendaw-mapping";
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
  endpointKey,
  idleKeys,
  isSoloActive,
  isSourceLive,
  type LanePlan,
  laneChannelId,
  layoutSignature,
  mergeRoles,
} from "./compile";
import mainFixtures from "./compile-main-fixtures.json";
import {
  connectNodes,
  removeEdges,
  removeNodes,
  setEffectParams,
} from "./graph-edits";
import {
  commitNodeGraph,
  createNodeStore,
  redoNodeGraph,
  undoNodeGraph,
} from "./node-store";
import {
  type GraphEdge,
  type NodeGraph,
  type NodeGraphInput,
  type NodeType,
  nodeGraphSchema,
} from "./schema";
import { deriveNodeChannels } from "./session-channels";
import { forgetLocalFileUrls, keepLocalFileUrl } from "./sources";
import { validate, validateConnection } from "./validate";

type NodeInput = NodeGraphInput["nodes"][number];
type EdgeInput = NodeGraphInput["edges"][number];

const position = { x: 0, y: 0 };

function station(
  id: string,
  radio = true
): Extract<NodeInput, { type: "station" }> {
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

/** JSON with every object's keys sorted, so field order doesn't count. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([left], [right]) =>
            left < right ? -1 : Number(left > right)
          )
        )
      : entry
  );
}

/** A polynomial hash mod 2^61 − 1 over canonical JSON: the fixture's. */
function fingerprint(value: unknown): string {
  const text = canonical(value);
  const modulus = 2n ** 61n - 1n;
  let hash = 0n;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 131n + BigInt(text.charCodeAt(index))) % modulus;
  }
  return hash.toString(36);
}

/**
 * A plan's lane inserts and routes, as main's compiler wrote them. Main
 * named a key by its station's channel; a key cable is no route.
 */
function lanePlans(
  plan: EnginePlan,
  patch: Pick<NodeGraph, "nodes" | "edges">
): string {
  const keyedBy = new Map(
    patch.edges
      .filter((edge) => edge.targetHandle === "in:sidechain:key")
      .map((edge) => [edge.target, laneChannelId(edge.source)])
  );
  const asMain = (effects: readonly EffectConfig[]): EffectConfig[] =>
    effects.map(
      (effect) =>
        ({
          ...effect,
          ...(effect.sidechain
            ? { sidechain: { channelId: keyedBy.get(effect.id) } }
            : {}),
          ...("chains" in effect
            ? {
                chains: effect.chains.map((chain) => ({
                  ...chain,
                  effects: asMain(chain.effects),
                })),
              }
            : {}),
        }) as EffectConfig
    );
  return fingerprint({
    edges: [...plan.cables.values()]
      .filter((cable) => cable.kind === "audio")
      .map((cable) => ({
        from: cable.from.id,
        gain: cable.gain,
        id: cable.id,
        muted: cable.muted,
        to: cable.to.id,
      })),
    lanes: [...plan.lanes.values()].map((entry) => ({
      backend: entry.backend,
      effects: asMain(entry.effects),
      filter: entry.filter,
      id: entry.id,
      layoutSignature: entry.layoutSignature,
      nodes: entry.nodes,
      pan: entry.pan,
    })),
    monitoringChannels: plan.monitoringChannels,
  });
}

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

/** Every cable as `from>to`, sorted. */
function routes(plan: EnginePlan): string[] {
  return [...plan.cables.values()]
    .map(({ from, to }) => `${from.kind}:${from.id}>${to.kind}:${to.id}`)
    .sort();
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
    expect(plan.cables.get("a->speakers")).toEqual({
      delay: 0,
      edges: ["a->speakers"],
      from: { id: "a", kind: "lane" },
      gain: 1,
      id: "a->speakers",
      kind: "audio",
      muted: false,
      reenters: false,
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
    expect([...plan.cables.keys()]).toEqual(["a->speakers"]);
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
      [...plan.cables.values()].map((edge) => `${edge.from.id}>${edge.to.id}`)
    ).toEqual(["a>desk", "a>speakers"]);
  });

  test("several Output device nodes on one device keep independent routes", () => {
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
    expect(
      [...plan.cables.values()].map((edge) => `${edge.from.id}>${edge.to.id}`)
    ).toEqual(["a>desk", "a>booth"]);
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
      expect(plan.cables.get("track->speakers")?.to.id).toBe("speakers");
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
    expect(plan.cables.get("warm->speakers")?.gain).toBeCloseTo(
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
      [...soloed.cables.values()].map((edge) => [edge.id, edge.muted])
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
    expect([...unsoloed.cables.values()].every((edge) => !edge.muted)).toBe(
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
    expect(plan.cables.get("b->speakers")?.muted).toBe(false);
  });

  test("a solo names the sources it mutes, from the patch the plan keeps", () => {
    const plan = build(
      [withStrip(station("a"), { solo: true }), station("b"), speakers],
      [audio("a", "speakers"), audio("b", "speakers")]
    );
    expect(plan.soloedOut.sources).toEqual(new Set(["b"]));

    // s25 is over the source budget, so its solo silences nothing.
    const ids = Array.from({ length: 25 }, (_, index) => `s${index + 1}`);
    const over = build(
      [
        ...ids.map((id) =>
          id === "s25" ? withStrip(station(id), { solo: true }) : station(id)
        ),
        speakers,
      ],
      ids.map((id) => audio(id, "speakers"))
    );
    expect(over.soloedOut.sources).toEqual(new Set());
    expect(over.cables.get("s1->speakers")?.muted).toBe(false);
  });

  test("a split's solo names the branch cables it leaves out, as its chains run", () => {
    const split = (enabled: boolean, soloed: EdgeInput) =>
      build(
        [
          station("a"),
          fx("x", "fxComposite", { enabled }),
          fx("delay", "delay"),
          fx("fold", "cheapReverb"),
          fx("dead", "crusher"),
          node("merge", "merge"),
          speakers,
        ],
        [
          audio("a", "x"),
          audio("x", "fold", { from: "branch-2" }),
          audio("delay", "merge"),
          audio("fold", "merge"),
          audio("merge", "speakers"),
          { ...soloed, solo: true },
        ]
      ).soloedOut.branches;
    const toDelay = audio("x", "delay", { from: "branch-1" });
    expect(split(true, toDelay)).toEqual(new Set(["x->fold"]));
    // A switched-off split runs no chains, so its solo leaves nothing out.
    expect(split(false, toDelay)).toEqual(new Set());
    // A soloed cable that reaches no output is skipped, and solos nothing.
    expect(split(true, audio("x", "dead", { from: "branch-1" }))).toEqual(
      new Set()
    );
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
    expect(plan.cables.get("crush->speakers")?.from).toEqual({
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

  test("a Filter after FX runs as its own module after the fader", () => {
    const plan = build(
      [
        station("a"),
        fx("verb", "cheapReverb"),
        node("cut", "filter", { frequency: 900, Q: 2, type: "lowpass" }),
        speakers,
      ],
      [audio("a", "verb"), audio("verb", "cut"), audio("cut", "speakers")]
    );
    expect(plan.issues).toEqual([]);
    expect(shape(lane(plan, "a").effects)).toEqual([["cheapReverb", "verb"]]);
    expect(lane(plan, "a").filter).toBeNull();
    expect(plan.modules.get("filter:cut")).toEqual({
      filter: { frequency: 900, Q: 2, type: "lowpass" },
      id: "cut",
      kind: "filter",
      realtime: false,
    });
    expect(routes(plan)).toEqual([
      "filter:cut>sink:speakers",
      "lane:a>filter:cut",
    ]);
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
    expect(plan.cables.get("out->speakers")?.gain).toBeCloseTo(
      2 * 10 ** (6 / 20)
    );
  });

  test("a muted cable before an FX silences its input", () => {
    const plan = build(
      [station("a"), fx("verb", "cheapReverb", { enabled: true }), speakers],
      [audio("a", "verb", { muted: true }), audio("verb", "speakers")]
    );
    expect(lane(plan, "a").effects[0]?.signalGain).toBe(0);
    expect(plan.cables.get("verb->speakers")?.muted).toBe(true);
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
      expect(plan.cables.get("verb->speakers")?.muted).toBe(true);
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
    expect(plan.cables.get("verb->speakers")).toMatchObject({
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
    expect(plan.cables.size).toBe(0);
  });
});

describe("Filter and Pan: connection and compile agree", () => {
  test.each(["filter", "pan"] as const)(
    "a %s after FX connects whichever cable comes last, and runs as a module",
    (type) => {
      const patch = graph(
        [station("a"), fx("crush", "crusher"), node("native", type), speakers],
        [
          audio("a", "crush"),
          audio("crush", "native"),
          audio("native", "speakers"),
        ]
      );
      for (const connection of patch.edges) {
        expect(
          validateConnection(
            {
              ...patch,
              edges: patch.edges.filter((edge) => edge !== connection),
            },
            connection
          )
        ).toEqual([]);
      }
      const plan = compile(patch, ENV);
      expect(plan.issues).toEqual([]);
      expect(plan.modules.get(`${type}:native`)?.kind).toBe(type);
      expect(routes(plan)).toEqual(
        [`lane:a>${type}:native`, `${type}:native>sink:speakers`].sort()
      );
    }
  );

  test("repeated Filter and Pan stay at their cabled positions after FX", () => {
    const plan = compile(
      graph(
        [
          station("a"),
          node("low", "filter", { frequency: 120, type: "highpass" }),
          fx("verb", "cheapReverb"),
          node("high", "filter", { frequency: 6000, type: "lowpass" }),
          node("wide", "pan", { pan: -0.5 }),
          speakers,
        ],
        [
          audio("a", "low"),
          audio("low", "verb"),
          audio("verb", "high"),
          audio("high", "wide"),
          audio("wide", "speakers"),
        ]
      ),
      ENV
    );
    expect(plan.issues).toEqual([]);
    // The leading Filter stays on the strip, before the insert.
    expect(lane(plan, "a").filter).toMatchObject({ frequency: 120 });
    expect(shape(lane(plan, "a").effects)).toEqual([["cheapReverb", "verb"]]);
    expect(plan.modules.get("filter:high")).toMatchObject({
      filter: { frequency: 6000, type: "lowpass" },
      kind: "filter",
    });
    expect(plan.modules.get("pan:wide")).toMatchObject({
      kind: "pan",
      pan: -0.5,
    });
    expect(routes(plan)).toEqual([
      "filter:high>pan:wide",
      "lane:a>filter:high",
      "pan:wide>sink:speakers",
    ]);
  });

  test.each(["filter", "pan"] as const)(
    "a %s on a Split branch makes the Split a stage whose ports route on their own",
    (type) => {
      const patch = graph(
        [
          station("a"),
          fx("split", "fxComposite", { enabled: true }),
          node("native", type),
          node("merge", "merge"),
          speakers,
        ],
        [
          audio("a", "split"),
          audio("split", "native", { from: "branch-1" }),
          audio("split", "merge", { from: "branch-2" }),
          audio("native", "merge"),
          audio("merge", "speakers"),
        ]
      );
      const plan = compile(patch, ENV);
      expect(plan.issues).toEqual([]);
      expect(plan.modules.get("split:split")).toMatchObject({
        kind: "split",
        split: { cabled: [0, 1] },
      });
      expect(
        [...plan.cables.values()]
          .filter((cable) => cable.from.kind === "split")
          .map((cable) => [cable.from.port, endpointKey(cable.to)])
      ).toEqual([
        [0, `${type}:native`],
        [1, "sum:merge"],
      ]);
    }
  );

  test.each(["filter", "pan"] as const)(
    "a %s on one of a station's own branches is a module the other skips",
    (type) => {
      const plan = compile(
        graph(
          [
            station("a"),
            node("native", type),
            node("merge", "merge"),
            speakers,
          ],
          [
            audio("a", "native"),
            audio("a", "merge"),
            audio("native", "merge"),
            audio("merge", "speakers"),
          ]
        ),
        ENV
      );
      expect(plan.issues).toEqual([]);
      expect(lane(plan, "a").effects).toEqual([]);
      expect(routes(plan)).toEqual(
        [
          `lane:a>${type}:native`,
          "lane:a>sum:merge",
          `${type}:native>sum:merge`,
          "sum:merge>sink:speakers",
        ].sort()
      );
    }
  );

  test("allows building a dangling native path while another path plays", () => {
    const patch = graph(
      [station("a"), fx("crush", "crusher"), node("cut", "filter"), speakers],
      [audio("a", "speakers"), audio("a", "crush")]
    );
    const connection = lastEdge(graph(patch.nodes, [audio("crush", "cut")]));
    expect(validateConnection(patch, connection)).toEqual([]);
    const complete = { ...patch, edges: [...patch.edges, connection] };
    const plan = compile(complete, ENV);
    expect(plan.issues).toEqual(validate(complete));
    expect(plan.issues).toEqual([]);
    expect([...plan.cables.keys()]).toEqual(["a->speakers"]);
  });

  test.each([
    ["filter", "pan"],
    ["pan", "filter"],
  ] as const)("allows leading native order %s then %s", (first, second) => {
    const patch = graph(
      [
        station("a"),
        node("trim", "gain"),
        node("first", first),
        node("second", second),
        fx("crush", "crusher"),
        speakers,
      ],
      [
        audio("a", "trim"),
        audio("trim", "first"),
        audio("first", "second"),
        audio("second", "crush"),
        audio("crush", "speakers"),
      ]
    );
    for (const connection of patch.edges) {
      expect(
        validateConnection(
          {
            ...patch,
            edges: patch.edges.filter((edge) => edge !== connection),
          },
          connection
        )
      ).toEqual([]);
    }
    const plan = compile(patch, ENV);
    expect(plan.issues).toEqual(validate(patch));
    expect(plan.issues).toEqual([]);
    expect(plan.cables.size).toBe(1);
    expect(lane(plan, "a").filter).not.toBeNull();
  });

  test("a dangling branch does not move a leading native node into a branch", () => {
    const patch = graph(
      [station("a"), node("cut", "filter"), fx("crush", "crusher"), speakers],
      [audio("a", "cut"), audio("cut", "speakers")]
    );
    const connection = lastEdge(graph(patch.nodes, [audio("a", "crush")]));
    expect(validateConnection(patch, connection)).toEqual([]);
    const complete = { ...patch, edges: [...patch.edges, connection] };
    const plan = compile(complete, ENV);
    expect(plan.issues).toEqual(validate(complete));
    expect(plan.issues).toEqual([]);
    expect(plan.cables.size).toBe(1);
    expect(lane(plan, "a").filter).not.toBeNull();
  });

  test("a Filter on a station's second path to Speakers filters that path only", () => {
    const patch = graph(
      [station("a"), station("b"), node("cut", "filter"), speakers],
      [
        audio("a", "speakers"),
        audio("b", "speakers"),
        audio("a", "cut"),
        audio("cut", "speakers"),
      ]
    );
    const connection = lastEdge(patch);
    expect(
      validateConnection(
        { ...patch, edges: patch.edges.slice(0, -1) },
        connection
      )
    ).toEqual([]);
    const plan = compile(patch, ENV);
    expect(plan.issues).toEqual([]);
    expect(routes(plan)).toEqual([
      "filter:cut>sink:speakers",
      "lane:a>filter:cut",
      "lane:a>sink:speakers",
      "lane:b>sink:speakers",
    ]);
  });
});

describe("Filter and Pan between FX", () => {
  test("a Filter between FX runs inside the chain as Revamp's pass filter", () => {
    const plan = compile(
      graph(
        [
          station("a"),
          fx("verb", "cheapReverb"),
          node("tone", "filter", { frequency: 900, Q: 6, type: "highpass" }),
          fx("echo", "delay"),
          speakers,
        ],
        [
          audio("a", "verb"),
          audio("verb", "tone"),
          audio("tone", "echo"),
          audio("echo", "speakers"),
        ]
      ),
      ENV
    );
    expect(plan.issues).toEqual([]);
    // One insert, one trip through openDAW: nothing comes back a quantum late.
    expect(plan.modules.size + plan.units.size).toBe(0);
    const { effects } = lane(plan, "a");
    expect(shape(effects)).toEqual([
      ["cheapReverb", "verb"],
      ["revamp", "tone"],
      ["delay", "echo"],
    ]);
    const revamp = effects[1] as Extract<EffectConfig, { type: "revamp" }>;
    expect(revamp).toMatchObject({
      enabled: true,
      highPassEnabled: true,
      highPassFrequency: 900,
      highPassOrder: 1,
      lowPassEnabled: false,
      lowShelfEnabled: false,
      midBellEnabled: false,
    });
    // Web Audio's Q is in dB for a high-pass; Revamp's is linear.
    expect(revamp.highPassQ).toBeCloseTo(10 ** (6 / 20), 6);
    expect(lane(plan, "a").backend).toBe("official");
  });

  test("a Pan between FX stays a Web Audio module: the FX after it loop back into openDAW", () => {
    const plan = compile(
      graph(
        [
          station("a"),
          fx("verb", "cheapReverb", { enabled: true }),
          node("width", "pan", { pan: 1 }),
          fx("echo", "delay", { enabled: true }),
          speakers,
        ],
        [
          audio("a", "verb"),
          audio("verb", "width"),
          audio("width", "echo"),
          audio("echo", "speakers"),
        ]
      ),
      ENV
    );
    expect(plan.issues).toEqual([]);
    // Web Audio's panner moves the left side right at +1; no openDAW device
    // does the same, so the Pan runs as the panner itself.
    expect(shape(lane(plan, "a").effects)).toEqual([["cheapReverb", "verb"]]);
    expect(plan.modules.get("pan:width")).toMatchObject({
      kind: "pan",
      pan: 1,
    });
    expect(plan.cables.get("width->echo")).toMatchObject({
      delay: 0,
      from: { id: "width", kind: "pan" },
      reenters: true,
      to: { id: "echo", kind: "unit" },
    });
  });

  test("a Filter with FX on one side only stays a Web Audio module", () => {
    const plan = compile(
      graph(
        [
          station("a"),
          fx("verb", "cheapReverb"),
          node("tone", "filter"),
          speakers,
        ],
        [audio("a", "verb"), audio("verb", "tone"), audio("tone", "speakers")]
      ),
      ENV
    );
    expect(shape(lane(plan, "a").effects)).toEqual([["cheapReverb", "verb"]]);
    expect(plan.modules.get("filter:tone")?.kind).toBe("filter");
  });
});

describe("compile: cables arrive in step", () => {
  test("a path back into openDAW is a quantum late on its own, and only the paths it rejoins wait", () => {
    const plan = compile(
      graph(
        [
          station("a"),
          station("b"),
          fx("verb", "cheapReverb", { enabled: true }),
          fx("comp", "compressor", { enabled: true }),
          node("width", "pan", { pan: 0.3 }),
          node("mix", "merge"),
          speakers,
        ],
        [
          audio("a", "verb"),
          audio("verb", "comp"),
          audio("verb", "mix"),
          audio("comp", "width"),
          audio("width", "mix"),
          audio("b", "mix"),
          audio("mix", "speakers"),
        ]
      ),
      ENV
    );
    expect(plan.issues).toEqual([]);
    // a's Reverb is its insert, in openDAW; its Compressor is a unit there.
    expect(shape(lane(plan, "a").effects)).toEqual([["cheapReverb", "verb"]]);
    expect(plan.units.get("comp")?.backend).toBe("official");
    const cables = Object.fromEntries(
      [...plan.cables.values()].map((cable) => [
        `${endpointKey(cable.from)}>${endpointKey(cable.to)}`,
        [cable.delay, cable.reenters],
      ])
    );
    // [quanta it waits on a DelayNode, whether it loops back into openDAW]
    expect(cables).toEqual({
      // The Reverb's own path and station b wait the quantum its path
      // through the Compressor comes back late, and no more.
      "lane:a>sum:mix": [1, false],
      // Out of openDAW and back in: late by the loop alone, with a
      // DelayNode that adds nothing.
      "lane:a>unit:comp": [0, true],
      "lane:b>sum:mix": [1, false],
      "pan:width>sum:mix": [0, false],
      "sum:mix>sink:speakers": [0, false],
      "unit:comp>pan:width": [0, false],
    });
  });

  test("without openDAW nothing waits", () => {
    const plan = compile(
      graph(
        [
          station("a"),
          station("b"),
          fx("verb", "cheapReverb", { enabled: true }),
          node("mix", "merge"),
          fx("comp", "compressor", { enabled: true }),
          speakers,
        ],
        [
          audio("a", "verb"),
          audio("verb", "mix"),
          audio("b", "mix"),
          audio("mix", "comp"),
          audio("comp", "speakers"),
        ]
      ),
      { crossOriginIsolated: false }
    );
    expect(plan.units.get("mix")?.backend).toBe("compat");
    expect([...plan.cables.values()].every((cable) => cable.delay === 0)).toBe(
      true
    );
  });
});

describe("compile: Splits whose branches go different places", () => {
  test("each cabled port routes on its own, a branch with FX as its own unit", () => {
    const base = createNodeEffectConfig("fxComposite", "split");
    const chains = base.chains.map((chain, index) => ({
      ...chain,
      gain: index === 0 ? 0.5 : chain.gain,
      pan: index === 0 ? -0.25 : 0,
    }));
    const plan = build(
      [
        station("a"),
        {
          data: { effect: { ...base, chains, enabled: true } },
          id: "split",
          position: { x: 0, y: 0 },
          type: "fxComposite",
        } as NodeInput,
        fx("verb", "cheapReverb", { enabled: true }),
        node("desk", "deviceOut", { deviceId: "usb" }),
        speakers,
      ],
      [
        audio("a", "split"),
        {
          ...audio("split", "verb", { from: "branch-1" }),
          pan: 0.5,
          solo: true,
        },
        audio("verb", "speakers", { gain: 0.8 }),
        audio("split", "desk", { from: "branch-2" }),
      ]
    );
    expect(plan.issues).toEqual([]);
    const split = plan.modules.get("split:split");
    if (split?.kind !== "split") {
      throw new Error("no split stage");
    }
    expect(split.split.cabled).toEqual([0, 1]);
    // The chain's gain and pan follow the reverb, as openDAW's cell has
    // them after its FX; the cable's pan adds to the chain's there.
    expect(plan.cables.get("split->verb")).toMatchObject({
      gain: 1,
      muted: false,
    });
    expect(plan.cables.get("split->verb")?.balance).toBeUndefined();
    expect(plan.cables.get("verb->speakers")).toMatchObject({
      balance: [0.75, 1],
      gain: 0.4,
      muted: false,
    });
    // The cable's solo leaves the other branch out.
    expect(plan.cables.get("split->desk")?.muted).toBe(true);
    expect(shape(plan.units.get("verb")?.effects ?? [])).toEqual([
      ["cheapReverb", "verb"],
    ]);
    expect(routes(plan)).toEqual([
      "lane:a>split:split",
      "split:split>sink:desk",
      "split:split>unit:verb",
      "unit:verb>sink:speakers",
    ]);
  });

  test("an open Split's solo names the cables it leaves out, and its dry signal the cables it rides beside", () => {
    const mixOf = (split: Partial<EffectConfig>, edges: EdgeInput[]) => {
      const { dry, soloedOut } = build(
        [
          station("a"),
          fx("split", "fxComposite", { dryWet: 1, enabled: true, ...split }),
          node("desk", "deviceOut", { deviceId: "usb" }),
          node("cue", "deviceOut", { deviceId: "cue" }),
          speakers,
        ],
        [audio("a", "split"), ...edges]
      );
      return { dry: dry.cables, left: soloedOut.branches };
    };
    const soloed = {
      ...audio("split", "speakers", { from: "branch-1" }),
      solo: true,
    };
    const ports = [soloed, audio("split", "desk", { from: "branch-2" })];
    expect(mixOf({}, ports)).toEqual({
      dry: new Set(),
      left: new Set(["split->desk"]),
    });
    // Its dry signal still reaches every port, beside the wet it leaves out.
    const everyPort = new Set(["split->speakers", "split->desk"]);
    expect(mixOf({ dryWet: 0.5 }, ports)).toEqual({
      dry: everyPort,
      left: new Set(["split->desk"]),
    });
    expect(mixOf({ enabled: false }, ports).dry).toEqual(everyPort);
    // A soloed cable leaves its port's other cables out.
    expect(
      mixOf({}, [soloed, audio("split", "cue", { from: "branch-1" })]).left
    ).toEqual(new Set(["split->cue"]));
  });

  test("a closed Split's dry signal plays past its branches to where they meet", () => {
    const meetings = (split: Partial<EffectConfig>) =>
      build(
        [
          station("a"),
          fx("split", "fxComposite", { dryWet: 1, enabled: true, ...split }),
          fx("verb", "cheapReverb", { enabled: true }),
          node("merge", "merge"),
          speakers,
        ],
        [
          audio("a", "split"),
          audio("split", "verb", { from: "branch-1" }),
          audio("split", "merge", { from: "branch-2" }),
          audio("verb", "merge"),
          audio("merge", "speakers"),
        ]
      ).dry.meetings;
    expect(meetings({})).toEqual(new Map());
    expect(meetings({ dryWet: 0.5 })).toEqual(new Map([["split", "merge"]]));
    expect(meetings({ enabled: false })).toEqual(new Map([["split", "merge"]]));
  });

  test("keys from different ports of a Split stay apart", () => {
    const plan = build(
      [
        station("a"),
        station("music"),
        fx("split", "stereoSplit", { enabled: true }),
        fx("comp", "compressor", { enabled: true }),
        fx("gate", "gate", { enabled: true }),
        node("desk", "deviceOut", { deviceId: "usb" }),
        speakers,
      ],
      [
        audio("a", "split"),
        audio("split", "speakers", { from: "left" }),
        audio("split", "desk", { from: "right" }),
        audio("music", "comp"),
        audio("comp", "gate"),
        audio("gate", "speakers"),
        { ...key("split", "comp"), sourceHandle: "out:audio:left" },
        { ...key("split", "gate"), sourceHandle: "out:audio:right" },
      ]
    );
    expect(plan.issues).toEqual([]);
    const [comp, gate] = lane(plan, "music").effects;
    expect(comp?.sidechain).toEqual({ channelId: "node-key:comp" });
    expect(gate?.sidechain).toEqual({ channelId: "node-key:gate" });
    expect(
      [...plan.cables.values()]
        .filter((cable) => cable.kind === "key")
        .map((cable) => [cable.from.port, cable.to.id])
    ).toEqual([
      [0, "node-key:comp"],
      [1, "node-key:gate"],
    ]);
  });

  test("a Band Split whose bands go different places keeps its crossovers", () => {
    const base = createNodeEffectConfig("frequencySplit", "bands");
    const plan = build(
      [
        station("a"),
        {
          data: {
            effect: {
              ...base,
              chains: base.chains.slice(0, 2),
              crossoverFrequencies: [500],
              enabled: true,
            },
          },
          id: "bands",
          position: { x: 0, y: 0 },
          type: "frequencySplit",
        } as NodeInput,
        node("desk", "deviceOut", { deviceId: "usb" }),
        speakers,
      ],
      [
        audio("a", "bands"),
        audio("bands", "speakers", { from: "band-1" }),
        audio("bands", "desk", { from: "band-2" }),
      ]
    );
    expect(plan.issues).toEqual([]);
    const bands = plan.modules.get("split:bands");
    expect(bands).toMatchObject({
      kind: "split",
      split: { cabled: [0, 1], effect: { crossoverFrequencies: [500] } },
    });
    expect(
      [...plan.cables.values()].map((cable) => [cable.from.port, cable.to.id])
    ).toEqual([
      [0, "speakers"],
      [1, "desk"],
      [undefined, "bands"],
    ]);
  });

  test.each([
    ["go different places", "desk"],
    ["meet again", "speakers"],
  ])(
    "FX nested in a Split's chain are refused when its branches %s",
    (_, second) => {
      // An imported Split with a Compressor inside its first chain, which the
      // canvas can't make: its branches are the nodes cabled from its ports.
      const base = createNodeEffectConfig("fxComposite", "split");
      const comp = createNodeEffectConfig("compressor", "nested-comp");
      const chains = base.chains.map((chain, index) =>
        index === 0 ? { ...chain, effects: [comp] } : chain
      );
      const plan = build(
        [
          station("a"),
          {
            data: { effect: { ...base, chains, enabled: true } },
            id: "split",
            position: { x: 0, y: 0 },
            type: "fxComposite",
          } as NodeInput,
          node("desk", "deviceOut", { deviceId: "usb" }),
          speakers,
        ],
        [
          audio("a", "split"),
          audio("split", "speakers", { from: "branch-1" }),
          audio("split", second, { from: "branch-2", id: "two" }),
        ]
      );
      expect(codes(plan)).toEqual(["split-branches@split"]);
      expect(plan.issues[0]?.message).toBe(
        "FX inside a Split's branches don't play: cable them from its ports"
      );
      // Nothing plays the branch dry.
      expect(routes(plan).filter((route) => route.includes("sink:"))).toEqual(
        []
      );
    }
  );
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
    expect(plan.cables.get("merge->speakers")?.from.id).toBe("a");
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
    expect(mergeRoles(three, plan)).toEqual(new Map([["merge", "closes"]]));
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

  test("a Merge summing two stations is a sum point, not a refusal", () => {
    const merged = graph(
      [station("a"), station("b"), node("merge", "merge"), speakers],
      [audio("a", "merge"), audio("b", "merge"), audio("merge", "speakers")]
    );
    const plan = compile(merged, ENV);

    expect(plan.issues).toEqual([]);
    expect(mergeRoles(merged, plan)).toEqual(new Map([["merge", "sum"]]));
    expect(plan.modules.get("sum:merge")).toMatchObject({ kind: "sum" });
    expect(routes(plan)).toEqual([
      "lane:a>sum:merge",
      "lane:b>sum:merge",
      "sum:merge>sink:speakers",
    ]);
  });

  test("a Merge's role counts the inputs that actually compiled", () => {
    const merged = graph(
      [
        station("a"),
        { data: { radio: null }, id: "b", position, type: "station" },
        node("merge", "merge"),
        speakers,
      ],
      [audio("a", "merge"), audio("b", "merge"), audio("merge", "speakers")]
    );
    const plan = compile(merged, ENV);

    expect(plan.modules.get("sum:merge")).toMatchObject({ kind: "sum" });
    expect(plan.cables.has("b->merge")).toBe(false);
    expect(mergeRoles(merged, plan)).toEqual(new Map([["merge", "closes"]]));
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

  test("branches that meet at one output close without a Merge", () => {
    const plan = build(
      [station("a"), fx("verb", "cheapReverb"), speakers],
      [audio("a", "verb"), audio("a", "speakers"), audio("verb", "speakers")]
    );
    expect(plan.issues).toEqual([]);
    expect(shape(lane(plan, "a").effects)).toEqual([
      ["fxComposite", "a:fan-out", [[["cheapReverb", "verb"]], []]],
    ]);
    // One cable carries the closed region into Speakers.
    expect(plan.cables.get("a->verb+verb->speakers") ?? null).toBeNull();
    expect([...plan.cables.keys()]).toEqual(["a->speakers+verb->speakers"]);
    expect(plan.cables.get("a->speakers+verb->speakers")?.edges).toEqual([
      "a->speakers",
      "verb->speakers",
    ]);
    expect(routes(plan)).toEqual(["lane:a>sink:speakers"]);
  });

  test("a cable carrying a closed region never takes a patch cable's id", () => {
    // The second station's cable has the id the region's cable would.
    const plan = build(
      [station("a"), station("b"), fx("verb", "cheapReverb"), speakers],
      [
        audio("a", "verb"),
        audio("a", "speakers"),
        audio("verb", "speakers"),
        audio("b", "speakers", { id: "a->speakers+verb->speakers" }),
      ]
    );
    expect(plan.issues).toEqual([]);
    expect(routes(plan)).toEqual([
      "lane:a>sink:speakers",
      "lane:b>sink:speakers",
    ]);
    const edges = [...plan.cables.values()].map((cable) => cable.edges);
    expect(edges).toContainEqual(["a->speakers", "verb->speakers"]);
    expect(plan.cables.get("a->speakers+verb->speakers")?.edges).toEqual([
      "a->speakers+verb->speakers",
    ]);
  });

  test("branches that leave without a Merge reach outputs independently", () => {
    const plan = build(
      [
        station("a"),
        fx("verb", "cheapReverb"),
        node("desk", "deviceOut", { deviceId: "usb" }),
        speakers,
      ],
      [audio("a", "verb"), audio("a", "speakers"), audio("verb", "desk")]
    );
    expect(plan.issues).toEqual([]);
    expect(lane(plan, "a").effects).toEqual([]);
    expect(shape(plan.units.get("verb")?.effects ?? [])).toEqual([
      ["cheapReverb", "verb"],
    ]);
    expect(routes(plan)).toEqual([
      "lane:a>sink:speakers",
      "lane:a>unit:verb",
      "unit:verb>sink:desk",
    ]);
  });

  test("a Merge joining two fan-outs is a sum, and no node is copied", () => {
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
    expect(plan.issues).toEqual([]);
    expect(lane(plan, "a").effects).toEqual([]);
    expect([...plan.units.keys()].sort()).toEqual(["x", "y"]);
    expect(
      [...plan.modules.values()]
        .map((module) => `${module.kind}:${module.id}`)
        .sort()
    ).toEqual(["sum:m1", "sum:m2", "sum:m3"]);
    expect(routes(plan)).toEqual([
      "lane:a>unit:x",
      "lane:a>unit:y",
      "sum:m1>sum:m3",
      "sum:m2>sum:m3",
      "sum:m3>sink:speakers",
      "unit:x>sum:m1",
      "unit:x>sum:m2",
      "unit:y>sum:m1",
      "unit:y>sum:m2",
    ]);
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
    expect(plan.cables.has("m1->speakers")).toBe(true);
  });

  test("depth 9 is rejected on the split that goes too deep", () => {
    const plan = nested(9);
    expect(codes(plan)).toEqual(["split-depth@f9"]);
    expect(lane(plan, "a").effects).toEqual([]);
    expect(plan.cables.size).toBe(0);
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
    expect(plan.issues[0]?.message).toBe("Band Split takes 2 to 4 bands");
  });

  test("an implicit fan-out takes up to 4 branches", () => {
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
    expect(codes(plan)).toEqual(["split-branches@a"]);
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

describe("compile: key cables", () => {
  function vocoderPatch(modulatorSource: "self" | "noise-pink" | "external") {
    return graph(
      [
        station("music"),
        station("talk"),
        station("news"),
        fx("voc", "vocoder", {
          enabled: true,
          modulatorSource,
        } as Partial<EffectConfig>),
        speakers,
      ],
      [
        audio("music", "voc"),
        audio("voc", "speakers"),
        audio("talk", "speakers"),
        audio("news", "speakers"),
      ]
    );
  }

  function vocoderOf(patch: NodeGraph | null) {
    if (!patch) {
      throw new Error("No patch loaded");
    }
    return lane(compile(patch, ENV), "music").effects[0];
  }

  test.each(["self", "noise-pink", "external"] as const)(
    "removing a key restores the authored %s modulator",
    (modulatorSource) => {
      const patch = vocoderPatch(modulatorSource);
      const keyed = connectNodes(patch, key("talk", "voc"));
      expect(vocoderOf(keyed)).toMatchObject({
        modulatorSource: "external",
        sidechain: { channelId: "node-key:voc" },
      });

      const keyEdge = keyed.edges.at(-1);
      if (!keyEdge) {
        throw new Error("Key was not connected");
      }
      const unkeyed = removeEdges(keyed, [keyEdge.id]);
      expect(vocoderOf(unkeyed)).toMatchObject({ modulatorSource });
      expect(vocoderOf(unkeyed)?.sidechain).toBeUndefined();
      expect(keyed.nodes).toBe(patch.nodes);
    }
  );

  test("rewiring and deleting a key source derive the mode from the remaining key", () => {
    const patch = vocoderPatch("noise-pink");
    const keyed = nodeGraphSchema.parse({
      ...patch,
      edges: [...patch.edges, key("talk", "voc")],
    });
    const rewired = {
      ...keyed,
      edges: keyed.edges.map((edge) =>
        edge.id === "talk~>voc" ? { ...edge, source: "news" } : edge
      ),
    };
    expect(vocoderOf(rewired)).toMatchObject({
      modulatorSource: "external",
      sidechain: { channelId: "node-key:voc" },
    });
    expect(vocoderOf(removeNodes(rewired, ["news"]))).toMatchObject({
      modulatorSource: "noise-pink",
    });
    expect(
      vocoderOf(removeNodes(rewired, ["news"]))?.sidechain
    ).toBeUndefined();
  });

  test("editing a keyed Vocoder's authored mode takes effect after removal and undo restores the key", () => {
    const patch = vocoderPatch("noise-pink");
    const keyed = nodeGraphSchema.parse({
      ...patch,
      edges: [...patch.edges, key("talk", "voc")],
    });
    const edited = setEffectParams(keyed, "voc", {
      modulatorSource: "self",
    } as Partial<EffectConfig>);
    const store = createNodeStore(edited);
    expect(vocoderOf(edited)).toMatchObject({ modulatorSource: "external" });

    commitNodeGraph(
      (current) => removeEdges(current, ["talk~>voc"]),
      store,
      "snapshot"
    );
    expect(vocoderOf(store.state.graph)).toMatchObject({
      modulatorSource: "self",
    });
    undoNodeGraph(store);
    expect(vocoderOf(store.state.graph)).toMatchObject({
      modulatorSource: "external",
      sidechain: { channelId: "node-key:voc" },
    });
    redoNodeGraph(store);
    expect(vocoderOf(store.state.graph)).toMatchObject({
      modulatorSource: "self",
    });
  });

  test("keys tap the cabled point, sum inputs and honor cable gain", () => {
    const plan = build(
      [
        station("music"),
        station("talk"),
        station("news"),
        fx("comp", "compressor"),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "speakers"),
        audio("talk", "speakers"),
        { ...key("talk", "comp"), gain: 0.5 },
        key("news", "comp"),
      ]
    );
    expect(plan.issues).toEqual([]);
    expect(lane(plan, "music").effects[0]?.sidechain).toEqual({
      channelId: "node-key:comp",
    });
    expect(plan.modules.get("key:node-key:comp")).toEqual({
      id: "node-key:comp",
      kind: "key",
      realtime: false,
    });
    expect(plan.cables.get("talk~>comp")).toEqual({
      delay: 0,
      edges: ["talk~>comp"],
      from: { id: "talk", kind: "lane" },
      gain: 0.5,
      id: "talk~>comp",
      kind: "key",
      muted: false,
      reenters: false,
      to: { id: "node-key:comp", kind: "key" },
    });
    expect(plan.cables.get("news~>comp")?.to).toEqual({
      id: "node-key:comp",
      kind: "key",
    });
    // Key cables are no route: another station's solo leaves them on.
    const soloed = build(
      [
        {
          ...station("music"),
          data: { ...station("music").data, strip: { solo: true } },
        } as NodeInput,
        station("talk"),
        fx("comp", "compressor"),
        speakers,
      ],
      [audio("music", "comp"), audio("comp", "speakers"), key("talk", "comp")]
    );
    expect(soloed.cables.get("talk~>comp")?.muted).toBe(false);
  });

  test("a node named like a key id keeps its own point beside the key", () => {
    const plan = build(
      [
        station("music"),
        station("talk"),
        fx("comp", "compressor"),
        node("node-key:comp", "filter", {
          frequency: 900,
          Q: 1,
          type: "lowpass",
        }),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "node-key:comp"),
        audio("node-key:comp", "speakers"),
        key("talk", "comp"),
      ]
    );
    expect(plan.issues).toEqual([]);
    expect(routes(plan)).toEqual(
      [
        "filter:node-key:comp>sink:speakers",
        "lane:music>filter:node-key:comp",
        "lane:talk>key:node-key:comp",
      ].sort()
    );
    // Every point a cable reaches is one the routing graph makes.
    const points = new Set(
      [...plan.modules.values()].map((module) => endpointKey(module))
    );
    for (const cable of plan.cables.values()) {
      if (cable.to.kind !== "sink") {
        expect(points.has(endpointKey(cable.to))).toBe(true);
      }
    }
  });

  test("several processed or summed signals key several FX independently", () => {
    const plan = build(
      [
        station("music"),
        station("talk"),
        station("news"),
        fx("comp", "compressor"),
        fx("gate", "gate"),
        fx("crush", "crusher"),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "gate"),
        audio("gate", "speakers"),
        audio("talk", "crush"),
        audio("crush", "speakers"),
        audio("news", "speakers"),
        key("talk", "comp"),
        key("crush", "gate"),
        key("news", "gate"),
      ]
    );
    expect(plan.issues).toEqual([]);
    const [comp, gate] = lane(plan, "music").effects;
    expect(comp?.sidechain).toEqual({ channelId: "node-key:comp" });
    expect(gate?.sidechain).toEqual({ channelId: "node-key:gate" });
    // Talk is tapped, so its Crusher runs after its fader, and keys from there.
    expect(lane(plan, "talk").effects).toEqual([]);
    expect(routes(plan)).toEqual([
      "lane:music>sink:speakers",
      "lane:news>key:node-key:gate",
      "lane:news>sink:speakers",
      "lane:talk>key:node-key:comp",
      "lane:talk>unit:crush",
      "unit:crush>key:node-key:gate",
      "unit:crush>sink:speakers",
    ]);
  });

  test("FX one after the other keyed from the same cables each get their own key, in step", () => {
    const pan = node("pan", "pan", { pan: 0.2 });
    const started = performance.now();
    const plan = build(
      [
        station("a"),
        station("b"),
        station("talk"),
        node("mix", "merge"),
        fx("comp", "compressor", { enabled: true }),
        pan,
        fx("gate", "gate", { enabled: true }),
        speakers,
      ],
      [
        audio("a", "mix"),
        audio("b", "mix"),
        audio("mix", "comp"),
        audio("comp", "pan"),
        audio("pan", "gate"),
        audio("gate", "speakers"),
        key("talk", "comp"),
        key("talk", "gate"),
      ]
    );
    // It settles at once: one key can't arrive with both.
    expect(performance.now() - started).toBeLessThan(1000);
    expect(plan.issues).toEqual([]);
    expect(plan.units.get("mix")?.effects[0]?.sidechain).toEqual({
      channelId: "node-key:comp",
    });
    expect(plan.units.get("gate")?.effects[0]?.sidechain).toEqual({
      channelId: "node-key:gate",
    });
    // The gate's audio comes back from openDAW once more: its key waits.
    expect(plan.cables.get("pan->gate")).toMatchObject({
      delay: 0,
      reenters: true,
    });
    expect(plan.cables.get("talk~>comp")?.delay).toBe(0);
    expect(plan.cables.get("talk~>gate")?.delay).toBe(1);
  });

  test("FX apart keyed from the same cables share one key, and both wait for it", () => {
    const plan = build(
      [
        station("a"),
        station("b"),
        station("c"),
        station("d"),
        station("talk"),
        node("mix", "merge"),
        node("mix2", "merge"),
        fx("comp", "compressor", { enabled: true }),
        fx("verb", "cheapReverb", { enabled: true }),
        node("pan", "pan", { pan: 0.2 }),
        fx("gate", "gate", { enabled: true }),
        speakers,
      ],
      [
        audio("a", "mix"),
        audio("b", "mix"),
        audio("mix", "comp"),
        audio("comp", "speakers"),
        audio("c", "mix2"),
        audio("d", "mix2"),
        audio("mix2", "verb"),
        audio("verb", "pan"),
        audio("pan", "gate"),
        audio("gate", "speakers"),
        key("talk", "comp"),
        key("talk", "gate"),
      ]
    );
    expect(plan.issues).toEqual([]);
    expect(plan.units.get("gate")?.effects[0]?.sidechain).toEqual({
      channelId: "node-key:comp",
    });
    expect(
      [...plan.cables.values()].map((cable) => cable.edges)
    ).toContainEqual(["talk~>comp", "talk~>gate"]);
    // The gate's audio is a quantum late: the key and the Compressor's
    // audio wait for it.
    expect(plan.cables.get("pan->gate")?.reenters).toBe(true);
    expect(plan.cables.get("talk~>comp")?.delay).toBe(1);
    expect(plan.cables.get("a->mix")?.delay).toBe(1);
    expect(plan.cables.get("b->mix")?.delay).toBe(1);
  });

  test("FX keyed from the same cables share one key", () => {
    const plan = build(
      [
        station("music"),
        station("talk"),
        fx("comp", "compressor"),
        fx("gate", "gate"),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "gate"),
        audio("gate", "speakers"),
        key("talk", "comp"),
        { ...key("talk", "gate"), id: "talk~>gate" },
      ]
    );
    const [comp, gate] = lane(plan, "music").effects;
    expect(comp?.sidechain).toEqual({ channelId: "node-key:comp" });
    expect(gate?.sidechain).toEqual({ channelId: "node-key:comp" });
    expect([...plan.modules.keys()]).toEqual(["key:node-key:comp"]);
    // Both cables key their FX through the one key: neither is idle.
    const playing = graph(
      [
        station("music"),
        station("talk"),
        fx("comp", "compressor", { enabled: true }),
        fx("gate", "gate", { enabled: true }),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "gate"),
        audio("gate", "speakers"),
        key("talk", "comp"),
        { ...key("talk", "gate"), id: "talk~>gate" },
      ]
    );
    expect(idleKeys(playing, compile(playing, ENV))).toEqual(new Map());
  });

  test("a key's id is never a sound's, whatever the node ids", () => {
    // Under `<fx>:key`, this Compressor's key was the second station's sound.
    const plan = build(
      [
        station("music"),
        station("x:key"),
        fx("node:n:x", "compressor", { enabled: true }),
        speakers,
      ],
      [
        audio("music", "node:n:x"),
        audio("node:n:x", "speakers"),
        audio("x:key", "speakers"),
        key("x:key", "node:n:x"),
      ]
    );
    const sounds = [...plan.lanes.values()].map(({ soundId }) => soundId);
    const keys = [...plan.modules.values()]
      .filter((module) => module.kind === "key")
      .map((module) => module.id);
    expect(keys).toHaveLength(1);
    expect(sounds).not.toContain(keys[0]);
  });

  test("shared key cables whose ids hold a + are still bound", () => {
    const playing = graph(
      [
        station("music"),
        station("talk"),
        fx("comp", "compressor", { enabled: true }),
        fx("gate", "gate", { enabled: true }),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "gate"),
        audio("gate", "speakers"),
        { ...key("talk", "comp"), id: "talk+comp" },
        { ...key("talk", "gate"), id: "talk+gate" },
      ]
    );
    const plan = compile(playing, ENV);
    expect([...plan.modules.keys()]).toEqual(["key:node-key:comp"]);
    expect(idleKeys(playing, plan)).toEqual(new Map());
  });

  test("a key on a station keeps the Filter and Pan after it, as modules", () => {
    const plan = build(
      [
        station("music"),
        station("talk"),
        fx("comp", "compressor", { enabled: true }),
        node("tone", "filter", { frequency: 400 }),
        node("width", "pan", { pan: 0.4 }),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "speakers"),
        audio("talk", "tone"),
        audio("tone", "width"),
        audio("width", "speakers"),
        key("talk", "comp"),
      ]
    );
    expect(plan.issues).toEqual([]);
    // The key taps Talk's fader: its Filter and Pan run after that point.
    expect(lane(plan, "talk")).toMatchObject({ filter: null, pan: 0 });
    expect(routes(plan)).toEqual([
      "filter:tone>pan:width",
      "lane:music>sink:speakers",
      "lane:talk>filter:tone",
      "lane:talk>key:node-key:comp",
      "pan:width>sink:speakers",
    ]);
  });

  test("a Filter or Pan module keys an effect from its own output", () => {
    const plan = build(
      [
        station("music"),
        station("talk"),
        fx("comp", "compressor", { enabled: true }),
        fx("verb", "cheapReverb", { enabled: true }),
        node("tone", "filter", { frequency: 2000 }),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "speakers"),
        audio("talk", "verb"),
        audio("verb", "tone"),
        audio("tone", "speakers"),
        key("tone", "comp"),
      ]
    );
    expect(plan.issues).toEqual([]);
    expect(routes(plan)).toContain("filter:tone>key:node-key:comp");
    expect(lane(plan, "music").effects[0]?.sidechain).toEqual({
      channelId: "node-key:comp",
    });
  });

  test.each([
    ["an effect on a branch", "verb", "main"],
    ["a branch's port", "split", "branch-2"],
  ])(
    "a key from %s of a Split whose branches meet is refused; the Split plays on",
    (_label, source, port) => {
      const patch = graph(
        [
          station("a"),
          station("music"),
          fx("split", "fxComposite", { enabled: true }),
          fx("verb", "cheapReverb", { enabled: true }),
          node("merge", "merge"),
          fx("comp", "compressor", { enabled: true }),
          speakers,
        ],
        [
          audio("a", "split"),
          audio("split", "verb", { from: "branch-1", id: "one" }),
          audio("verb", "merge"),
          audio("split", "merge", { from: "branch-2", id: "two" }),
          audio("merge", "speakers"),
          audio("music", "comp"),
          audio("comp", "speakers"),
          { ...key(source, "comp"), sourceHandle: `out:audio:${port}` },
        ]
      );
      const plan = compile(patch, ENV);
      expect(codes(plan)).toEqual([`key-enclosed@${source}~>comp`]);
      expect(shape(lane(plan, "a").effects)).toEqual([
        ["fxComposite", "split", [[["cheapReverb", "verb"]], []]],
      ]);
      expect(lane(plan, "music").effects[0]?.sidechain).toBeUndefined();
      expect(Object.fromEntries(idleKeys(patch, plan))).toEqual({
        [`${source}~>comp`]:
          "A key can't start inside a Split whose branches meet again",
      });
    }
  );

  test("a key on a fan-out's head keeps the head a point", () => {
    const plan = build(
      [
        station("music"),
        station("talk"),
        fx("comp", "compressor", { enabled: true }),
        fx("verb", "cheapReverb", { enabled: true }),
        fx("echo", "delay", { enabled: true }),
        node("mix", "merge"),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "speakers"),
        audio("talk", "verb"),
        audio("talk", "echo"),
        audio("verb", "mix"),
        audio("echo", "mix"),
        audio("mix", "speakers"),
        key("talk", "comp"),
      ]
    );
    expect(plan.issues).toEqual([]);
    expect(routes(plan)).toContain("lane:talk>key:node-key:comp");
    expect(lane(plan, "music").effects[0]?.sidechain).toEqual({
      channelId: "node-key:comp",
    });
    expect(lane(plan, "talk").effects).toEqual([]);
  });

  test.each([
    ["with its head keyed too", true],
    ["alone", false],
  ])(
    "a key inside a fan-out whose branches meet opens it, %s",
    (_label, headKeyed) => {
      const plan = build(
        [
          station("music"),
          station("talk"),
          fx("comp", "compressor", { enabled: true }),
          fx("gate", "gate", { enabled: true }),
          fx("verb", "cheapReverb", { enabled: true }),
          fx("echo", "delay", { enabled: true }),
          node("mix", "merge"),
          speakers,
        ],
        [
          audio("music", "comp"),
          audio("comp", "gate"),
          audio("gate", "speakers"),
          audio("talk", "verb"),
          audio("talk", "echo"),
          audio("verb", "mix"),
          audio("echo", "mix"),
          audio("mix", "speakers"),
          key("verb", "gate"),
          ...(headKeyed ? [key("talk", "comp")] : []),
        ]
      );
      expect(plan.issues).toEqual([]);
      expect(routes(plan)).toContain("unit:verb>key:node-key:gate");
      expect(lane(plan, "music").effects[1]).toMatchObject({
        id: "gate",
        sidechain: { channelId: "node-key:gate" },
      });
    }
  );

  test("a key reaching only another key is live, however many hops back", () => {
    const plan = build(
      [
        station("music"),
        station("talk"),
        station("news"),
        fx("a", "compressor", { enabled: true }),
        fx("b", "compressor", { enabled: true }),
        speakers,
      ],
      [
        audio("talk", "a"),
        key("a", "b"),
        audio("music", "b"),
        audio("b", "speakers"),
        key("news", "a"),
      ]
    );
    expect(plan.issues).toEqual([]);
    expect(routes(plan)).toEqual(
      [
        "lane:music>sink:speakers",
        "lane:news>key:node-key:a",
        "lane:talk>key:node-key:b",
      ].sort()
    );
    expect(lane(plan, "talk").effects[0]).toMatchObject({
      id: "a",
      sidechain: { channelId: "node-key:a" },
    });
  });

  test("a processed key and its effect's audio arrive in step", () => {
    const plan = build(
      [
        station("music"),
        station("news"),
        station("talk"),
        node("mix", "merge"),
        fx("comp", "compressor", { enabled: true }),
        fx("eq", "revamp", { enabled: true }),
        speakers,
      ],
      [
        audio("music", "mix"),
        audio("news", "mix"),
        audio("mix", "comp"),
        audio("comp", "speakers"),
        audio("talk", "eq"),
        audio("eq", "speakers"),
        key("eq", "comp"),
      ]
    );
    expect(plan.issues).toEqual([]);
    expect(lane(plan, "talk").backend).toBe("official");
    expect(plan.units.get("mix")?.backend).toBe("official");
    const cables = Object.fromEntries(
      [...plan.cables.values()].map((cable) => [
        cable.id,
        [cable.delay, cable.reenters],
      ])
    );
    // The key comes back into openDAW from Talk's insert a quantum late on
    // its own; the Compressor's audio waits that quantum for it.
    expect(cables).toMatchObject({
      "eq~>comp": [0, true],
      "music->mix": [1, false],
      "news->mix": [1, false],
    });
  });

  test("muting every key restores a Vocoder's authored mode", () => {
    const vocoderKeys = (muted: boolean) =>
      nodeGraphSchema.parse({
        ...vocoderPatch("noise-pink"),
        edges: [
          ...vocoderPatch("noise-pink").edges,
          { ...key("talk", "voc"), muted },
          { ...key("news", "voc"), muted: true },
        ],
      });
    expect(vocoderOf(vocoderKeys(false))).toMatchObject({
      modulatorSource: "external",
      sidechain: { channelId: "node-key:voc" },
    });
    const unkeyed = vocoderOf(vocoderKeys(true));
    expect(unkeyed).toMatchObject({ modulatorSource: "noise-pink" });
    expect(unkeyed?.sidechain).toBeUndefined();
    expect(compile(vocoderKeys(true), ENV).modules.size).toBe(0);
  });

  test("a key into shared FX connects", () => {
    const plan = build(
      [
        station("a"),
        station("b"),
        station("talk"),
        node("mix", "merge"),
        fx("comp", "compressor", { enabled: true }),
        speakers,
      ],
      [
        audio("a", "mix"),
        audio("b", "mix"),
        audio("mix", "comp"),
        audio("comp", "speakers"),
        key("talk", "comp"),
      ]
    );
    expect(plan.issues).toEqual([]);
    expect(plan.units.get("mix")?.effects[0]?.sidechain).toEqual({
      channelId: "node-key:comp",
    });
  });

  test("a stale sidechain without a key cable is dropped", () => {
    const plan = build(
      [
        station("a"),
        fx("comp", "compressor", { sidechain: { channelId: "n:gone" } }),
        speakers,
      ],
      [audio("a", "comp"), audio("comp", "speakers")]
    );
    expect(lane(plan, "a").effects[0]?.sidechain).toBeUndefined();
  });

  test("disabled FX and empty or muted key sources report an idle reason", () => {
    const patch = graph(
      [
        station("music"),
        station("talk"),
        station("news"),
        station("empty", false),
        fx("comp", "compressor", { enabled: true }),
        fx("gate", "gate", { enabled: true }),
        fx("loose", "gate", { enabled: true }),
        fx("idle", "compressor", { enabled: true }),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "gate"),
        audio("gate", "speakers"),
        audio("talk", "idle"),
        audio("idle", "speakers"),
        key("talk", "comp"),
        key("news", "gate"),
        key("empty", "idle"),
        // The loose gate plays nowhere, so its key has nothing to key.
        key("music", "loose"),
      ]
    );
    const plan = compile(patch, ENV);

    expect(Object.fromEntries(idleKeys(patch, plan))).toEqual({
      "empty~>idle": "The station slot is empty",
      "music~>loose": "This key isn't used",
    });

    const keyedOff = graph(
      [station("music"), station("talk"), fx("off", "compressor"), speakers],
      [audio("music", "off"), audio("off", "speakers"), key("talk", "off")]
    );
    expect(
      Object.fromEntries(idleKeys(keyedOff, compile(keyedOff, ENV)))
    ).toEqual({ "talk~>off": "Switch the effect on to use its key" });

    const muted = graph(
      [station("music"), station("talk"), fx("on", "compressor"), speakers],
      [
        audio("music", "on"),
        audio("on", "speakers"),
        { ...key("talk", "on"), muted: true },
      ]
    );
    expect(Object.fromEntries(idleKeys(muted, compile(muted, ENV)))).toEqual({
      "talk~>on": "This key is muted",
    });
  });

  test("the compatibility engine keys one FX a chain; the next says so", () => {
    const patch = graph(
      [
        station("music"),
        station("talk"),
        fx("comp", "compressor", { enabled: true }),
        fx("gate", "gate", { enabled: true }),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "gate"),
        audio("gate", "speakers"),
        key("talk", "comp"),
        { ...key("talk", "gate"), gain: 0.5 },
      ]
    );
    const compat = compile(patch, { crossOriginIsolated: false });
    expect(Object.fromEntries(idleKeys(patch, compat))).toEqual({
      "talk~>gate": "This key needs the openDAW engine",
    });
    expect(idleKeys(patch, compile(patch, ENV)).size).toBe(0);
    // An openDAW chain the runtime moved to compatibility says so too.
    expect(
      Object.fromEntries(
        idleKeys(patch, compile(patch, ENV), { comp: "compat", gate: "compat" })
      )
    ).toEqual({ "talk~>gate": "This key needs the openDAW engine" });
    // FX sharing its one key both hear it.
    const shared = {
      ...patch,
      edges: patch.edges.map((edge) =>
        edge.id === "talk~>gate" ? { ...edge, gain: 1 } : edge
      ),
    };
    const sharedPlan = compile(shared, { crossOriginIsolated: false });
    expect(idleKeys(shared, sharedPlan).size).toBe(0);
  });

  test("a chain the runtime plays dry keys nothing", () => {
    const patch = graph(
      [
        station("music"),
        station("talk"),
        fx("comp", "compressor", { enabled: true }),
        fx("gate", "gate", { enabled: true }),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "gate"),
        audio("gate", "speakers"),
        key("talk", "comp"),
        { ...key("talk", "gate"), gain: 0.5 },
      ]
    );
    const bypassed = { comp: "bypassed", gate: "bypassed" };
    for (const env of [ENV, { crossOriginIsolated: false }]) {
      expect(
        Object.fromEntries(idleKeys(patch, compile(patch, env), bypassed))
      ).toEqual({
        "talk~>comp":
          "The effects engine couldn't start, so the key isn't used",
        "talk~>gate":
          "The effects engine couldn't start, so the key isn't used",
      });
    }
  });

  test("idleKeys flags a key on an FX in a branch the runtime skips", () => {
    // The runtime binds no key under an off Split or a silent branch.
    const patchWith = (
      split: Partial<EffectConfig>,
      branch: { gain?: number; muted?: boolean }
    ) =>
      graph(
        [
          station("music"),
          station("talk"),
          fx("split", "fxComposite", { enabled: true, ...split }),
          fx("comp", "compressor", { enabled: true }),
          node("merge", "merge"),
          speakers,
        ],
        [
          audio("music", "split"),
          audio("split", "comp", { from: "branch-1", ...branch }),
          audio("split", "merge", { from: "branch-2" }),
          audio("comp", "merge"),
          audio("merge", "speakers"),
          key("talk", "comp"),
        ]
      );
    const idle = (patch: NodeGraph) =>
      idleKeys(patch, compile(patch, ENV)).get("talk~>comp");
    expect(idle(patchWith({}, {}))).toBeUndefined();
    for (const patch of [
      patchWith({ enabled: false }, {}),
      patchWith({}, { muted: true }),
      patchWith({}, { gain: 0 }),
    ]) {
      expect(idle(patch)).toBe("Its branch is off, so the key isn't used");
    }
  });

  test("idleKeys flags a refused second key from the keying lane", () => {
    const patch = graph(
      [
        station("music"),
        station("talk"),
        fx("comp", "compressor", { enabled: true }),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "speakers"),
        audio("talk", "speakers"),
        key("talk", "comp"),
        // Same ports again: the validator refuses this second cable.
        { ...key("talk", "comp"), id: "again" },
      ]
    );
    const plan = compile(patch, ENV);

    expect(codes(plan)).toEqual(["duplicate-edge@again"]);
    expect(lane(plan, "music").effects[0]?.sidechain).toEqual({
      channelId: "node-key:comp",
    });
    expect(Object.fromEntries(idleKeys(patch, plan))).toEqual({
      again: plan.issues[0]?.message,
    });
  });

  test("a key drawn after a station's FX keys from that point", () => {
    const patch = graph(
      [
        station("music"),
        station("talk"),
        fx("comp", "compressor", { enabled: true }),
        fx("crush", "crusher", { enabled: true }),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "speakers"),
        audio("talk", "crush"),
        audio("crush", "speakers"),
        key("crush", "comp"),
      ]
    );
    const plan = compile(patch, ENV);

    expect(plan.issues).toEqual([]);
    expect(lane(plan, "music").effects[0]?.sidechain).toEqual({
      channelId: "node-key:comp",
    });
    // The tap ends Talk's insert at the Crusher: the key hears its output.
    expect(shape(lane(plan, "talk").effects)).toEqual([["crusher", "crush"]]);
    expect(plan.cables.get("crush~>comp")?.from).toEqual({
      id: "talk",
      kind: "lane",
    });
    expect(idleKeys(patch, plan).size).toBe(0);
  });

  test("a key from an empty station slot binds nothing", () => {
    const plan = build(
      [
        station("music"),
        station("empty", false),
        fx("comp", "compressor"),
        speakers,
      ],
      [audio("music", "comp"), audio("comp", "speakers"), key("empty", "comp")]
    );
    expect(lane(plan, "music").effects[0]?.sidechain).toBeUndefined();
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
    expect(plan.monitoringChannels).toBe(2);
  });

  test("it flips to compat when crossOriginIsolated is false", () => {
    const plan = fxLanes(1, { crossOriginIsolated: false });
    expect(lane(plan, "s1").backend).toBe("compat");
    expect(plan.monitoringChannels).toBe(0);
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
    expect(plan.monitoringChannels).toBe(MAX_MONITORING_CHANNELS);
  });

  test("a dry lane keying an official lane counts toward the cap", () => {
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
    expect(lane(plan, "music").backend).toBe("compat");
    expect(plan.monitoringChannels).toBe(6);
  });

  test("a key counts once for every FX keyed from it", () => {
    const plan = build(
      [
        station("music"),
        fx("duck", "compressor", { enabled: true }),
        station("news"),
        fx("news-duck", "compressor", { enabled: true }),
        station("talk"),
        speakers,
      ],
      [
        audio("music", "duck"),
        audio("duck", "speakers"),
        audio("news", "news-duck"),
        audio("news-duck", "speakers"),
        audio("talk", "speakers"),
        key("talk", "duck"),
        { ...key("talk", "news-duck"), id: "talk~>news-duck" },
      ]
    );
    expect(lane(plan, "music").backend).toBe("official");
    expect(lane(plan, "news").backend).toBe("official");
    // Two lanes and the one key they share.
    expect(plan.monitoringChannels).toBe(6);
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
    expect(plan.cables.size).toBe(0);
  });

  test("a Loop feeding itself is refused, not lowered", () => {
    const plan = build(
      [station("a"), node("loop", "loop"), speakers],
      [audio("a", "loop"), audio("loop", "loop"), audio("loop", "speakers")]
    );
    expect(codes(plan)).toEqual(["unshipped@loop"]);
    expect(plan.cables.size).toBe(0);
  });

  test("a Merge sums two stations into one shared unit", () => {
    const plan = build(
      [
        station("a"),
        station("b"),
        node("bus", "merge"),
        fx("verb", "cheapReverb", { enabled: true }),
        speakers,
      ],
      [
        audio("a", "bus", { gain: 0.5 }),
        audio("b", "bus"),
        audio("bus", "verb"),
        audio("verb", "speakers"),
      ]
    );
    expect(plan.issues).toEqual([]);
    expect([...plan.lanes.keys()]).toEqual(["a", "b"]);
    expect(lane(plan, "a").effects).toEqual([]);
    // One unit for both, keyed by the node it starts at.
    expect(plan.units.get("bus")).toMatchObject({
      backend: "official",
      nodes: ["bus", "verb"],
    });
    expect(plan.cables.get("a->bus")?.gain).toBe(0.5);
    expect(routes(plan)).toEqual([
      "lane:a>unit:bus",
      "lane:b>unit:bus",
      "unit:bus>sink:speakers",
    ]);
    // Two channels for the unit, whatever the number of stations.
    expect(plan.monitoringChannels).toBe(2);
  });

  test("an FX input sums several cables", () => {
    const plan = build(
      [
        station("a"),
        station("b"),
        fx("comp", "compressor", { enabled: true }),
        speakers,
      ],
      [audio("a", "comp"), audio("b", "comp"), audio("comp", "speakers")]
    );
    expect(plan.issues).toEqual([]);
    expect(shape(plan.units.get("comp")?.effects ?? [])).toEqual([
      ["compressor", "comp"],
    ]);
    expect(routes(plan)).toEqual([
      "lane:a>unit:comp",
      "lane:b>unit:comp",
      "unit:comp>sink:speakers",
    ]);
  });

  test("a dropped node's cables go with it, and the rest re-validates", () => {
    const ids = Array.from({ length: 25 }, (_, index) => `s${index + 1}`);
    const plan = build(
      [...ids.map((id) => station(id)), fx("comp", "compressor"), speakers],
      [audio("s25", "comp"), audio("comp", "speakers"), key("s1", "comp")]
    );
    // s25 is over the source budget; without it the Compressor and its key
    // play nowhere.
    expect(codes(plan)).toEqual(["budget-sources@s25"]);
    expect(plan.lanes.has("s25")).toBe(false);
    expect(plan.cables.size).toBe(0);
    expect(plan.modules.size).toBe(0);
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
    expect(plan.cables.has("e->speakers")).toBe(true);
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

  test("toggling a unity Autotune keeps its layout", () => {
    const tune = createNodeEffectConfig("autotune", "tune");
    expect(layoutSignature([{ ...tune, enabled: true }])).toBe(
      layoutSignature([{ ...tune, enabled: false }])
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

describe("compile: patches main accepted", () => {
  // compile-main-fixtures.json: every patch this file compiled that main's
  // compiler (fedbdfb7) accepted, with its env and main's plan: each lane's
  // insert, strip and backend, and its cables to the outputs.
  const fixtures = mainFixtures as unknown as Record<
    string,
    {
      env: CompileEnv;
      graph: NodeGraph;
      plan: string;
      /** Local files picked in the page as main compiled it. */
      picked?: string[];
    }
  >;
  /**
   * Patches whose plan changes on purpose: each turns its plan back into
   * main's, undoing just that change.
   */
  const exceptions = new Map<string, (plan: EnginePlan) => EnginePlan>([
    [
      // A key taps its station after the fader, so the keyed station's
      // own FX run after its fader too, as a unit, and the key takes two
      // channels of its own where main's was the station's.
      "1sbwrnhleu4r",
      (plan) => {
        const unit = plan.units.get("talk-comp");
        const talk = plan.lanes.get("talk");
        expect(plan.units.size).toBe(1);
        expect(talk?.effects).toEqual([]);
        expect(plan.monitoringChannels).toBe(6);
        if (!(unit && talk)) {
          throw new Error("Expected talk's FX as a unit");
        }
        const insert = {
          ...talk,
          backend: unit.backend,
          effects: unit.effects,
          layoutSignature: unit.layoutSignature,
          nodes: [...talk.nodes, ...unit.nodes],
        };
        const cables = [...plan.cables.values()].filter(
          (cable) => cable.to.id !== unit.id
        );
        return {
          ...plan,
          cables: new Map(
            cables.map((cable) => [
              cable.id,
              cable.from.id === unit.id
                ? { ...cable, from: { id: talk.id, kind: "lane" } }
                : cable,
            ])
          ),
          lanes: new Map([...plan.lanes, [talk.id, insert]]),
          monitoringChannels: plan.monitoringChannels - 2,
          units: new Map(),
        };
      },
    ],
  ]);

  test.each(Object.keys(fixtures))("%s compiles as it did on main", (name) => {
    const fixture = fixtures[name];
    if (!fixture) {
      throw new Error(`No fixture ${name}`);
    }
    for (const url of fixture.picked ?? []) {
      keepLocalFileUrl(url);
    }
    const compiled = compile(fixture.graph, fixture.env);
    forgetLocalFileUrls();
    const plan = exceptions.get(name)?.(compiled) ?? compiled;
    const asMain = lanePlans(plan, fixture.graph);
    // A key is its effect's sidechain, not a route.
    const routed = [...plan.modules.values()].filter(
      (module) => module.kind !== "key"
    );
    expect(plan.units.size + routed.length).toBe(0);
    expect(asMain).toBe(fixture.plan);
  });

  test("every exception is a fixture", () => {
    for (const name of exceptions.keys()) {
      expect(fixtures).toHaveProperty(name);
    }
  });
});
