import { describe, expect, mock, test } from "bun:test";
import { audioPatchPlan } from "@/lib/node-graph/audio-patch-plan";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import { compile } from "@/lib/node-graph/compile";
import {
  type GraphNode,
  graphEdgeSchema,
  graphNodeSchema,
  type NodeGraphInput,
  nodeGraphSchema,
} from "@/lib/node-graph/schema";
import { analyseGraph } from "@/lib/node-graph/validate";
import { convertEffectConfigToEngine } from "../dsp/effects/engine-conversion";
import { EffectSource } from "../dsp/processor-source";
import {
  FakeAudioContext,
  FakeAudioParam,
  FakeGainNode,
} from "./fake-audio-nodes";
import { createNodeAudioPatch, patchPortEffects } from "./node-audio-patch";

class PatchContext extends FakeAudioContext {
  createStereoPanner(): StereoPannerNode {
    return Object.assign(new FakeGainNode(this), {
      pan: new FakeAudioParam(0),
    }) as unknown as StereoPannerNode;
  }
  createBiquadFilter(): BiquadFilterNode {
    return Object.assign(new FakeGainNode(this), {
      frequency: new FakeAudioParam(0),
      Q: new FakeAudioParam(1),
      type: "lowpass",
    }) as unknown as BiquadFilterNode;
  }
}
const position = { x: 0, y: 0 };
const source = (id: string): NodeGraphInput["nodes"][number] => ({
  data: { radio: { id, name: id, streamUrl: `https://example.com/${id}` } },
  id,
  position,
  type: "station",
});
const fx = (
  id: string,
  type:
    | "crusher"
    | "compressor"
    | "stereoSplit"
    | "frequencySplit"
    | "fxComposite"
): NodeGraphInput["nodes"][number] => ({
  data: { effect: { ...createNodeEffectConfig(type, id), enabled: true } },
  id,
  position,
  type,
});
const cable = (
  id: string,
  sourceId: string,
  target: string,
  sourceHandle = "out:audio:main",
  targetHandle = "in:audio:main"
) => ({ id, source: sourceId, sourceHandle, target, targetHandle });
function patch(nodes: NodeGraphInput["nodes"], edges: NodeGraphInput["edges"]) {
  const graph = nodeGraphSchema.parse({ edges, nodes, version: 2 });
  return { graph, plan: audioPatchPlan(graph, analyseGraph(graph).wired) };
}
function harness() {
  const context = new PatchContext();
  const routes = new Map<string, GainNode>();
  const disconnects = mock(() => undefined);
  const host = {
    connectNodeProcessor: mock(
      (_id: string, processorInput: AudioNode, output: AudioNode) => {
        processorInput.connect(output);
        return Promise.resolve(true);
      }
    ),
    getEffectsRuntimeOutcome: mock(
      () =>
        ({ backend: "compatibility", ready: true, status: "ready" }) as const
    ),
    modulateNodeProcessor: mock(() => undefined),
    releaseNodeProcessor: mock((_id: string) => undefined),
    updateNodeProcessor: mock(() =>
      Promise.resolve({
        backend: "compatibility",
        ready: true,
        status: "ready",
      } as const)
    ),
  };
  const errors: unknown[] = [];
  const runtime = createNodeAudioPatch({
    getHost: () => host,
    onError: (error) => errors.push(error),
    route: (id, send) => {
      routes.set(id, send);
      return disconnects;
    },
    wait: () => Promise.resolve(),
  });
  const input = context.createGain();
  return { context, disconnects, errors, host, input, routes, runtime };
}
const speakers = { id: "speakers", position, type: "speakers" } as const;

describe("explicit audio patch routing", () => {
  test("repeated Filter and Pan modules remain at their cabled positions after FX", async () => {
    const nodes: NodeGraphInput["nodes"] = [
      source("a"),
      fx("fx", "crusher"),
      speakers,
      { data: { frequency: 500 }, id: "f1", position, type: "filter" },
      { data: { pan: -0.5 }, id: "p1", position, type: "pan" },
      {
        data: { frequency: 2000, type: "highpass" },
        id: "f2",
        position,
        type: "filter",
      },
      { data: { pan: 0.75 }, id: "p2", position, type: "pan" },
    ];
    const path = ["a", "fx", "f1", "p1", "f2", "p2", "speakers"];
    const edges = path
      .slice(1)
      .map((id, index) => cable(`c${index}`, path[index] ?? "a", id));
    const { graph, plan } = patch(nodes, edges);
    const compiled = compile(graph, { crossOriginIsolated: false });
    expect(compiled.patch).toBeDefined();
    expect(compiled.lanes.get("a")?.filter).toBeNull();
    expect(compiled.lanes.get("a")?.pan).toBe(0);
    const h = harness();
    h.runtime.sync(plan);
    h.runtime.connectSource("a", h.input);
    await h.runtime.whenSettled();
    for (const [index, id] of path.slice(0, -2).entries()) {
      const from = h.runtime.getTap(id) as unknown as FakeGainNode;
      const next = h.runtime.getTap(
        path[index + 1] ?? ""
      ) as unknown as FakeGainNode;
      expect(
        [...from.connections].some((send) =>
          [...(send as FakeGainNode).connections].some((input) =>
            (input as FakeGainNode).connections.has(next)
          )
        )
      ).toBe(true);
    }
    expect((h.runtime.getTap("f2") as BiquadFilterNode).type).toBe("highpass");
    expect(
      (
        (h.runtime.getTap("p2") as StereoPannerNode)
          .pan as unknown as FakeAudioParam
      ).events.at(-1)
    ).toMatchObject({ value: 0.75 });
    h.runtime.dispose();
  });
  test("muting every key restores a Vocoder's authored mode without saving a runtime override", () => {
    const node = graphNodeSchema.parse({
      data: {
        effect: {
          ...createNodeEffectConfig("vocoder", "v"),
          enabled: true,
          modulatorSource: "noise-pink",
        },
      },
      id: "v",
      position,
      type: "vocoder",
    });
    expect(patchPortEffects(node, "out:audio:main", true)[0]).toMatchObject({
      modulatorSource: "external",
      sidechain: { channelId: "patch-key" },
    });
    expect(patchPortEffects(node, "out:audio:main", false)[0]).toMatchObject({
      modulatorSource: "noise-pink",
    });
    expect(node.data).toMatchObject({
      effect: { modulatorSource: "noise-pink" },
    });
  });

  test("two sources sum before one shared effect; dry and wet outputs remain distinct", async () => {
    const { graph, plan } = patch(
      [
        source("a"),
        source("b"),
        fx("fx", "crusher"),
        speakers,
        {
          data: { deviceId: "usb" },
          id: "device",
          position,
          type: "deviceOut",
        },
      ],
      [
        cable("a-fx", "a", "fx"),
        cable("b-fx", "b", "fx"),
        cable("wet", "fx", "speakers"),
        cable("dry", "a", "device"),
      ]
    );
    expect(compile(graph, { crossOriginIsolated: false }).issues).toEqual([]);
    const h = harness();
    h.runtime.sync(plan);
    h.runtime.connectSource("a", h.input);
    await h.runtime.whenSettled();
    expect(h.errors).toEqual([]);
    expect(h.host.connectNodeProcessor).toHaveBeenCalledTimes(1);
    const sharedInput = h.host.connectNodeProcessor.mock.calls[0]?.[1];
    for (const id of ["a", "b"]) {
      const out = h.runtime.getTap(id) as unknown as FakeGainNode;
      expect(
        [...out.connections].some((send) =>
          (send as FakeGainNode).connections.has(sharedInput)
        )
      ).toBe(true);
    }
    const wet = h.runtime.getTap("fx") as unknown as FakeGainNode;
    const dry = h.runtime.getTap("a") as unknown as FakeGainNode;
    expect(
      [...wet.connections].some((send) =>
        (send as FakeGainNode).connections.has(h.routes.get("speakers"))
      )
    ).toBe(true);
    expect(
      [...dry.connections].some((send) =>
        (send as FakeGainNode).connections.has(h.routes.get("device"))
      )
    ).toBe(true);
    h.runtime.dispose();
    expect(h.host.releaseNodeProcessor).toHaveBeenCalled();
  });

  test("muting or deleting one of several sink cables preserves the sink and other cables", async () => {
    const { plan } = patch(
      [source("a"), source("b"), speakers],
      [cable("a-out", "a", "speakers"), cable("b-out", "b", "speakers")]
    );
    const h = harness();
    h.runtime.sync(plan);
    h.runtime.connectSource("a", h.input);
    const sink = h.routes.get("speakers");
    h.runtime.sync({
      ...plan,
      edges: new Map([...plan.edges].filter(([id]) => id !== "a-out")),
    });
    await h.runtime.whenSettled();
    expect(h.routes.get("speakers")).toBe(sink);
    expect(h.disconnects).not.toHaveBeenCalled();
    const b = h.runtime.getTap("b") as unknown as FakeGainNode;
    expect(
      [...b.connections].some((send) =>
        (send as FakeGainNode).connections.has(sink)
      )
    ).toBe(true);
    h.runtime.reroute();
    expect(h.disconnects).toHaveBeenCalledTimes(1);
    h.runtime.dispose();
  });

  test("keys and followers tap the cabled point, sum inputs and honor cable gain", async () => {
    const { plan } = patch(
      [
        source("a"),
        source("b"),
        { data: { gainDb: -6 }, id: "gain", position, type: "gain" },
        fx("comp", "compressor"),
        { data: {}, id: "follow", position, type: "follower" },
        speakers,
      ],
      [
        cable("a-gain", "a", "gain"),
        cable("audio", "a", "comp"),
        cable("out", "comp", "speakers"),
        {
          ...cable("key", "gain", "comp", undefined, "in:sidechain:key"),
          gain: 0.3,
        },
        cable("key2", "b", "comp", undefined, "in:sidechain:key"),
        cable("tap", "gain", "follow"),
        cable("tap2", "b", "follow"),
      ]
    );
    const h = harness();
    h.runtime.sync(plan);
    h.runtime.connectSource("a", h.input);
    await h.runtime.whenSettled();
    const gain = h.runtime.getTap("gain") as unknown as FakeGainNode;
    const keySend = [...gain.connections].find((send) =>
      (send as FakeGainNode).gain.events.some(
        (event) => event.type === "target" && event.value === 0.3
      )
    ) as FakeGainNode;
    expect(keySend).toBeDefined();
    const keyInput = h.host.connectNodeProcessor.mock.calls.find((call) =>
      call[0].includes("key:")
    )?.[1];
    expect(keySend.connections.has(keyInput)).toBe(true);
    const detector = h.runtime.getTap("follow");
    expect(
      [...gain.connections].some((send) =>
        (send as FakeGainNode).connections.has(detector)
      )
    ).toBe(true);
    h.runtime.dispose();
  });

  test("parameter changes and modulation reuse processors; replacing a module releases only the old owner", async () => {
    const { plan } = patch(
      [source("a"), fx("fx", "crusher"), speakers],
      [cable("in", "a", "fx"), cable("out", "fx", "speakers")]
    );
    const h = harness();
    h.runtime.sync(plan);
    h.runtime.connectSource("a", h.input);
    await h.runtime.whenSettled();
    const node = plan.nodes.get("fx");
    if (node?.type !== "crusher") {
      throw new Error("Missing crusher");
    }
    const modified = {
      ...plan,
      nodes: new Map(plan.nodes).set("fx", {
        ...node,
        data: { effect: { ...node.data.effect, outputGain: 0.4 } },
      } as GraphNode),
    };
    h.runtime.sync(modified);
    h.runtime.modulate(plan);
    await h.runtime.whenSettled();
    expect(h.host.connectNodeProcessor).toHaveBeenCalledTimes(1);
    expect(h.host.updateNodeProcessor).toHaveBeenCalledTimes(1);
    expect(h.host.modulateNodeProcessor).toHaveBeenCalledTimes(1);
    const beforeId = h.host.connectNodeProcessor.mock.calls[0]?.[0];
    h.runtime.sync({
      ...plan,
      nodes: new Map(plan.nodes).set(
        "fx",
        graphNodeSchema.parse(fx("fx", "compressor"))
      ),
    });
    await h.runtime.whenSettled();
    const afterId = h.host.connectNodeProcessor.mock.calls[1]?.[0];
    expect(afterId).not.toBe(beforeId);
    expect(
      h.host.releaseNodeProcessor.mock.calls.some(([id]) => id === beforeId)
    ).toBe(true);
    expect(
      h.host.releaseNodeProcessor.mock.calls.some(([id]) => id === afterId)
    ).toBe(false);
    h.runtime.dispose();
  });

  test("connecting an unused split port later starts just that branch", async () => {
    const { plan } = patch(
      [source("a"), fx("split", "fxComposite"), speakers],
      [
        cable("in", "a", "split"),
        cable("one", "split", "speakers", "out:audio:branch-1"),
      ]
    );
    const h = harness();
    h.runtime.sync(plan);
    h.runtime.connectSource("a", h.input);
    await h.runtime.whenSettled();
    expect(h.host.connectNodeProcessor).toHaveBeenCalledTimes(1);
    const edge = {
      ...plan.edges.get("one"),
      id: "two",
      sourceHandle: "out:audio:branch-2",
    };
    h.runtime.sync({
      ...plan,
      edges: new Map(plan.edges).set("two", graphEdgeSchema.parse(edge)),
    });
    await h.runtime.whenSettled();
    expect(h.host.connectNodeProcessor).toHaveBeenCalledTimes(2);
    h.runtime.dispose();
  });
});

function renderPort(
  node: GraphNode,
  port: string,
  left: number,
  right: number
): [number, number] {
  const processor = new EffectSource("test", 48_000);
  for (const effect of patchPortEffects(node, port, false)) {
    processor.addEffect(
      effect.id,
      effect.type,
      convertEffectConfigToEngine(effect),
      effect.order
    );
  }
  processor.start();
  const l = new Float32Array(128),
    r = new Float32Array(128);
  processor.process(
    new Float32Array(128).fill(left),
    new Float32Array(128).fill(right),
    l,
    r,
    0,
    128
  );
  return [l[0] ?? 0, r[0] ?? 0];
}

test("stereo split payloads carry independent left/right signals rather than copies of their sum", () => {
  const { graph } = patch([fx("split", "stereoSplit"), speakers], []);
  const [node] = graph.nodes;
  if (!node) {
    throw new Error("Missing split");
  }
  const left = renderPort(node, "out:audio:left", 0.2, 0.8);
  const right = renderPort(node, "out:audio:right", 0.2, 0.8);
  expect(left[0]).toBeCloseTo(0.2);
  expect(left[1]).toBeCloseTo(0);
  expect(right[0]).toBeCloseTo(0);
  expect(right[1]).toBeCloseTo(0.8);
});
