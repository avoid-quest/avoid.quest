import { describe, expect, test } from "bun:test";
import { Mixing, StereoMatrix } from "@opendaw/lib-dsp";
import type { EffectChainConfig } from "@/lib/audio/dsp/effects/types";
import {
  OfflineGraph,
  type OfflineNode,
  residualDb,
  testProgram,
} from "@/lib/audio/routing/offline-graph";
import type { EffectsRuntimeOutcome } from "@/lib/channel-effects";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import { compile, endpointKey } from "@/lib/node-graph/compile";
import { type NodeGraphInput, nodeGraphSchema } from "@/lib/node-graph/schema";
import { createParameters } from "./params";
import { RoutingGraph } from "./routing";

type NodeInput = NodeGraphInput["nodes"][number];
type EdgeInput = NodeGraphInput["edges"][number];

const FRAMES = 9600;
const TAIL = 4800;
const position = { x: 0, y: 0 };
const ready: EffectsRuntimeOutcome = {
  backend: "official",
  ready: true,
  status: "ready",
};

function cable(
  source: string,
  target: string,
  extra: Partial<EdgeInput> & { from?: string } = {}
): EdgeInput {
  const { from = "main", ...rest } = extra;
  return {
    id: `${source}->${target}`,
    source,
    sourceHandle: `out:audio:${from}`,
    target,
    targetHandle: "in:audio:main",
    ...rest,
  };
}

function nodes(splitNode: NodeInput): NodeInput[] {
  return [
    {
      data: {
        radio: { id: "a", name: "a", streamUrl: "https://example.com/a" },
      },
      id: "a",
      position,
      type: "station",
    },
    splitNode,
    {
      data: {
        effect: {
          ...createNodeEffectConfig("compressor", "fx"),
          enabled: true,
        },
      },
      id: "fx",
      position,
      type: "compressor",
    } as NodeInput,
    { data: { deviceId: "usb" }, id: "desk", position, type: "deviceOut" },
    { data: {}, id: "speakers", position, type: "speakers" },
  ] as NodeInput[];
}

/**
 * Plays station a through `split` into the patch, a's lane sends included,
 * and renders what each output takes. Every unit's FX is a straight wire,
 * so what reaches an output is the split's port as the unit hears it.
 */
function play(splitNode: NodeInput, edges: EdgeInput[]) {
  const compiled = (cables: EdgeInput[]) =>
    compile(
      nodeGraphSchema.parse({
        edges: cables,
        nodes: nodes(splitNode),
        version: 2,
      }),
      { crossOriginIsolated: true }
    );
  const plan = compiled(edges);
  expect(plan.issues).toEqual([]);
  /** Each send an output took, by sink id. */
  const sent = new Map<string, OfflineNode[]>();
  const graph = new OfflineGraph();
  const [left, right] = testProgram(FRAMES);
  const source = graph.createSource(left, right);
  const outputs = new Map<string, OfflineNode>();
  const routing = new RoutingGraph({
    attachEffects: (_id, input, output) => {
      (input as unknown as OfflineNode).connect(
        output as unknown as OfflineNode
      );
      return Promise.resolve(ready);
    },
    connectKey: () => undefined,
    detachEffects: () => undefined,
    onFailure: (error) => {
      throw error;
    },
    outcomeChanged: () => undefined,
    parameters: (soundId, unit, active) =>
      createParameters({
        active,
        audio: {
          getEffectsRuntimeOutcome: () => ready,
          getStripNodes: () => null,
        },
        effects: { setEffectFields: () => "applied" },
        plan: unit,
        soundId,
      }),
    reconcileEffects: () => Promise.resolve(ready),
    releaseKey: () => undefined,
    routeSink: (sinkId, send) => {
      const output = outputs.get(sinkId) ?? graph.createGain();
      outputs.set(sinkId, output);
      (send as unknown as OfflineNode).connect(output);
      sent.set(sinkId, [
        ...(sent.get(sinkId) ?? []),
        send as unknown as OfflineNode,
      ]);
      return () => undefined;
    },
    sendOverlay: () => undefined,
    setEffectFields: () => "applied",
    subscribeOutcome: () => () => undefined,
    wait: () => new Promise<void>(() => undefined),
  });
  routing.apply(plan);
  for (const lane of plan.cables.values()) {
    if (lane.from.kind === "lane") {
      const send = graph.createGain();
      send.gain.value = lane.muted ? 0 : lane.gain;
      source.connect(send);
      routing.route(endpointKey(lane.to), send as unknown as AudioNode, false);
    }
  }
  const silence = new Float32Array(FRAMES);
  return {
    /** Takes the patch with these cables; fades out never end. */
    apply: (cables: EdgeInput[]) => routing.apply(compiled(cables)),
    input: [left, right],
    output: (sinkId: string) => {
      const node = outputs.get(sinkId);
      return node ? graph.render(node, FRAMES) : [silence, silence];
    },
    sent: (sinkId: string) => sent.get(sinkId) ?? [],
    sum: () => {
      const all = graph.createGain();
      for (const node of outputs.values()) {
        node.connect(all);
      }
      return graph.render(all, FRAMES);
    },
  };
}

function split(
  type: "fxComposite" | "frequencySplit",
  overrides: Record<string, unknown> = {},
  chains: (chain: EffectChainConfig, index: number) => EffectChainConfig = (
    chain
  ) => chain
): NodeInput {
  const base = createNodeEffectConfig(type, "split");
  return {
    data: {
      effect: {
        ...base,
        enabled: true,
        ...overrides,
        chains: base.chains.map(chains),
      },
    },
    id: "split",
    position,
    type,
  } as NodeInput;
}

/** The input through one open branch: its gain and its balance. */
function branch(input: Float32Array[], gain: number, pan: number) {
  const [toLeft, toRight] = StereoMatrix.panningToGains(pan, Mixing.Linear);
  return input.map((channel, side) =>
    channel.map((x) => x * gain * (side === 0 ? toLeft : toRight))
  );
}

const SILENCE = [new Float32Array(FRAMES), new Float32Array(FRAMES)];

describe("Splits whose branches go different places", () => {
  const twoWays = (
    cables: { fx?: Partial<EdgeInput>; desk?: Partial<EdgeInput> } = {}
  ) => [
    cable("a", "split"),
    cable("split", "fx", { from: "branch-1", ...cables.fx }),
    cable("fx", "speakers"),
    cable("split", "desk", { from: "branch-2", ...cables.desk }),
  ];
  const shaped = (chain: EffectChainConfig, index: number) => ({
    ...chain,
    gain: index === 0 ? 0.5 : 1,
    pan: index === 0 ? -0.5 : 0.5,
  });

  test("each branch keeps its gain and pan, with FX on it or not", () => {
    const played = play(split("fxComposite", { dryWet: 1 }, shaped), twoWays());

    // Branch 1 runs through the FX unit to Speakers; branch 2 is FX-free.
    expect(
      residualDb(
        played.output("speakers"),
        branch(played.input, 0.5, -0.5),
        TAIL
      )
    ).toBeLessThan(-90);
    expect(
      residualDb(played.output("desk"), branch(played.input, 1, 0.5), TAIL)
    ).toBeLessThan(-90);
  });

  test("a cable's gain acts before the FX and after it", () => {
    const before = play(
      split("fxComposite", { dryWet: 1 }, shaped),
      twoWays({ fx: { gain: 0.5 } })
    );
    expect(
      residualDb(
        before.output("speakers"),
        branch(before.input, 0.25, -0.5),
        TAIL
      )
    ).toBeLessThan(-90);
    const after = play(split("fxComposite", { dryWet: 1 }, shaped), [
      ...twoWays().filter((edge) => edge.id !== "fx->speakers"),
      cable("fx", "speakers", { gain: 0.5 }),
    ]);
    expect(
      residualDb(
        after.output("speakers"),
        branch(after.input, 0.25, -0.5),
        TAIL
      )
    ).toBeLessThan(-90);
  });

  test("an uncabled port keeps feeding its cable until that cable faded out", () => {
    const bands = split(
      "frequencySplit",
      { crossoverFrequencies: [300, 3000] },
      (chain) => ({ ...chain, gain: 1, pan: 0 })
    );
    const { effect } = bands.data as { effect: { chains: unknown[] } };
    effect.chains = effect.chains.slice(0, 3);
    const cables = [
      cable("a", "split"),
      cable("split", "fx", { from: "band-1" }),
      cable("fx", "speakers"),
      cable("split", "desk", { from: "band-2" }),
      { ...cable("split", "desk", { from: "band-3" }), id: "high" },
    ];
    const played = play(bands, cables);
    const before = played.output("desk");

    // Band 2's cable goes; band 3 still goes its own way, so the Split
    // stays open. Held where it was, band 2's fading cable still plays.
    played.apply(cables.filter((edge) => edge.id !== "split->desk"));
    for (const send of played.sent("desk")) {
      send.gain.value = 1;
    }

    expect(residualDb(played.output("desk"), before, TAIL)).toBeLessThan(-90);
  });

  test("a muted branch, and one a solo leaves out, go silent with FX or not", () => {
    const muted = play(
      split("fxComposite", { dryWet: 1 }, (chain, index) => ({
        ...shaped(chain, index),
        muted: index === 0,
      })),
      twoWays()
    );
    expect(residualDb(muted.output("speakers"), SILENCE, TAIL)).toBeLessThan(
      -90
    );
    expect(
      residualDb(muted.output("desk"), branch(muted.input, 1, 0.5), TAIL)
    ).toBeLessThan(-90);

    // A cable's solo joins the configured ones: branch 2 alone plays.
    const soloed = play(
      split("fxComposite", { dryWet: 1 }, shaped),
      twoWays({ desk: { solo: true } })
    );
    expect(residualDb(soloed.output("speakers"), SILENCE, TAIL)).toBeLessThan(
      -90
    );
    expect(
      residualDb(soloed.output("desk"), branch(soloed.input, 1, 0.5), TAIL)
    ).toBeLessThan(-90);
  });

  test.each([0, 0.5, 1])(
    "the branches together sum to the rejoined Split's output at mix %p",
    (dryWet) => {
      const played = play(
        split("fxComposite", { dryWet, inputGain: 0.5, outputGain: 2 }, shaped),
        twoWays()
      );
      const wet = [
        branch(played.input, 0.5, -0.5),
        branch(played.input, 1, 0.5),
      ];
      const rejoined = played.input.map((channel, side) =>
        channel.map(
          (x, frame) =>
            2 *
            ((1 - dryWet) * x +
              dryWet *
                0.5 *
                ((wet[0][side]?.[frame] ?? 0) + (wet[1][side]?.[frame] ?? 0)))
        )
      );
      expect(residualDb(played.sum(), rejoined, TAIL)).toBeLessThan(-60);
    }
  );

  test("a bypassed Split keeps the level it came in at", () => {
    const played = play(
      split("fxComposite", { enabled: false, outputGain: 3 }, shaped),
      twoWays()
    );
    expect(residualDb(played.sum(), played.input, TAIL)).toBeLessThan(-60);
  });

  test.each([true, false])(
    "Band Split ports sent different ways sum back to the input, enabled=%p",
    (enabled) => {
      const bands = split(
        "frequencySplit",
        { crossoverFrequencies: [300, 3000], enabled },
        (chain) => ({ ...chain, gain: 1, pan: 0 })
      );
      const { effect } = bands.data as { effect: { chains: unknown[] } };
      effect.chains = effect.chains.slice(0, 3);
      const played = play(bands, [
        cable("a", "split"),
        cable("split", "fx", { from: "band-1" }),
        cable("fx", "speakers"),
        cable("split", "desk", { from: "band-2" }),
        { ...cable("split", "speakers", { from: "band-3" }), id: "high" },
      ]);
      expect(residualDb(played.sum(), played.input, TAIL)).toBeLessThan(-60);
    }
  );
});
