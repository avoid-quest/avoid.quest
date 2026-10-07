import { describe, expect, test } from "bun:test";
import type { EffectConfig, EffectType } from "@/lib/audio/dsp/effects/types";
import { createNodeEffectConfig } from "./catalogue";
import { compile, type EnginePlan } from "./compile";
import { diff, type Op } from "./reconcile";
import { type NodeGraphInput, type NodeType, nodeGraphSchema } from "./schema";

type NodeInput = NodeGraphInput["nodes"][number];
type EdgeInput = NodeGraphInput["edges"][number];

const position = { x: 0, y: 0 };

function station(id: string, streamUrl = `https://example.com/${id}.mp3`) {
  return {
    data: { radio: { id, name: id, streamUrl } },
    id,
    position,
    type: "station",
  } satisfies NodeInput;
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
    id = `${source}->${target}`,
    ...rest
  }: { id?: string; gain?: number; muted?: boolean } = {}
): EdgeInput {
  return {
    id,
    source,
    sourceHandle: "out:audio:main",
    target,
    targetHandle: "in:audio:main",
    ...rest,
  };
}

function plan(nodes: NodeInput[], edges: EdgeInput[]): EnginePlan {
  return compile(nodeGraphSchema.parse({ edges, nodes, version: 2 }), {
    crossOriginIsolated: true,
  });
}

function types(ops: readonly Op[]): string[] {
  return ops.map((op) => op.type);
}

/** Station a through reverb and crusher to Speakers; b straight there. */
function base(
  {
    verb = {},
    order = ["verb", "crush"],
  }: { verb?: Partial<EffectConfig>; order?: string[] } = {},
  extra: { nodes?: NodeInput[]; edges?: EdgeInput[] } = {}
): EnginePlan {
  const chain = ["a", ...order];
  const effects: Record<string, NodeInput> = {
    crush: fx("crush", "crusher", { enabled: true }),
    verb: fx("verb", "cheapReverb", { enabled: true, ...verb }),
  };
  return plan(
    [
      station("a"),
      station("b"),
      ...order.map((id) => effects[id] as NodeInput),
      speakers,
      ...(extra.nodes ?? []),
    ],
    [
      ...chain.slice(1).map((id, index) => audio(chain[index] ?? "a", id)),
      audio(chain.at(-1) ?? "a", "speakers", { id: "a-out" }),
      audio("b", "speakers", { id: "b-out" }),
      ...(extra.edges ?? []),
    ]
  );
}

describe("diff", () => {
  test("an identical plan yields no ops", () => {
    expect(diff(base(), base())).toEqual([]);
  });

  test("a Track's speed, loop and cue listen are params, never a new sound", () => {
    const track = (strip: Record<string, unknown>) =>
      plan(
        [
          {
            data: {
              radio: {
                id: "t",
                name: "t",
                streamUrl: "https://example.com/t.mp3",
              },
              strip,
            },
            id: "t",
            position,
            type: "file",
          },
          speakers,
        ],
        [audio("t", "speakers")]
      );
    expect(
      diff(track({}), track({ cueListen: true, loop: true, speed: 1.25 }))
    ).toEqual([
      {
        id: "t",
        param: "transport",
        target: "lane",
        type: "setParam",
        value: { keyLock: true, loop: true, speed: 1.25 },
      },
      {
        id: "t",
        param: "cueListen",
        target: "lane",
        type: "setParam",
        value: true,
      },
    ]);
    // A trim or solo is a cable level: its sound and fader stay.
    expect(diff(track({}), track({ trimDb: -6 }))).toEqual([]);
    expect(track({ trimDb: -6 }).cables.get("t->speakers")?.gain).toBeCloseTo(
      0.501,
      3
    );
  });

  test("a param-only change writes only the changed effect", () => {
    const next = base({ verb: { decay: 0.9, dryWet: 0.4 } });
    const ops = diff(base(), next);
    expect(ops).toEqual([
      {
        effectId: "verb",
        laneId: "a",
        type: "setEffectFields",
      },
    ]);
  });

  test("bypassing the first FX moves the signal trim to the next FX", () => {
    expect(types(diff(base(), base({ verb: { enabled: false } })))).toEqual([
      "replaceLaneEffects",
    ]);
  });

  test("leading cable trim changes keep the same native layout", () => {
    const withTrim = (gain: number) =>
      plan(
        [station("a"), fx("verb", "cheapReverb", { enabled: true }), speakers],
        [audio("a", "verb", { gain }), audio("verb", "speakers")]
      );
    expect(types(diff(withTrim(1), withTrim(0.5)))).toEqual([
      "setEffectFields",
    ]);
  });

  test("toggling a unity Autotune updates effects without ducking the lane", () => {
    const autotuned = (enabled: boolean) =>
      plan(
        [
          station("a"),
          fx("verb", "cheapReverb", { enabled: true }),
          fx("tune", "autotune", { enabled }),
          speakers,
        ],
        [audio("a", "verb"), audio("verb", "tune"), audio("tune", "speakers")]
      );
    expect(types(diff(autotuned(true), autotuned(false)))).toEqual([
      "setEffectFields",
    ]);
    expect(types(diff(autotuned(false), autotuned(true)))).toEqual([
      "setEffectFields",
    ]);
  });

  test("toggling the only effect reselects the lane backend", () => {
    const autotuned = (enabled: boolean) =>
      plan(
        [
          station("a"),
          fx("tune", "autotune", { enabled, signalGain: 1 }),
          speakers,
        ],
        [audio("a", "tune"), audio("tune", "speakers")]
      );
    const on = autotuned(true);
    const off = autotuned(false);
    expect(on.lanes.get("a")?.backend).toBe("official");
    expect(off.lanes.get("a")?.backend).toBeNull();
    expect(on.lanes.get("a")?.layoutSignature).toBe(
      off.lanes.get("a")?.layoutSignature
    );
    for (const [previous, next] of [
      [on, off],
      [off, on],
    ] as const) {
      expect(diff(previous, next)).toEqual([
        {
          effects: next.lanes.get("a")?.effects ?? [],
          laneId: "a",
          type: "setLaneEffects",
        },
      ]);
    }
  });

  test("freeing monitoring channels reselects an unchanged downstream lane", () => {
    const lanes = ["a", "b", "c", "d", "e"];
    const budgeted = (enabled: boolean) =>
      plan(
        [
          ...lanes.map((id) => station(id)),
          ...lanes.map((id) =>
            fx(`${id}-fx`, "autotune", { enabled: id !== "a" || enabled })
          ),
          speakers,
        ],
        lanes.flatMap((id) => [
          audio(id, `${id}-fx`),
          audio(`${id}-fx`, "speakers"),
        ])
      );
    const before = budgeted(true);
    const after = budgeted(false);
    expect(before.lanes.get("e")?.backend).toBe("compat");
    expect(after.lanes.get("e")?.backend).toBe("official");
    expect(before.lanes.get("e")?.effects).toEqual(
      after.lanes.get("e")?.effects
    );
    expect(diff(before, after)).toContainEqual({
      effects: after.lanes.get("e")?.effects ?? [],
      laneId: "e",
      type: "setLaneEffects",
    });
  });

  test("enabling a keyed effect rebinds the active sidechain on the same backend", () => {
    const keyed = (enabled: boolean) =>
      plan(
        [
          station("music"),
          station("talk"),
          fx("verb", "cheapReverb", { enabled: true }),
          fx("comp", "compressor", { enabled }),
          speakers,
        ],
        [
          audio("music", "verb"),
          audio("verb", "comp"),
          audio("comp", "speakers"),
          audio("talk", "speakers"),
          {
            ...audio("talk", "comp"),
            id: "key",
            targetHandle: "in:sidechain:key",
          },
        ]
      );
    const before = keyed(false);
    const after = keyed(true);
    expect(before.lanes.get("music")?.backend).toBe(
      after.lanes.get("music")?.backend
    );
    expect(before.lanes.get("music")?.layoutSignature).toBe(
      after.lanes.get("music")?.layoutSignature
    );
    expect(diff(before, after)).toEqual([
      {
        effects: after.lanes.get("music")?.effects ?? [],
        laneId: "music",
        type: "setLaneEffects",
      },
    ]);
  });

  test.each([
    ["add", ["verb"], ["verb", "crush"]],
    ["remove", ["verb", "crush"], ["crush"]],
    ["reorder", ["verb", "crush"], ["crush", "verb"]],
  ])("an FX %s replaces the lane's layout", (_label, from, to) => {
    const next = base({ order: to });
    const ops = diff(base({ order: from }), next);
    expect(ops).toEqual([
      {
        effects: next.lanes.get("a")?.effects ?? [],
        laneId: "a",
        type: "replaceLaneEffects",
      },
    ]);
  });

  test("a trim after a default Autotune keeps its direct layout", () => {
    const autotuned = ({
      gainDb = 0,
      muted = false,
    }: {
      gainDb?: number;
      muted?: boolean;
    } = {}) =>
      plan(
        [
          station("a"),
          fx("tune", "autotune", { enabled: true }),
          node("gain", "gain", { gainDb }),
          fx("delay", "delay", { enabled: true }),
          speakers,
        ],
        [
          audio("a", "tune"),
          audio("tune", "gain", { muted }),
          audio("gain", "delay"),
          audio("delay", "speakers"),
        ]
      );
    const unity = autotuned();
    const nudged = autotuned({ gainDb: -0.1 });

    expect(types(diff(unity, nudged))).toEqual(["setEffectFields"]);
    expect(types(diff(nudged, unity))).toEqual(["setEffectFields"]);
    expect(types(diff(unity, autotuned({ muted: true })))).not.toContain(
      "replaceLaneEffects"
    );
    const [tune, delay] = nudged.lanes.get("a")?.effects ?? [];
    expect(tune?.outputGain).toBe(1);
    expect(delay?.signalGain).toBeCloseTo(10 ** (-0.1 / 20));
  });

  test("a native pan or filter change is a setParam", () => {
    const strip = (pan: number, frequency: number) =>
      plan(
        [
          station("a"),
          node("pan", "pan", { pan }),
          node("cut", "filter", { frequency }),
          speakers,
        ],
        [audio("a", "pan"), audio("pan", "cut"), audio("cut", "speakers")]
      );
    expect(diff(strip(0, 1000), strip(-1, 400))).toEqual([
      { id: "a", param: "pan", target: "lane", type: "setParam", value: -1 },
      {
        id: "a",
        param: "filter",
        target: "lane",
        type: "setParam",
        value: { frequency: 400, Q: 1, type: "lowpass" },
      },
    ]);
  });

  test("a Station volume or mute change is a setParam, volume first", () => {
    const level = (volume: number, muted: boolean) =>
      plan(
        [
          { ...station("a"), data: { ...station("a").data, muted, volume } },
          speakers,
        ],
        [audio("a", "speakers")]
      );
    expect(diff(level(1, false), level(0.4, false))).toEqual([
      {
        id: "a",
        param: "volume",
        target: "lane",
        type: "setParam",
        value: 0.4,
      },
    ]);
    expect(diff(level(1, true), level(0.4, false))).toEqual([
      {
        id: "a",
        param: "volume",
        target: "lane",
        type: "setParam",
        value: 0.4,
      },
      {
        id: "a",
        param: "muted",
        target: "lane",
        type: "setParam",
        value: false,
      },
    ]);
  });

  test("cables need no ops: the engine's routing follows each plan", () => {
    const cable = (source: string, gain: number, muted: boolean) =>
      plan(
        [station("a"), station("b"), speakers],
        [audio(source, "speakers", { gain, id: "cable", muted })]
      );
    const loose = plan([station("a"), station("b"), speakers], []);
    expect(diff(cable("a", 1, false), cable("a", 0.5, true))).toEqual([]);
    expect(diff(loose, cable("a", 1, false))).toEqual([]);
    expect(diff(cable("a", 1, false), cable("b", 1, false))).toEqual([]);
  });

  test("a new station adds its lane", () => {
    const previous = base();
    const next = base(
      {},
      { edges: [audio("c", "speakers")], nodes: [station("c")] }
    );
    expect(diff(previous, next)).toEqual([
      { lane: next.lanes.get("c"), type: "addLane" } as Op,
    ]);
  });

  test("a deleted station removes its lane", () => {
    const previous = base(
      {},
      { edges: [audio("c", "speakers")], nodes: [station("c")] }
    );
    expect(diff(previous, base())).toEqual([
      { laneId: "c", soundId: "node:n:c", type: "removeLane" },
    ]);
  });

  test("a new stream on the same node replaces the lane", () => {
    const tuned = (streamUrl: string) =>
      plan([station("a", streamUrl), speakers], [audio("a", "speakers")]);
    const next = tuned("https://example.com/other.mp3");
    expect(diff(tuned("https://example.com/a.mp3"), next)).toEqual([
      { laneId: "a", soundId: "node:n:a", type: "removeLane" },
      { lane: next.lanes.get("a"), type: "addLane" } as Op,
    ]);
  });

  test("a corrected stream format on the same stream replaces the lane", () => {
    const formatted = (streamFormat?: string) =>
      plan(
        [
          {
            ...station("a"),
            data: {
              radio: {
                id: "a",
                name: "a",
                streamFormat,
                streamUrl: "https://example.com/a",
              },
            },
          },
          speakers,
        ],
        [audio("a", "speakers")]
      );
    const next = formatted("hls");
    expect(diff(formatted(), next)).toEqual([
      { laneId: "a", soundId: "node:n:a", type: "removeLane" },
      { lane: next.lanes.get("a"), type: "addLane" } as Op,
    ]);
    expect(diff(next, formatted("hls"))).toEqual([]);
  });

  test("a cable moved off a lane that goes away needs only the lane's removal", () => {
    const previous = plan(
      [station("a"), station("b"), speakers],
      [audio("a", "speakers", { id: "cable" })]
    );
    const next = plan(
      [station("b"), speakers],
      [audio("b", "speakers", { id: "cable" })]
    );
    expect(diff(previous, next)).toEqual([
      { laneId: "a", soundId: "node:n:a", type: "removeLane" },
    ]);
  });

  test("a key cable is a param change on the keyed lane", () => {
    const keyed = (withKey: boolean) =>
      plan(
        [
          station("music"),
          station("talk"),
          fx("comp", "compressor", { enabled: true }),
          speakers,
        ],
        [
          audio("music", "comp"),
          audio("comp", "speakers"),
          ...(withKey
            ? [
                {
                  id: "key",
                  source: "talk",
                  sourceHandle: "out:audio:main",
                  target: "comp",
                  targetHandle: "in:sidechain:key",
                },
              ]
            : []),
        ]
      );
    expect(types(diff(keyed(false), keyed(true)))).toEqual(["setLaneEffects"]);
  });
});

describe("diff: audio inputs", () => {
  function mic(data: Record<string, unknown> = {}) {
    return plan(
      [node("mic", "deviceIn", { deviceId: "usb-mic", ...data }), speakers],
      [audio("mic", "speakers")]
    );
  }

  test("new channels switch live, without a new sound", () => {
    const ops = diff(mic(), mic({ channelSelection: { left: 1, right: 1 } }));

    expect(ops).toEqual([
      {
        id: "mic",
        param: "channelSelection",
        target: "lane",
        type: "setParam",
        value: { left: 1, right: 1 },
      },
    ]);
  });

  test("a new device or echo cancellation starts a new capture", () => {
    expect(types(diff(mic(), mic({ deviceId: "line-in" })))).toEqual([
      "removeLane",
      "addLane",
    ]);
    expect(types(diff(mic(), mic({ echoCancellation: true })))).toEqual([
      "removeLane",
      "addLane",
    ]);
  });

  test("a relabelled device keeps its capture", () => {
    expect(diff(mic(), mic({ deviceLabel: "Desk mic" }))).toEqual([]);
  });
});
