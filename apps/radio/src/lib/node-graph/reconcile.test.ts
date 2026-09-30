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
  return compile(nodeGraphSchema.parse({ edges, nodes, version: 1 }), {
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

  test("a param-only change yields only setLaneEffects", () => {
    const next = base({ verb: { decay: 0.9, dryWet: 0.4 } });
    const ops = diff(base(), next);
    expect(ops).toEqual([
      {
        effects: next.lanes.get("a")?.effects ?? [],
        laneId: "a",
        type: "setLaneEffects",
      },
    ]);
  });

  test("bypassing the first FX moves the signal trim to the next FX", () => {
    expect(types(diff(base(), base({ verb: { enabled: false } })))).toEqual([
      "duckLane",
      "replaceLaneEffects",
      "unduckLane",
    ]);
  });

  test("leading cable trim changes keep the same native layout", () => {
    const withTrim = (gain: number) =>
      plan(
        [station("a"), fx("verb", "cheapReverb", { enabled: true }), speakers],
        [audio("a", "verb", { gain }), audio("verb", "speakers")]
      );
    expect(types(diff(withTrim(1), withTrim(0.5)))).toEqual(["setLaneEffects"]);
  });

  test.each([
    ["add", ["verb"], ["verb", "crush"]],
    ["remove", ["verb", "crush"], ["crush"]],
    ["reorder", ["verb", "crush"], ["crush", "verb"]],
  ])("an FX %s ducks, replaces and unducks the lane", (_label, from, to) => {
    const next = base({ order: to });
    const ops = diff(base({ order: from }), next);
    expect(ops).toEqual([
      { laneId: "a", type: "duckLane" },
      {
        effects: next.lanes.get("a")?.effects ?? [],
        laneId: "a",
        type: "replaceLaneEffects",
      },
      { laneId: "a", type: "unduckLane" },
    ]);
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

  test("a cable level or mute change is a setParam", () => {
    const cable = (gain: number, muted: boolean) =>
      plan([station("a"), speakers], [audio("a", "speakers", { gain, muted })]);
    expect(diff(cable(1, false), cable(0.5, true))).toEqual([
      {
        id: "a->speakers",
        param: "gain",
        target: "edge",
        type: "setParam",
        value: 0.5,
      },
      {
        id: "a->speakers",
        param: "muted",
        target: "edge",
        type: "setParam",
        value: true,
      },
    ]);
  });

  test("a new cable is added and a deleted one removed", () => {
    const loose = plan([station("a"), speakers], []);
    const wired = plan([station("a"), speakers], [audio("a", "speakers")]);
    expect(diff(loose, wired)).toEqual([
      { edge: wired.edges.get("a->speakers"), type: "addEdge" } as Op,
    ]);
    expect(diff(wired, loose)).toEqual([
      { edgeId: "a->speakers", type: "removeEdge" },
    ]);
  });

  test("dragging a cable end to another lane rewires it", () => {
    const from = (source: string) =>
      plan(
        [station("a"), station("b"), speakers],
        [audio(source, "speakers", { id: "cable" })]
      );
    const previous = from("a");
    const next = from("b");
    expect(diff(previous, next)).toEqual([
      {
        edge: next.edges.get("cable"),
        previous: previous.edges.get("cable"),
        type: "rewireEdge",
      } as Op,
    ]);
  });

  test("a new station adds its lane before its cable", () => {
    const previous = base();
    const next = base(
      {},
      { edges: [audio("c", "speakers")], nodes: [station("c")] }
    );
    expect(diff(previous, next)).toEqual([
      { lane: next.lanes.get("c"), type: "addLane" } as Op,
      { edge: next.edges.get("c->speakers"), type: "addEdge" } as Op,
    ]);
  });

  test("a deleted station removes its cable before its lane", () => {
    const previous = base(
      {},
      { edges: [audio("c", "speakers")], nodes: [station("c")] }
    );
    expect(diff(previous, base())).toEqual([
      { edgeId: "c->speakers", type: "removeEdge" },
      { laneId: "c", soundId: "node:n:c", type: "removeLane" },
    ]);
  });

  test("a new stream on the same node replaces the lane", () => {
    const tuned = (streamUrl: string) =>
      plan([station("a", streamUrl), speakers], [audio("a", "speakers")]);
    const next = tuned("https://example.com/other.mp3");
    expect(diff(tuned("https://example.com/a.mp3"), next)).toEqual([
      { edgeId: "a->speakers", type: "removeEdge" },
      { laneId: "a", soundId: "node:n:a", type: "removeLane" },
      { lane: next.lanes.get("a"), type: "addLane" } as Op,
      { edge: next.edges.get("a->speakers"), type: "addEdge" } as Op,
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
      { edgeId: "a->speakers", type: "removeEdge" },
      { laneId: "a", soundId: "node:n:a", type: "removeLane" },
      { lane: next.lanes.get("a"), type: "addLane" } as Op,
      { edge: next.edges.get("a->speakers"), type: "addEdge" } as Op,
    ]);
    expect(diff(next, formatted("hls"))).toEqual([]);
  });

  test("a cable moved off a lane that goes away is removed, not rewired", () => {
    const previous = plan(
      [station("a"), station("b"), speakers],
      [audio("a", "speakers", { id: "cable" })]
    );
    const next = plan(
      [station("b"), speakers],
      [audio("b", "speakers", { id: "cable" })]
    );
    expect(diff(previous, next)).toEqual([
      { edgeId: "cable", type: "removeEdge" },
      { laneId: "a", soundId: "node:n:a", type: "removeLane" },
      { edge: next.edges.get("cable"), type: "addEdge" } as Op,
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
