import { describe, expect, test } from "bun:test";
import { Mixing, StereoMatrix } from "@opendaw/lib-dsp";
import type { EffectChainConfig } from "@/lib/audio/dsp/effects/types";
import {
  OfflineGraph,
  OfflineNode,
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
    {
      data: {
        effect: { ...createNodeEffectConfig("gate", "gate"), enabled: true },
      },
      id: "gate",
      position,
      type: "gate",
    } as NodeInput,
    { data: { deviceId: "usb" }, id: "desk", position, type: "deviceOut" },
    { data: {}, id: "speakers", position, type: "speakers" },
  ] as NodeInput[];
}

/**
 * Plays station a through `split` into the patch, a's lane sends included,
 * and renders what each output takes. Every unit's FX is `fx` sample by
 * sample, a straight wire unless a test says, so what reaches an output is
 * the split's port as the unit hears it.
 */
function play(
  splitNode: NodeInput,
  edges: EdgeInput[],
  fx: (sample: number) => number = (sample) => sample
) {
  const compiled = (cables: EdgeInput[], node = splitNode) =>
    compile(
      nodeGraphSchema.parse({
        edges: cables,
        nodes: nodes(node),
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
  const keys = new Map<string, OfflineNode>();
  const fades: (() => void)[] = [];
  const routing = new RoutingGraph({
    attachEffects: (_id, input, output) => {
      const effect = new OfflineNode(graph, ([signal = []]) => [
        signal.map((channel) => channel.map(fx)),
      ]);
      (input as unknown as OfflineNode).connect(effect);
      effect.connect(output as unknown as OfflineNode);
      return Promise.resolve(ready);
    },
    connectKey: (id, input) => {
      keys.set(id, input as unknown as OfflineNode);
    },
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
          hasEffectModulationField: () => true,
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
    wait: () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      fades.push(() => resolve());
      return promise;
    },
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
    /** Takes the patch with these cables; fades end with `endFades`. */
    apply: (cables: EdgeInput[], node?: NodeInput) =>
      routing.apply(compiled(cables, node)),
    /** Ends every fade under way, and what waits on it. */
    endFades: async () => {
      for (const end of fades.splice(0)) {
        end();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    input: [left, right],
    key: (effectId: string) => {
      const effect = [...plan.units.values()]
        .flatMap((unit) => unit.effects)
        .find((config) => config.id === effectId);
      const key = effect?.sidechain?.channelId;
      const input = key ? keys.get(key) : undefined;
      if (!input) {
        throw new Error(`No key for ${effectId}`);
      }
      return graph.render(input, FRAMES);
    },
    output: (sinkId: string) => {
      const node = outputs.get(sinkId);
      return node ? graph.render(node, FRAMES) : [silence, silence];
    },
    /** What leaves `node`, `progress` of the way through the fades under way. */
    sending: (node: OfflineNode, progress = 1) => {
      graph.progress = progress;
      const signal = graph.render(node, FRAMES);
      graph.progress = 1;
      return signal;
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
  type: "fxComposite" | "frequencySplit" | "stereoSplit",
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

  /** Station a into a Band Split at three bands; bands 2 and 3 to the desk. */
  const threeBands = (crossoverFrequencies = [300, 3000], count = 3) => {
    const bands = split(
      "frequencySplit",
      { crossoverFrequencies },
      (chain) => ({ ...chain, gain: 1, pan: 0 })
    );
    const { effect } = bands.data as { effect: { chains: unknown[] } };
    effect.chains = effect.chains.slice(0, count);
    return bands;
  };
  const bandCables = [
    cable("a", "split"),
    cable("split", "fx", { from: "band-1" }),
    cable("fx", "speakers"),
    cable("split", "desk", { from: "band-2" }),
    { ...cable("split", "desk", { from: "band-3" }), id: "high" },
  ];

  test("an uncabled port keeps feeding its cable until that cable faded out, then goes", async () => {
    const played = play(threeBands(), bandCables);
    const before = played.output("desk");

    // Band 2's cable goes; band 3 still goes its own way, so the Split
    // stays open. Held where it was, band 2's fading cable still plays.
    const kept = bandCables.filter((edge) => edge.id !== "split->desk");
    played.apply(kept);
    const fading = played.sent("desk");
    for (const send of fading) {
      send.gain.value = 1;
    }
    expect(residualDb(played.output("desk"), before, TAIL)).toBeLessThan(-90);

    // Once it faded out, band 2 is let go: the desk hears band 3 alone.
    await played.endFades();
    const alone = play(threeBands(), kept);
    expect(
      residualDb(played.output("desk"), alone.output("desk"), TAIL)
    ).toBeLessThan(-90);
  });

  test("a band a smaller Band Split drops keeps feeding its cable until it faded out", async () => {
    const cables = [
      ...bandCables.filter((edge) => edge.id !== "high"),
      { ...cable("split", "speakers", { from: "band-3" }), id: "high" },
    ];
    const played = play(threeBands(), cables);
    const before = played.output("speakers");

    // Two bands now: band 3 and its cable go.
    played.apply(
      cables.filter((edge) => edge.id !== "high"),
      threeBands([300], 2)
    );
    for (const send of played.sent("speakers")) {
      send.gain.value = 1;
    }
    // The fading cable still hears band 3, in the layout it had.
    expect(residualDb(played.output("speakers"), before, TAIL)).toBeLessThan(
      -90
    );
    await played.endFades();
    const smaller = play(
      threeBands([300], 2),
      cables.filter((edge) => edge.id !== "high")
    );
    for (const sink of ["speakers", "desk"]) {
      expect(
        residualDb(played.output(sink), smaller.output(sink), TAIL)
      ).toBeLessThan(-90);
    }
  });
  test("a four-port Split turned Stereo Split fades its last two ports out, then plays two", async () => {
    const flat = (chain: EffectChainConfig) => ({ ...chain, gain: 1, pan: 0 });
    const fourWays = [
      cable("a", "split"),
      cable("split", "speakers", { from: "branch-1" }),
      cable("split", "desk", { from: "branch-2" }),
      { ...cable("split", "speakers", { from: "branch-3" }), id: "third" },
      { ...cable("split", "desk", { from: "branch-4" }), id: "fourth" },
    ];
    const sides = [
      cable("a", "split"),
      cable("split", "speakers", { from: "left" }),
      cable("split", "desk", { from: "right" }),
    ];
    const stereo = split("stereoSplit", { dryWet: 1 }, flat);
    const played = play(split("fxComposite", { dryWet: 1 }, flat), fourWays);

    const sends = [...played.sent("speakers"), ...played.sent("desk")];
    const before = new Map(sends.map((send) => [send, played.sending(send)]));

    // Same node, now with two ports: branches 3 and 4 fade out first, in
    // the layout they had. Half way (the offline graph takes the approach
    // as linear), they still play, at half their level.
    expect(() => played.apply(sides, stereo)).not.toThrow();
    const fading = sends.filter((send) => send.gain.value === 0);
    expect(fading).toHaveLength(2);
    for (const send of fading) {
      const level = before.get(send) ?? SILENCE;
      expect(
        residualDb(
          played.sending(send, 0.5),
          level.map((channel) => channel.map((x) => x / 2)),
          TAIL
        )
      ).toBeLessThan(-90);
      expect(residualDb(level, SILENCE, TAIL)).toBeGreaterThan(-40);
    }

    // Once they faded out, they are silent, and the two sides play.
    await played.endFades();
    for (const send of fading) {
      expect(residualDb(played.sending(send), SILENCE, TAIL)).toBeLessThan(-90);
    }
    const two = play(stereo, sides);
    for (const sink of ["speakers", "desk"]) {
      expect(
        residualDb(played.output(sink), two.output(sink), TAIL)
      ).toBeLessThan(-90);
    }
  });

  test("a Band Split turned Split fades its dropped band out as that band, then plays whole", async () => {
    const flat = (chain: EffectChainConfig) => ({ ...chain, gain: 1, pan: 0 });
    const branches = [
      cable("a", "split"),
      cable("split", "fx", { from: "branch-1" }),
      cable("fx", "speakers"),
      cable("split", "desk", { from: "branch-2" }),
    ];
    const whole = split("fxComposite", { dryWet: 1 }, flat);
    const played = play(threeBands(), bandCables);

    const sends = played.sent("desk");
    const before = new Map(sends.map((send) => [send, played.sending(send)]));

    // Same node, now a Split: band 3's cable fades out first, still
    // carrying band 3. Half way, it plays band 3 at half its level.
    played.apply(branches, whole);
    const fading = sends.filter((send) => send.gain.value === 0);
    expect(fading).toHaveLength(1);
    for (const send of fading) {
      const level = before.get(send) ?? SILENCE;
      expect(
        residualDb(
          played.sending(send, 0.5),
          level.map((channel) => channel.map((x) => x / 2)),
          TAIL
        )
      ).toBeLessThan(-90);
      expect(residualDb(level, played.input, TAIL)).toBeGreaterThan(-20);
    }

    // Once it faded out, every branch carries the whole signal.
    await played.endFades();
    const plain = play(whole, branches);
    for (const sink of ["speakers", "desk"]) {
      expect(
        residualDb(played.output(sink), plain.output(sink), TAIL)
      ).toBeLessThan(-90);
    }
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

  test("a configured solo and a cable's solo both play; the rest go silent", () => {
    const played = play(
      split("fxComposite", { dryWet: 1 }, (chain, index) => ({
        ...shaped(chain, index),
        solo: index === 0,
      })),
      [
        ...twoWays({ desk: { solo: true } }),
        { ...cable("split", "speakers", { from: "branch-3" }), id: "third" },
      ]
    );
    // Branch 1 through the FX, soloed in the Split; branch 2 by its cable.
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

  test("a branch's gain acts after its FX, its cable's before; their pans add after", () => {
    // A level-dependent effect: it clips at 0.2.
    const clip = (sample: number) => Math.max(-0.2, Math.min(0.2, sample));
    const played = play(
      split("fxComposite", { dryWet: 1 }, shaped),
      twoWays({ desk: { pan: -0.5 }, fx: { gain: 2, pan: 0.75 } }),
      clip
    );
    const into = played.input.map((channel) => channel.map((x) => clip(2 * x)));
    expect(
      residualDb(played.output("speakers"), branch(into, 0.5, 0.25), TAIL)
    ).toBeLessThan(-90);
    // Without FX too: a pan that cancels its chain's leaves it centred.
    expect(residualDb(played.output("desk"), played.input, TAIL)).toBeLessThan(
      -90
    );
  });

  test("signal trim reaches both paths, wet input trim precedes FX, and dry bypasses them", () => {
    const clip = (sample: number) => Math.max(-0.2, Math.min(0.2, sample));
    const played = play(
      split(
        "fxComposite",
        {
          dryWet: 0.25,
          inputGain: 2,
          outputGain: 3,
          signalGain: 0.5,
        },
        shaped
      ),
      twoWays({ fx: { gain: 0.5, pan: 0.5 } }),
      clip
    );
    const into = branch(played.input, 0.5 * 2 * 0.5, 0);
    const wet = branch(
      into.map((channel) => channel.map(clip)),
      0.25 * 3 * 0.5,
      0
    );
    const expected = played.input.map((channel, side) =>
      channel.map(
        (sample, frame) =>
          sample * 0.5 * (1 - 0.25) * 0.5 * 3 + (wet[side]?.[frame] ?? 0)
      )
    );
    expect(residualDb(played.output("speakers"), expected, TAIL)).toBeLessThan(
      -90
    );
  });

  test.each([0, 0.5, 1])(
    "a zero signal trim silences dry and wet at mix %p",
    (dryWet) => {
      const played = play(
        split("fxComposite", { dryWet, signalGain: 0 }, shaped),
        twoWays()
      );
      expect(residualDb(played.sum(), SILENCE, TAIL)).toBeLessThan(-90);
    }
  );

  test("muting a branch silences output generated by its FX", () => {
    const played = play(
      split("fxComposite", { dryWet: 1 }, (chain, index) => ({
        ...shaped(chain, index),
        muted: index === 0,
      })),
      twoWays(),
      (sample) => sample + 0.1
    );
    expect(residualDb(played.output("speakers"), SILENCE, TAIL)).toBeLessThan(
      -90
    );
  });

  test("cables on one port keep their own pan and solo", () => {
    const cables = (solo: boolean) => [
      cable("a", "split"),
      cable("split", "speakers", { from: "branch-1", pan: -1 }),
      cable("split", "desk", { from: "branch-1", pan: 1, solo }),
    ];
    const both = play(
      split("fxComposite", { dryWet: 1 }, shaped),
      cables(false)
    );
    // Each cable's pan adds to the chain's.
    const panned = (pan: number) =>
      branch(both.input, 0.5, Math.max(-1, pan - 0.5));
    expect(residualDb(both.output("speakers"), panned(-1), TAIL)).toBeLessThan(
      -90
    );
    expect(residualDb(both.output("desk"), panned(1), TAIL)).toBeLessThan(-90);

    // The soloed cable leaves its sibling out.
    const soloed = play(
      split("fxComposite", { dryWet: 1 }, shaped),
      cables(true)
    );
    expect(residualDb(soloed.output("speakers"), SILENCE, TAIL)).toBeLessThan(
      -90
    );
    expect(residualDb(soloed.output("desk"), panned(1), TAIL)).toBeLessThan(
      -90
    );
  });

  test("a key from a Split port hears its mixed branch controls and its cable level", () => {
    const played = play(
      split(
        "fxComposite",
        { dryWet: 0.5, inputGain: 0.5, outputGain: 2 },
        shaped
      ),
      [
        ...twoWays({ desk: { solo: true } }),
        {
          ...cable("split", "fx", { from: "branch-2", gain: 0.25 }),
          id: "key",
          targetHandle: "in:sidechain:key",
        },
      ]
    );
    const wet = branch(played.input, 0.5 * 0.5 * 2 * 0.25, 0.5);
    const expected = played.input.map((channel, side) =>
      channel.map(
        (sample, frame) =>
          sample * 0.5 * 0.5 * 2 * 0.25 + (wet[side]?.[frame] ?? 0)
      )
    );
    expect(residualDb(played.key("fx"), expected, TAIL)).toBeLessThan(-90);
  });

  test("a key after branch FX hears its exit controls and dry mix", () => {
    const played = play(split("fxComposite", { dryWet: 0.5 }, shaped), [
      ...twoWays(),
      cable("a", "gate"),
      cable("gate", "desk"),
      {
        ...cable("fx", "gate", { gain: 0.25 }),
        id: "key",
        targetHandle: "in:sidechain:key",
      },
    ]);
    // A steady signal isolates level and balance from key alignment delay.
    played.input[0]?.fill(0.4);
    played.input[1]?.fill(-0.2);
    const wet = branch(played.input, 0.5 * 0.5 * 0.25, -0.5);
    const expected = played.input.map((channel, side) =>
      channel.map(
        (sample, frame) => sample * 0.5 * 0.5 * 0.25 + (wet[side]?.[frame] ?? 0)
      )
    );
    expect(residualDb(played.key("gate"), expected, TAIL)).toBeLessThan(-90);
  });

  test("a key from a port that only keys hears that port's branch", () => {
    const played = play(
      split("stereoSplit", { dryWet: 1 }, (chain) => ({ ...chain, gain: 0.5 })),
      [
        cable("a", "split"),
        cable("a", "gate"),
        cable("gate", "speakers"),
        {
          ...cable("split", "gate", { from: "left" }),
          id: "key",
          targetHandle: "in:sidechain:key",
        },
      ]
    );
    const [left = new Float32Array(FRAMES)] = played.input;
    expect(
      residualDb(
        played.key("gate"),
        [left.map((sample) => sample * 0.5), new Float32Array(FRAMES)],
        TAIL
      )
    ).toBeLessThan(-90);
  });

  test("a port that only keys takes no share of the dry signal", () => {
    const played = play(split("fxComposite", { dryWet: 0.5 }), [
      ...twoWays(),
      cable("a", "gate"),
      cable("gate", "speakers"),
      {
        ...cable("split", "gate", { from: "branch-3" }),
        id: "key",
        targetHandle: "in:sidechain:key",
      },
    ]);
    const gain =
      createNodeEffectConfig("fxComposite", "split").chains[0]?.gain ?? 1;
    // The desk's branch takes half the dry signal, as the fx branch does.
    const desk = played.input.map((channel) =>
      channel.map((sample) => sample * (0.5 * 0.5 + 0.5 * gain))
    );
    expect(residualDb(played.output("desk"), desk, TAIL)).toBeLessThan(-90);
    expect(
      residualDb(played.key("gate"), branch(played.input, 0.5 * gain, 0), TAIL)
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
