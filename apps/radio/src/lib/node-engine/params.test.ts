import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Store } from "@tanstack/react-store";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import { effectFieldsAreStructural } from "@/lib/audio/dsp/routing/effect-tree";
import type { AudioManager } from "@/lib/audio/manager/audio-manager";
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
// biome-ignore lint/performance/noNamespaceImport: fail at the forbidden authored-store boundary
import * as editor from "@/lib/node-graph/node-store";
import { nodeGraphSchema } from "@/lib/node-graph/schema";
import type { PlaybackActionContext } from "@/lib/playback-action-context";
import {
  resetAllPlaybackRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { createNodeEngine, type NodeEngine } from "./engine";
import type { EngineParamTarget } from "./param-target";

const engines: NodeEngine[] = [];
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
  const ctx = {
    audio: {
      getEffectsRuntimeOutcome: () => outcome,
      getPreFaderNode: () => nodes,
      getStripNodes: () => nodes,
      getTrackProgress: () => null,
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
    cueOutput: () => {
      throw new Error("No cue in this patch");
    },
    deviceSinks: () => ({
      checkDevices: async () => undefined,
      connect: () => ({ to: "nowhere" }),
      dispose: () => undefined,
      retry: () => undefined,
      status: () => undefined,
      statuses: () => ({}),
      sync: () => undefined,
    }),
    effects: {
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
      setEffectFields: (_id, id, config, transient) => {
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
      onConnect = (id) => {
        options.onConnect?.(id);
        levels.set(id, options.getLevels(id).get("speakers") ?? 0);
      };
      return {
        attach: () => undefined,
        dispose: () => undefined,
        dropSink: () => undefined,
        duck: () => null,
        refresh: (id) => {
          levels.set(id, options.getLevels(id).get("speakers") ?? 0);
        },
        release: () => undefined,
        reroute: () => undefined,
        unduck: () => undefined,
      };
    },
    resolveStream: () => {
      throw new Error("No renewal in this patch");
    },
    sinkStatuses: new Store({}),
    streamLimit: () => 8,
  });
  engines.push(engine);
  engine.apply(plan, true);
  await engine.whenSettled();
  return {
    allowOnlyEffect(id: string) {
      allowedEffect = id;
    },
    authored,
    disconnectEffects() {
      effectReady = false;
    },
    engine,
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
    ready() {
      effectReady = true;
      // A new official unit starts on the authored tree, after the native shell connected.
      for (const [id, config] of authored) {
        fields.set(id, config);
      }
      Object.assign(outcome, { backend, ready: true, status: "ready" });
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

  test("connection and new strip nodes replay overlays; retirement drops them", async () => {
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
    expect(h.levels.get("a")).toBe(1);
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

  test("every target on an actual compatibility lane is unavailable", async () => {
    const h = await harness("compatibility");
    for (const target of [threshold, pan, frequency, send]) {
      expect(h.engine.setParam(target, 0.4)).toBe("unavailable");
    }
    expect(h.levels.get("a")).toBe(1);
    expect(h.fields.get("comp")).toEqual(h.authored.get("comp"));
  });
});
