import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Store } from "@tanstack/react-store";
import { MAX_CHAIN_GAIN } from "@/lib/audio/dsp/effects/effect-config-schema";
import { createDefaultEffectConfig } from "@/lib/audio/dsp/effects/registry";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import { effectFieldsAreStructural } from "@/lib/audio/dsp/routing/effect-tree";
import type { AudioManager } from "@/lib/audio/manager/audio-manager";
import {
  FakeAudioContext,
  type FakeGainNode,
} from "@/lib/audio/routing/fake-audio-nodes";
import type { EffectsRuntimeOutcome } from "@/lib/channel-effects";
// biome-ignore lint/performance/noNamespaceImport: fail at the forbidden persistence boundary
import * as sessions from "@/lib/collections/playback-sessions";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
// biome-ignore lint/performance/noNamespaceImport: fail at the forbidden frame-time boundary
import * as compiler from "@/lib/node-graph/compile";
import {
  removeNodesHealed,
  setEffectParams,
  setNativeParams,
} from "@/lib/node-graph/graph-edits";
import {
  installModulationAudio,
  ownModulation,
  TestModulationWorklet,
} from "@/lib/node-graph/modulation.test-helpers";
import { createModulationRuntime } from "@/lib/node-graph/modulation-runtime";
// biome-ignore lint/performance/noNamespaceImport: fail at the forbidden authored-store boundary
import * as editor from "@/lib/node-graph/node-store";
import { MAX_EDGE_GAIN, nodeGraphSchema } from "@/lib/node-graph/schema";
import type { PlaybackActionContext } from "@/lib/playback-action-context";
import {
  resetAllPlaybackRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { createNodeEngine, type NodeEngine } from "./engine";
import type { EngineParamTarget } from "./param-target";

const engines: NodeEngine[] = [];

test("a small LFO movement preserves a folded +18 dB send", async () => {
  const patch = graph();
  patch.nodes = nodeGraphSchema.parse({
    ...patch,
    edges: [],
    nodes: [
      patch.nodes[0],
      patch.nodes.at(-1),
      {
        data: { gainDb: 18 },
        id: "gain",
        position: { x: 0, y: 0 },
        type: "gain",
      },
      { data: {}, id: "lfo", position: { x: 0, y: 0 }, type: "lfo" },
    ],
  }).nodes;
  patch.edges = nodeGraphSchema.parse({
    ...patch,
    edges: [
      {
        id: "in",
        source: "a",
        sourceHandle: "out:audio:main",
        target: "gain",
        targetHandle: "in:audio:main",
      },
      {
        id: "out",
        source: "gain",
        sourceHandle: "out:audio:main",
        target: "speakers",
        targetHandle: "in:audio:main",
      },
      {
        depth: 0.1,
        id: "control",
        parameter: "gainDb",
        source: "lfo",
        sourceHandle: "out:control:main",
        target: "gain",
        targetHandle: "in:control:parameter",
      },
    ],
  }).edges;
  const h = await harness("official", false, patch);
  expect(h.levels.get("a")).toBeCloseTo(10 ** (18 / 20));
  installModulationAudio();
  const runtime = createModulationRuntime({
    engine: h.engine,
    getNativeHost: async () => null,
    getWorkletProcessorUrl: () => "/dsp.js",
  });
  ownModulation(runtime);
  runtime.sync(patch, h.plan);
  await runtime.whenSettled();
  TestModulationWorklet.current.emit({ lfo: 0.1 });
  expect(h.levels.get("a")).toBeCloseTo(10 ** (18.6 / 20));
  runtime.dispose();
  expect(h.levels.get("a")).toBeCloseTo(10 ** (18 / 20));
});
afterEach(async () => {
  mock.restore();
  await Promise.all(engines.splice(0).map((engine) => engine.dispose()));
  resetAllPlaybackRuntime();
});

function graph() {
  const position = { x: 0, y: 0 };
  return nodeGraphSchema.parse({
    edges: [
      ["a", "pan"],
      ["pan", "filter"],
      ["filter", "comp"],
      ["comp", "speakers"],
    ].map(([source, target]) => ({
      id: `${source}->${target}`,
      source,
      sourceHandle: "out:audio:main",
      target,
      targetHandle: "in:audio:main",
    })),
    nodes: [
      {
        data: {
          radio: {
            id: "a",
            name: "a",
            streamUrl: "https://radio.example/a.mp3",
          },
        },
        id: "a",
        position,
        type: "station",
      },
      { data: { pan: 0.2 }, id: "pan", position, type: "pan" },
      {
        data: { frequency: 900, Q: 2 },
        id: "filter",
        position,
        type: "filter",
      },
      {
        data: {
          effect: {
            ...createNodeEffectConfig("compressor", "comp"),
            enabled: true,
          },
        },
        id: "comp",
        position,
        type: "compressor",
      },
      { data: {}, id: "speakers", position, type: "speakers" },
    ],
    version: 2,
  });
}

/** The default patch with station b also into the Compressor: a unit. */
function sharedGraph() {
  const patch = graph();
  return nodeGraphSchema.parse({
    ...patch,
    edges: [
      ...patch.edges,
      {
        id: "b->comp",
        source: "b",
        sourceHandle: "out:audio:main",
        target: "comp",
        targetHandle: "in:audio:main",
      },
    ],
    nodes: [
      ...patch.nodes,
      {
        data: {
          radio: {
            id: "b",
            name: "b",
            streamUrl: "https://radio.example/b.mp3",
          },
        },
        id: "b",
        position: { x: 0, y: 0 },
        type: "station",
      },
    ],
  });
}

function strip() {
  const parameter = (value = 0) => ({
    setTargetAtTime(next: number) {
      this.value = next;
    },
    value,
  });
  return {
    filter: { frequency: parameter(), Q: parameter() },
    pan: { context: { currentTime: 3 }, pan: parameter() },
  };
}

async function harness(
  backend: "official" | "compatibility" = "official",
  connecting = false,
  patch = graph()
) {
  const store = editor.createNodeStore(patch);
  const plan = compiler.compile(patch, { crossOriginIsolated: true });
  const live = new Set<string>();
  const authored = new Map<string, EffectConfig>();
  const fields = new Map<string, EffectConfig>();
  let allowedEffect: string | null = null;
  let effectWriteError: Error | null = null;
  const outcome: EffectsRuntimeOutcome = {
    backend: connecting ? null : backend,
    ready: !connecting,
    status: connecting ? "inactive" : "ready",
  };
  let nodes: ReturnType<typeof strip> | null = connecting ? null : strip();
  let effectReady = !connecting;
  let fades: Promise<void> = Promise.resolve();
  let onConnect: ((laneId: string) => void) | undefined;
  const levels = new Map<string, number>();
  const listeners = new Set<(outcome: EffectsRuntimeOutcome) => void>();
  const context = new FakeAudioContext();
  /** The sends routing points connect into each output. */
  const outputSends = new Map<string, FakeGainNode[]>();
  let route: ((to: string, send: AudioNode) => () => void) | undefined;
  let sendsOf:
    | ((laneId: string) => ReadonlyMap<string, { to: string }>)
    | undefined;
  const ctx = {
    audio: {
      getEffectsRuntimeOutcome: () => outcome,
      getPreFaderNode: () => nodes,
      getStripNodes: () => nodes,
      getTrackProgress: () => null,
      hasEffectModulationField: () => true,
      hasSound: (id: string) => live.has(id),
      pauseSound: () => undefined,
      setPan: (_id: string, value: number) => {
        if (nodes) {
          nodes.pan.pan.value = value;
        }
      },
      updateFilter: (_id: string, config: { frequency: number; Q: number }) => {
        if (nodes) {
          nodes.filter.frequency.value = config.frequency;
          nodes.filter.Q.value = config.Q;
        }
      },
    } as unknown as AudioManager,
    channels: {
      activate: (
        _session: string,
        channel: string,
        _radio: unknown,
        activation: { soundId: string }
      ) => {
        live.add(activation.soundId);
        setPlaybackChannelRuntime(channel, () => ({
          soundId: activation.soundId,
        }));
        return activation.soundId;
      },
      deactivate: (channel: string) => {
        live.delete(`node:${channel}`);
      },
      setMuted: () => undefined,
    },
    reportError: (error: unknown) => {
      throw error;
    },
  } as unknown as PlaybackActionContext;
  const engine = createNodeEngine({
    backendBadges: new Store({}),
    commitTrack: () => false,
    ctx,
    deviceSinks: () => ({
      checkDevices: async () => undefined,
      connect: (sinkId, node) => {
        outputSends.set(sinkId, [
          ...(outputSends.get(sinkId) ?? []),
          node as unknown as FakeGainNode,
        ]);
        return () => undefined;
      },
      dispose: () => undefined,
      retry: () => undefined,
      status: () => undefined,
      statuses: () => ({}),
      sync: () => undefined,
    }),
    effects: {
      attachEffectsInsert: () => Promise.resolve(outcome),
      connectEffectsKey: () => undefined,
      detachEffectsInsert: () => undefined,
      reconcileEffects: (_id, desired) => {
        for (const config of desired.tree) {
          authored.set(config.id, config);
          fields.set(config.id, config);
        }
        for (const listener of listeners) {
          listener(outcome);
        }
        return Promise.resolve(outcome);
      },
      releaseEffectsKey: () => undefined,
      setEffectFields: (_id, id, config, transient) => {
        if (transient && effectWriteError) {
          throw effectWriteError;
        }
        if (transient && !effectReady) {
          return "unavailable";
        }
        const before = authored.get(id);
        if (before && effectFieldsAreStructural(before, config)) {
          return "structural";
        }
        if (transient && allowedEffect && id !== allowedEffect) {
          throw new Error("Unrelated effect overlay was rewritten");
        }
        if (!transient) {
          authored.set(id, config);
        }
        fields.set(id, config);
        return "applied";
      },
      subscribeEffectsRuntimeOutcome: (_id, listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    fadeOut: () => fades,
    laneOutputs: (options) => {
      route = (to, node) => options.route(to, node, false);
      sendsOf = options.getSends;
      // The lane's level on Speakers: every send into it, summed.
      const speakers = (id: string) =>
        [...options.getSends(id).values()]
          .filter(({ to }) => to === "sink:speakers")
          .reduce((sum, { level }) => sum + level, 0);
      onConnect = (id) => {
        options.onConnect?.(id, new FakeAudioContext() as never);
        levels.set(id, speakers(id));
      };
      return {
        attach: () => undefined,
        dispose: () => undefined,
        duck: () => null,
        refresh: (id) => {
          levels.set(id, speakers(id));
        },
        release: () => undefined,
        unduck: () => undefined,
      };
    },
    masterVolume: () => 1,
    outputRouting: () => {
      throw new Error("No cue in this patch");
    },
    resolveStream: () => {
      throw new Error("No renewal in this patch");
    },
    sinkStatuses: new Store({}),
  });
  engines.push(engine);
  engine.apply(plan, true);
  await engine.whenSettled();
  return {
    allowOnlyEffect(id: string) {
      allowedEffect = id;
    },
    authored,
    /** Connects the lane's cables into the routing points they reach. */
    connectPoints(laneId: string) {
      for (const { to } of sendsOf?.(laneId).values() ?? []) {
        if (!to.startsWith("sink:")) {
          route?.(to, context.createGain() as unknown as AudioNode);
        }
      }
    },
    disconnectEffects() {
      effectReady = false;
    },
    engine,
    failEffects() {
      effectReady = false;
      Object.assign(outcome, { ready: false, status: "failed" });
      for (const listener of listeners) {
        listener(outcome);
      }
    },
    fields,
    holdFade() {
      const pending = Promise.withResolvers<void>();
      fades = pending.promise;
      return pending.resolve;
    },
    levels,
    get nodes() {
      return nodes;
    },
    plan,
    /** The level a point's latest send into `sinkId` ramps to. */
    pointLevel(sinkId: string) {
      const last = outputSends.get(sinkId)?.at(-1)?.gain.events.at(-1);
      return last && "value" in last ? last.value : undefined;
    },
    ready(nextBackend = backend) {
      effectReady = true;
      // A new official unit starts on the authored tree, after the native shell connected.
      for (const [id, config] of authored) {
        fields.set(id, config);
      }
      Object.assign(outcome, {
        backend: nextBackend,
        ready: true,
        status: "ready",
      });
      for (const listener of listeners) {
        listener(outcome);
      }
    },
    reconnect(ready = true) {
      nodes = strip();
      if (ready) {
        Object.assign(outcome, { backend, ready: true, status: "ready" });
      }
      onConnect?.("a");
    },
    store,
    throwOnEffectWrite(error: Error | null) {
      effectWriteError = error;
    },
  };
}

const threshold: EngineParamTarget = {
  effectId: "comp",
  field: "threshold",
  kind: "effect",
  laneId: "a",
};
const pan: EngineParamTarget = { kind: "pan", laneId: "a" };
const frequency: EngineParamTarget = {
  field: "frequency",
  kind: "filter",
  laneId: "a",
};
const send: EngineParamTarget = { edgeId: "comp->speakers", kind: "send" };

describe("Node engine parameters", () => {
  test.each([
    [threshold, -100, -60],
    [threshold, 10, 0],
    [{ ...threshold, field: "outputGain" }, 10, 10],
    [pan, -2, -1],
    [pan, 2, 1],
    [frequency, 1, 20],
    [frequency, 30_000, 20_000],
    [{ ...frequency, field: "Q" }, 0, 0.1],
    [{ ...frequency, field: "Q" }, 40, 30],
  ] as const)(
    "transient target %j clamps %s to its schema bound",
    async (target, value, expected) => {
      const h = await harness();
      expect(h.engine.setParam(target, value)).toBe("applied");
      const actual = () => {
        if (target.kind === "effect") {
          return Reflect.get(h.fields.get("comp") ?? {}, target.field);
        }
        return target.kind === "pan"
          ? h.nodes?.pan.pan.value
          : h.nodes?.filter[target.field].value;
      };
      expect(actual()).toBe(expected);
      h.ready();
      h.reconnect();
      expect(actual()).toBe(expected);
      h.engine.clearTransient(target);
      expect(h.fields.get("comp")).toEqual(h.authored.get("comp"));
      expect(h.nodes?.pan.pan.value).toBe(0.2);
      expect(h.nodes?.filter.frequency.value).toBe(900);
      expect(h.nodes?.filter.Q.value).toBe(2);
    }
  );

  test.each([Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY])(
    "non-finite values are unavailable for every parameter target (%s)",
    async (value) => {
      const h = await harness();
      for (const target of [threshold, pan, frequency, send]) {
        expect(h.engine.setParam(target, value)).toBe("unavailable");
      }
      expect(h.fields.get("comp")).toEqual(h.authored.get("comp"));
      expect(h.levels.get("a")).toBe(1);
    }
  );

  test.each([
    ["gain", -1, 0],
    ["gain", 0, 0],
    ["gain", 2, 2],
    ["gain", MAX_CHAIN_GAIN, MAX_CHAIN_GAIN],
    ["gain", MAX_CHAIN_GAIN + 1, MAX_CHAIN_GAIN + 1],
    ["gain", Number.MAX_VALUE, Number.MAX_VALUE],
    ["pan", -2, -1],
    ["pan", -1, -1],
    ["pan", 0.5, 0.5],
    ["pan", 1, 1],
    ["pan", 2, 1],
  ] as const)(
    "a transient branch %s of %s uses the physical gain and pan bounds",
    async (field, value, expected) => {
      const h = await harness();
      const lane = h.plan.lanes.get("a");
      const container = createNodeEffectConfig("fxComposite", "comp");
      if (!lane || container.type !== "fxComposite") {
        throw new Error("Missing lane or container");
      }
      h.engine.apply(
        {
          ...h.plan,
          lanes: new Map(h.plan.lanes).set("a", {
            ...lane,
            effects: [{ ...container, enabled: true }],
            layoutSignature: "container",
          }),
        },
        true
      );
      await h.engine.whenSettled();
      const baseline = h.authored.get("comp");
      if (baseline?.type !== "fxComposite") {
        throw new Error("Missing authored container");
      }
      const target: EngineParamTarget = {
        chainId: container.chains[0].id,
        effectId: container.id,
        field,
        kind: "chain",
        laneId: "a",
      };
      expect(h.engine.setParam(target, value)).toBe("applied");
      const changed = {
        ...baseline,
        chains: container.chains.map((chain, index) =>
          index === 0 ? { ...chain, [field]: expected } : chain
        ),
      };
      expect(h.fields.get("comp")).toEqual(changed);
      h.ready();
      expect(h.fields.get("comp")).toEqual(changed);
      expect(h.authored.get("comp")).toBe(baseline);
      h.engine.clearTransient(target);
      h.ready();
      expect(h.fields.get("comp")).toEqual(baseline);
    }
  );

  test.each([threshold, undefined])(
    "a throwing clear preserves the overlay for replay and retry (%s)",
    async (target) => {
      const h = await harness();
      const baseline = h.authored.get("comp");
      if (baseline?.type !== "compressor") {
        throw new Error("Missing authored compressor");
      }
      expect(h.engine.setParam(threshold, -12)).toBe("applied");
      h.throwOnEffectWrite(new Error("Transaction failed"));
      expect(() => h.engine.clearTransient(target)).toThrow(
        "Transaction failed"
      );
      h.throwOnEffectWrite(null);
      h.ready();
      expect(h.fields.get("comp")).toEqual({ ...baseline, threshold: -12 });
      h.engine.clearTransient(target);
      h.ready();
      expect(h.fields.get("comp")).toEqual(baseline);
      expect(h.authored.get("comp")).toBe(baseline);
    }
  );

  test.each([undefined, -12])(
    "a throwing effect write keeps the previous overlay (%s)",
    async (previous) => {
      const h = await harness();
      const baseline = h.authored.get("comp");
      if (baseline?.type !== "compressor") {
        throw new Error("Missing authored compressor");
      }
      if (previous !== undefined) {
        expect(h.engine.setParam(threshold, previous)).toBe("applied");
      }
      h.throwOnEffectWrite(new Error("Transaction failed"));
      expect(() => h.engine.setParam(threshold, -30)).toThrow(
        "Transaction failed"
      );
      h.throwOnEffectWrite(null);
      h.ready();
      expect(h.fields.get("comp")).toEqual(
        previous === undefined ? baseline : { ...baseline, threshold: previous }
      );
      h.engine.clearTransient(threshold);
      expect(h.fields.get("comp")).toEqual(baseline);
    }
  );

  test.each([false, true])(
    "backend outcomes refresh sends and preserve their edge overlay (clear=%s)",
    async (clear) => {
      const h = await harness();
      expect(h.engine.setParam(send, 0.3)).toBe("applied");
      h.ready("compatibility");
      expect(h.levels.get("a")).toBe(1);
      expect(h.engine.setParam(send, 0.8)).toBe("unavailable");
      if (clear) {
        h.engine.clearTransient(send);
      }
      h.ready("official");
      expect(h.levels.get("a")).toBe(clear ? 1 : 0.3);
    }
  );

  test.each([
    [-1, 0],
    [0, 0],
    [2, 2],
    [MAX_EDGE_GAIN, MAX_EDGE_GAIN],
    [MAX_EDGE_GAIN + 1, MAX_EDGE_GAIN + 1],
    [Number.MAX_VALUE, Number.MAX_VALUE],
  ])(
    "a transient send of %s preserves folded levels above the cable knob range",
    async (value, gain) => {
      const h = await harness();
      expect(h.engine.setParam(send, value)).toBe("applied");
      expect(h.levels.get("a")).toBe(gain);
      expect(h.engine.plan.cables.get("comp->speakers")?.gain).toBe(1);
      h.engine.clearTransient(send);
      expect(h.levels.get("a")).toBe(1);
    }
  );

  test("transient frames never compile, commit the store, persist, or change authored plans/configs", async () => {
    const h = await harness();
    const { state } = h.store;
    const baseline = JSON.stringify([...h.plan.lanes]);
    const config = h.authored.get("comp");
    const forbidden = () => {
      throw new Error("Transient frame entered authored work");
    };
    spyOn(compiler, "compile").mockImplementation(forbidden);
    spyOn(editor, "commitNodeGraph").mockImplementation(forbidden);
    spyOn(sessions, "updatePlaybackSession").mockImplementation(forbidden);
    for (let frame = 0; frame < 1000; frame += 1) {
      expect(h.engine.setParam(threshold, -20 - frame / 1000)).toBe("applied");
    }
    expect(h.fields.get("comp")).toMatchObject({ threshold: -20.999 });
    expect(h.authored.get("comp")).toBe(config);
    expect(h.store.state).toBe(state);
    expect(h.engine.plan).toBe(h.plan);
    expect(JSON.stringify([...h.plan.lanes])).toBe(baseline);
    h.engine.clearTransient(threshold);
    expect(h.fields.get("comp")).toEqual(config);
  });

  test("strip and sends use overlays and clear to the latest authored values", async () => {
    const h = await harness();
    h.engine.setParam(threshold, -12);
    expect(h.engine.setParam(pan, -0.7)).toBe("applied");
    expect(h.engine.setParam(frequency, 2400)).toBe("applied");
    expect(h.engine.setParam(send, 0.3)).toBe("applied");
    expect(h.nodes?.pan.pan.value).toBe(-0.7);
    expect(h.nodes?.filter.frequency.value).toBe(2400);
    expect(h.levels.get("a")).toBe(0.3);
    h.allowOnlyEffect("none");
    editor.commitNodeGraph(
      (patch) =>
        setNativeParams(setNativeParams(patch, "pan", { pan: 0.6 }), "filter", {
          frequency: 1800,
        }),
      h.store
    );
    const edited = h.store.state.graph;
    if (!edited) {
      throw new Error("Missing patch");
    }
    h.engine.apply(
      compiler.compile(edited, { crossOriginIsolated: true }),
      true
    );
    await h.engine.whenSettled();
    expect(h.nodes?.pan.pan.value).toBe(-0.7);
    expect(h.fields.get("comp")).toMatchObject({ threshold: -12 });
    h.allowOnlyEffect("comp");
    h.engine.clearTransient();
    expect(h.nodes?.pan.pan.value).toBe(0.6);
    expect(h.nodes?.filter.frequency.value).toBe(1800);
    expect(h.levels.get("a")).toBe(1);
    expect(h.plan.lanes.get("a")?.pan).toBe(0.2);
  });

  test("an authored graph commit and structural effects replacement replay the overlay", async () => {
    const h = await harness();
    h.engine.setParam(threshold, -12);
    const patch = h.store.state.graph;
    if (!patch) {
      throw new Error("Missing patch");
    }
    editor.commitNodeGraph(
      (current) => setEffectParams(current, "comp", { threshold: -35 }),
      h.store
    );
    const edited = h.store.state.graph;
    if (!edited) {
      throw new Error("Missing edited patch");
    }
    h.engine.apply(
      compiler.compile(edited, { crossOriginIsolated: true }),
      true
    );
    await h.engine.whenSettled();
    expect(h.fields.get("comp")).toMatchObject({ threshold: -12 });
    expect(h.authored.get("comp")).toMatchObject({ threshold: -35 });
    const extra = {
      ...edited,
      edges: edited.edges
        .map((edge) =>
          edge.source === "comp" ? { ...edge, target: "verb" } : edge
        )
        .concat({
          gain: 1,
          id: "verb->speakers",
          muted: false,
          source: "verb",
          sourceHandle: "out:audio:main",
          target: "speakers",
          targetHandle: "in:audio:main",
        }),
      nodes: [
        ...edited.nodes,
        {
          data: {
            effect: {
              ...createNodeEffectConfig("cheapReverb", "verb"),
              enabled: true,
            },
          },
          id: "verb",
          position: { x: 0, y: 0 },
          type: "cheapReverb",
        },
      ],
    };
    h.engine.apply(
      compiler.compile(nodeGraphSchema.parse(extra), {
        crossOriginIsolated: true,
      }),
      true
    );
    await h.engine.whenSettled();
    expect(h.fields.get("comp")).toMatchObject({ threshold: -12 });
    h.engine.clearTransient(threshold);
    expect(h.fields.get("comp")).toMatchObject({ threshold: -35 });
  });

  test.each([
    ["removed", false],
    ["removed", true],
    ["rewired", false],
    ["rewired", true],
  ] as const)(
    "a send follows its edge when %s (clear=%s)",
    async (change, clear) => {
      const patch = graph();
      const [station] = patch.nodes;
      const h = await harness(
        "official",
        false,
        nodeGraphSchema.parse({
          ...patch,
          edges: [
            ...patch.edges,
            { ...patch.edges[3], id: "keep-a", target: "monitor" },
            { ...patch.edges[3], id: "b->speakers", source: "b" },
          ],
          nodes: [
            ...patch.nodes,
            {
              data: { deviceId: "usb" },
              id: "monitor",
              position: { x: 0, y: 0 },
              type: "deviceOut",
            },
            {
              ...station,
              data: {
                radio: {
                  id: "b",
                  name: "b",
                  streamUrl: "https://radio.example/b.mp3",
                },
              },
              id: "b",
            },
          ],
        })
      );
      expect(h.engine.setParam(pan, -0.7)).toBe("applied");
      expect(h.engine.setParam(send, 0.3)).toBe("applied");
      expect(h.levels.get("a")).toBe(0.3);
      const cables = new Map(h.plan.cables);
      const cable = cables.get("comp->speakers");
      if (!cable) {
        throw new Error("Missing send");
      }
      if (change === "removed") {
        cables.delete(cable.id);
      } else {
        cables.set(cable.id, { ...cable, from: { id: "b", kind: "lane" } });
      }
      h.engine.apply({ ...h.plan, cables }, true);
      await h.engine.whenSettled();
      expect(h.levels.get("a")).toBe(0);
      if (change === "rewired") {
        expect(h.levels.get("b")).toBe(1.3);
      }
      if (clear) {
        h.engine.clearTransient(send);
      }
      h.engine.apply(h.plan, true);
      await h.engine.whenSettled();
      expect(h.levels.get("a")).toBe(change === "rewired" && !clear ? 0.3 : 1);
      expect(h.levels.get("b")).toBe(1);
      h.reconnect();
      expect(h.nodes?.pan.pan.value).toBe(-0.7);
    }
  );

  test("an effects failure preserves native overlays and allows new strip and send writes", async () => {
    const h = await harness();
    expect(h.engine.setParam(threshold, -12)).toBe("applied");
    expect(h.engine.setParam(pan, -0.7)).toBe("applied");
    expect(h.engine.setParam(frequency, 2400)).toBe("applied");
    expect(h.engine.setParam(send, 0.3)).toBe("applied");
    h.failEffects();
    expect(h.nodes?.pan.pan.value).toBe(-0.7);
    expect(h.nodes?.filter.frequency.value).toBe(2400);
    expect(h.levels.get("a")).toBe(0.3);
    expect(h.engine.setParam(threshold, -17)).toBe("unavailable");
    h.reconnect(false);
    expect(h.nodes?.pan.pan.value).toBe(-0.7);
    expect(h.nodes?.filter.frequency.value).toBe(2400);
    expect(h.levels.get("a")).toBe(0.3);
    expect(h.engine.setParam(pan, 0.5)).toBe("applied");
    expect(h.engine.setParam(frequency, 1800)).toBe("applied");
    expect(h.engine.setParam({ ...frequency, field: "Q" }, 1.4)).toBe(
      "applied"
    );
    expect(h.engine.setParam(send, 0.8)).toBe("applied");
    expect(h.nodes?.pan.pan.value).toBe(0.5);
    expect(h.nodes?.filter.frequency.value).toBe(1800);
    expect(h.nodes?.filter.Q.value).toBe(1.4);
    expect(h.levels.get("a")).toBe(0.8);
    h.engine.clearTransient();
    expect(h.nodes?.pan.pan.value).toBe(0.2);
    expect(h.nodes?.filter.frequency.value).toBe(900);
    expect(h.nodes?.filter.Q.value).toBe(2);
    expect(h.levels.get("a")).toBe(1);
    h.ready();
    expect(h.fields.get("comp")).toEqual(h.authored.get("comp"));
  });

  test("an authored knob replays only its own effect overlay", async () => {
    const patch = graph();
    const extra = nodeGraphSchema.parse({
      ...patch,
      edges: [
        ...patch.edges.map((edge) =>
          edge.source === "comp" ? { ...edge, target: "verb" } : edge
        ),
        {
          id: "verb->speakers",
          source: "verb",
          sourceHandle: "out:audio:main",
          target: "speakers",
          targetHandle: "in:audio:main",
        },
      ],
      nodes: [
        ...patch.nodes,
        {
          data: {
            effect: {
              ...createNodeEffectConfig("cheapReverb", "verb"),
              enabled: true,
            },
          },
          id: "verb",
          position: { x: 0, y: 0 },
          type: "cheapReverb",
        },
      ],
    });
    const h = await harness("official", false, extra);
    h.engine.setParam(threshold, -12);
    h.engine.setParam(
      { effectId: "verb", field: "decay", kind: "effect", laneId: "a" },
      0.7
    );
    h.engine.setParam(frequency, 2400);
    h.allowOnlyEffect("comp");
    if (!h.nodes) {
      throw new Error("No live strip");
    }
    let stripRewritten = false;
    spyOn(h.nodes.filter.frequency, "setTargetAtTime").mockImplementation(
      () => {
        stripRewritten = true;
        throw new Error("Unrelated filter overlay was rewritten");
      }
    );
    editor.commitNodeGraph(
      (current) => setEffectParams(current, "comp", { threshold: -35 }),
      h.store
    );
    const edited = h.store.state.graph;
    if (!edited) {
      throw new Error("Missing patch");
    }
    h.engine.apply(
      compiler.compile(edited, { crossOriginIsolated: true }),
      true
    );
    await h.engine.whenSettled();
    expect(h.authored.get("comp")).toMatchObject({ threshold: -35 });
    expect(h.fields.get("comp")).toMatchObject({ threshold: -12 });
    expect(h.fields.get("verb")).toMatchObject({ decay: 0.7 });
    expect(h.nodes.filter.frequency.value).toBe(2400);
    expect(stripRewritten).toBe(false);
  });

  test("setParam returns structural while an effect needs an endpoint layout", async () => {
    const patch = graph();
    const h = await harness(
      "official",
      false,
      nodeGraphSchema.parse({
        ...patch,
        nodes: patch.nodes.map((node) =>
          node.id === "comp"
            ? {
                ...node,
                data: {
                  effect: {
                    ...createNodeEffectConfig("autotune", "comp"),
                    enabled: true,
                  },
                },
                type: "autotune",
              }
            : node
        ),
      })
    );
    const baseline = h.fields.get("comp");
    expect(h.engine.setParam({ ...threshold, field: "dryWet" }, 0.5)).toBe(
      "structural"
    );
    expect(h.engine.setParam({ ...threshold, field: "inputGain" }, 0.5)).toBe(
      "structural"
    );
    expect(h.fields.get("comp")).toBe(baseline);
    expect(h.engine.plan).toBe(h.plan);
  });

  test("removing a native Filter drops its old overlay", async () => {
    const h = await harness();
    h.engine.setParam(frequency, 2400);
    const patch = h.store.state.graph;
    if (!patch) {
      throw new Error("Missing patch");
    }
    const bypassed = removeNodesHealed(patch, ["filter"]);
    if (!bypassed.ok) {
      throw new Error(bypassed.message);
    }
    h.engine.apply(
      compiler.compile(bypassed.graph, { crossOriginIsolated: true }),
      true
    );
    await h.engine.whenSettled();
    expect(h.nodes?.filter.frequency.value).toBe(0);
    expect(h.engine.setParam(frequency, 1800)).toBe("unavailable");
  });

  test("reconnection replays overlays; retirement drops lane overlays and keeps existing sends", async () => {
    const h = await harness("official", true);
    h.engine.setParam(pan, -0.4);
    h.engine.setParam(threshold, -17);
    h.engine.setParam(send, 0.2);
    h.reconnect(false);
    expect(h.nodes?.pan.pan.value).toBe(-0.4);
    expect(h.fields.get("comp")).toEqual(h.authored.get("comp"));
    h.ready();
    expect(h.fields.get("comp")).toMatchObject({ threshold: -17 });
    h.reconnect();
    expect(h.nodes?.pan.pan.value).toBe(-0.4);
    const release = h.holdFade();
    const lane = h.plan.lanes.get("a");
    if (!lane) {
      throw new Error("Missing lane");
    }
    const replacement = {
      ...h.plan,
      lanes: new Map(h.plan.lanes).set("a", {
        ...lane,
        radio: { ...lane.radio, streamUrl: "https://radio.example/new.mp3" },
      }),
    };
    h.engine.apply(replacement, true);
    expect(h.engine.setParam(threshold, -50)).toBe("unavailable");
    expect(h.levels.get("a")).toBe(0.2);
    release();
    await h.engine.whenSettled();
    h.reconnect();
    expect(h.levels.get("a")).toBe(0.2);
    expect(h.nodes?.pan.pan.value).toBe(0.2);
    expect(h.fields.get("comp")).toMatchObject({
      threshold: (
        createNodeEffectConfig("compressor", "comp") as { threshold: number }
      ).threshold,
    });
  });

  test("effect writes during reconnection are deferred and replay the latest overlay", async () => {
    const h = await harness();
    expect(h.engine.setParam(threshold, -12)).toBe("applied");
    h.disconnectEffects();
    expect(h.engine.setParam(threshold, -17)).toBe("applied");
    expect(h.fields.get("comp")).toMatchObject({ threshold: -12 });
    h.ready();
    expect(h.fields.get("comp")).toMatchObject({ threshold: -17 });
    h.engine.clearTransient(threshold);
    expect(h.fields.get("comp")).toEqual(h.authored.get("comp"));
  });

  test("transient Werkstatt targets are unavailable even on an official lane", async () => {
    const h = await harness();
    const lane = h.plan.lanes.get("a");
    if (!lane) {
      throw new Error("Missing lane");
    }
    const script = {
      ...createDefaultEffectConfig("werkstatt", "comp", 0),
      enabled: true,
      parameters: { amount: 0.25 },
    };
    h.engine.apply(
      {
        ...h.plan,
        lanes: new Map(h.plan.lanes).set("a", {
          ...lane,
          effects: [script],
          layoutSignature: "werkstatt",
        }),
      },
      true
    );
    await h.engine.whenSettled();
    const baseline = h.fields.get("comp");
    for (const field of ["amount", "dryWet", "outputGain"]) {
      expect(h.engine.setParam({ ...threshold, field }, 0.7)).toBe(
        "unavailable"
      );
    }
    h.engine.clearTransient();
    expect(h.fields.get("comp")).toBe(baseline);
  });

  test("a compatibility plan rejects transient writes despite a stale official outcome", async () => {
    const h = await harness();
    const patch = graph();
    const compatible = nodeGraphSchema.parse({
      ...patch,
      nodes: patch.nodes.map((node) =>
        node.id === "comp"
          ? {
              ...node,
              data: {
                effect: {
                  ...createNodeEffectConfig("distortion", "comp"),
                  enabled: true,
                },
              },
              type: "distortion",
            }
          : node
      ),
    });
    h.engine.apply(
      compiler.compile(compatible, { crossOriginIsolated: true }),
      true
    );
    await h.engine.whenSettled();
    expect(h.engine.plan.lanes.get("a")?.backend).toBe("compat");
    const baseline = h.fields.get("comp");
    for (const target of [
      { ...threshold, field: "outputGain" },
      pan,
      frequency,
      send,
    ]) {
      expect(h.engine.setParam(target, 0.4)).toBe("unavailable");
    }
    expect(h.levels.get("a")).toBe(1);
    expect(h.fields.get("comp")).toBe(baseline);
  });

  test("every target on an actual compatibility lane is unavailable", async () => {
    const h = await harness("compatibility");
    for (const target of [threshold, pan, frequency, send]) {
      expect(h.engine.setParam(target, 0.4)).toBe("unavailable");
    }
    expect(h.levels.get("a")).toBe(1);
    expect(h.fields.get("comp")).toEqual(h.authored.get("comp"));
  });
  test("a shared unit's FX and its sends take transient values and clear to the plan", async () => {
    const h = await harness("official", false, sharedGraph());
    h.connectPoints("a");
    await h.engine.whenSettled();
    const unitThreshold: EngineParamTarget = { ...threshold, laneId: "comp" };
    const [authored] = h.engine.plan.units.get("comp")?.effects ?? [];

    expect(h.engine.setParam(unitThreshold, -12)).toBe("applied");
    expect(h.engine.setParam(send, 0.3)).toBe("applied");
    expect(h.fields.get("comp")).toMatchObject({ threshold: -12 });
    expect(h.pointLevel("speakers")).toBe(0.3);
    // A unit has no strip of its own.
    expect(h.engine.setParam({ kind: "pan", laneId: "comp" }, 0.5)).toBe(
      "unavailable"
    );

    h.engine.clearTransient();
    expect(h.fields.get("comp")).toEqual(authored);
    expect(h.pointLevel("speakers")).toBe(1);
  });

  test.each(["official", "compatibility"] as const)(
    "a shared unit's sends stay native with %s effects and after fallback",
    async (backend) => {
      const h = await harness(backend, false, sharedGraph());
      h.connectPoints("a");
      await h.engine.whenSettled();

      expect(h.engine.setParam(send, 0.3)).toBe("applied");
      expect(h.pointLevel("speakers")).toBe(0.3);
      h.ready("compatibility");
      expect(h.pointLevel("speakers")).toBe(0.3);
      expect(h.engine.setParam(send, 0.8)).toBe("applied");
      expect(h.pointLevel("speakers")).toBe(0.8);
      expect(h.engine.setParam({ ...threshold, laneId: "comp" }, -12)).toBe(
        "unavailable"
      );

      h.engine.clearTransient(send);
      expect(h.pointLevel("speakers")).toBe(1);
    }
  );

  test("a send's overlay stays when its cable moves from a lane to a unit", async () => {
    const h = await harness();
    expect(h.engine.setParam(send, 0.3)).toBe("applied");
    expect(h.levels.get("a")).toBe(0.3);

    // Station b joins the Compressor: it becomes a unit, the cable its send.
    h.engine.apply(
      compiler.compile(sharedGraph(), { crossOriginIsolated: true }),
      true
    );
    h.connectPoints("a");
    await h.engine.whenSettled();
    expect(h.engine.plan.cables.get("comp->speakers")?.from).toEqual({
      id: "comp",
      kind: "unit",
    });
    expect(h.pointLevel("speakers")).toBe(0.3);

    h.engine.clearTransient(send);
    expect(h.pointLevel("speakers")).toBe(1);
  });
});
