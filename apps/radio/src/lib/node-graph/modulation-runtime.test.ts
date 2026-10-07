import { afterEach, describe, expect, mock, test } from "bun:test";
import { ValueMapping } from "@opendaw/lib-std";
import { createDefaultEffectConfig } from "@/lib/audio/dsp/effects/registry";
import type { ModulationHost } from "@/lib/audio/manager/official-modulation-target";
import { AudioContextManager } from "../audio/playback/audio-context";
import {
  FakeAudioContext,
  FakeGainNode,
} from "../audio/routing/fake-audio-nodes";
import { publishModulationMidi } from "../midi/modulation-input";
import { compile } from "./compile";
import { ModulationDsp, type ModulationMessage } from "./modulation-dsp";
import {
  createModulationRuntime,
  gateModulator,
  modulationReadouts,
  runModulation,
} from "./modulation-runtime";
import type { createPaletteNode } from "./palette";
import { graphNodeSchema, type NodeGraph, nodeGraphSchema } from "./schema";

class ModulationContext extends FakeAudioContext {
  readonly state = "running";
  readonly destination = new FakeGainNode(this);
  readonly loaded = Promise.withResolvers<void>();
  readonly audioWorklet = { addModule: mock(() => this.loaded.promise) };
  readonly connectedTaps = new Set<unknown>();
  rejectInput: number | null = null;
  readonly addEventListener = mock(() => undefined);
  removeEventListener() {
    /* This harness keeps the audio context running. */
  }
  close() {
    return Promise.resolve();
  }
}

class ModulationWorklet extends FakeGainNode {
  static current: ModulationWorklet | null = null;
  readonly dsp = new ModulationDsp(1000);
  readonly messages: ModulationMessage[] = [];
  readonly port = {
    close: () => undefined,
    onmessage: null as
      | ((
          event: MessageEvent<{ type: string; values: Record<string, number> }>
        ) => void)
      | null,
    postMessage: (message: ModulationMessage) => {
      this.messages.push(message);
      if (message.type === "configure") {
        this.dsp.configure(message.program);
      }
      if (message.type === "gate") {
        this.dsp.gate(message.id, message.on);
      }
      if (message.type === "midi") {
        this.dsp.midi(message.bytes);
      }
    },
  };
  constructor(context: ModulationContext) {
    super(context);
    ModulationWorklet.current = this;
  }
}

const originalWorklet = globalThis.AudioWorkletNode;
const runtimes: ReturnType<typeof createModulationRuntime>[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) {
    runtime.dispose();
  }
  AudioContextManager.resetForTesting();
  globalThis.AudioWorkletNode = originalWorklet;
  ModulationWorklet.current = null;
});

function palette(
  ...[type, id, position]: Parameters<typeof createPaletteNode>
) {
  return graphNodeSchema.parse({ data: {}, id, position, type });
}

function graph(...nodes: unknown[]): NodeGraph {
  return nodeGraphSchema.parse({
    edges: [],
    nodes: [...nodes, palette("speakers", "speakers", { x: 0, y: 0 })],
    version: 2,
  });
}
function harness(
  getNativeHost: () => Promise<ModulationHost | null> = async () => null,
  available: () => boolean = () => true
) {
  const context = new ModulationContext();
  (
    AudioContextManager.getInstance() as unknown as { context: AudioContext }
  ).context = context as unknown as AudioContext;
  globalThis.AudioWorkletNode =
    ModulationWorklet as unknown as typeof AudioWorkletNode;
  const tap = new FakeGainNode(context);
  const inputs: number[] = [];
  tap.connect = (_destination, _output = 0, input = 0) => {
    if (input >= 8) {
      throw new Error("IndexSizeError");
    }
    if (context.rejectInput === input) {
      throw new Error("follower connect failed");
    }
    inputs.push(input);
    context.connectedTaps.add(input);
    return _destination;
  };
  tap.disconnect = (_destination) => {
    context.connectedTaps.clear();
  };
  const setParam = mock(() => "applied" as const);
  const owned = createModulationRuntime({
    engine: {
      clearTransient: () => undefined,
      onParamsChanged: () => () => undefined,
      onTapsChanged: () => () => undefined,
      paramAvailable: available,
      paramSoundId: () => "live-sound",
      setParam,
      tap: () => tap as unknown as AudioNode,
    },
    getNativeHost,
    getWorkletProcessorUrl: () => "/assets/custom-dsp.js",
  });
  const runtime = {
    ...owned,
    sync: (patch: NodeGraph) =>
      owned.sync(patch, compile(patch, { crossOriginIsolated: true })),
  };
  runtimes.push(owned);
  return { context, inputs, runtime, setParam };
}
async function start(context: ModulationContext) {
  context.loaded.resolve();
  // Finish worklet loading, native session setup and the runtime's finalizer.
  for (let index = 0; index < 8; index += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: flush sequential promise continuations in the startup chain.
    await Promise.resolve();
  }
  const worklet = ModulationWorklet.current;
  if (!worklet) {
    throw new Error("Missing modulation worklet");
  }
  return worklet;
}

// Real BoxGraph assignments are covered by modulation-native.test.ts. This host permits
// write/cleanup failures while exposing the surviving source values.
function nativeHost() {
  const scalar = <T>(initial: T) => {
    let value = initial;
    return {
      getValue: () => value,
      setValue: (next: T) => {
        value = next;
      },
    };
  };
  const macro = (id: string) => {
    const value = scalar(0.5);
    return {
      accept: (visitor: {
        visitMacroModulatorBox?: (box: { value: typeof value }) => void;
        visitLfoModulatorBox?: (
          box: Record<
            "rateSync" | "rateAbsolute" | "phase" | "exponent" | "shape",
            typeof value
          >
        ) => void;
      }) => {
        visitor.visitMacroModulatorBox?.({ value });
        visitor.visitLfoModulatorBox?.({
          exponent: scalar(0),
          phase: scalar(0),
          rateAbsolute: scalar(1),
          rateSync: scalar(0),
          shape: scalar(0),
        });
      },
      address: id,
      amount: scalar(1),
      bipolar: scalar(false),
      enabled: scalar(true),
      index: scalar(0),
      isAttached: () => sources.has(id),
      value,
    };
  };
  const sources = new Map<string, ReturnType<typeof macro>>();
  const create = (id: string) => {
    const box = macro(id);
    sources.set(id, box);
    return box;
  };
  const subscriptions = new Map<string, (values: number[]) => void>();
  const state: {
    cleanupFails: boolean;
    nextDispatchError: string | null;
    nextWriteError: string | null;
  } = {
    cleanupFails: false,
    nextDispatchError: null,
    nextWriteError: null,
  };
  const project = {
    api: {
      modulation: {
        createLfo: create,
        createMacro: create,
        delete: (box: ReturnType<typeof macro>) => sources.delete(box.address),
      },
    },
    engine: { wake: () => undefined },
    liveStreamReceiver: {
      dispatch: () => {
        if (state.nextDispatchError) {
          const error = state.nextDispatchError;
          state.nextDispatchError = null;
          throw new Error(error);
        }
        for (const [id, box] of sources) {
          const value = box.bipolar.getValue()
            ? ValueMapping.bipolar().y(box.value.getValue())
            : box.value.getValue();
          subscriptions.get(id)?.([0, value * box.amount.getValue()]);
        }
      },
      subscribeFloats: (id: string, callback: (values: number[]) => void) => {
        subscriptions.set(id, callback);
        return {
          terminate: () => {
            subscriptions.delete(id);
            if (state.cleanupFails) {
              throw new Error("native cleanup failed");
            }
          },
        };
      },
    },
  };
  const host: ModulationHost = {
    field: () => undefined,
    onEndpointsChanged: () => () => undefined,
    project: project as unknown as ModulationHost["project"],
    retainOutput: () => () => undefined,
    transaction: (write) => {
      const error = state.nextWriteError;
      state.nextWriteError = null;
      if (error) {
        throw new Error(error);
      }
      return write();
    },
  };
  return { host, sources, state };
}

describe("modulation runtime startup", () => {
  test.each([false, true])(
    "removed native telemetry cannot override an Envelope reusing its id (surviving native=%s)",
    async (keepNative) => {
      const native = nativeHost();
      const h = harness(async () => native.host);
      const retained: Record<string, number> = keepNative ? { kept: 0.5 } : {};
      const patch = nodeGraphSchema.parse({
        edges: [
          ...[
            ["lane", "delay"],
            ["delay", "speakers"],
          ].map(([source, target]) => ({
            id: `${source}:${target}`,
            source,
            sourceHandle: "out:audio:main",
            target,
            targetHandle: "in:audio:main",
          })),
          {
            id: "bridge",
            parameter: "feedback",
            source: "cc",
            sourceHandle: "out:control:main",
            target: "delay",
            targetHandle: "in:control:parameter",
          },
        ],
        nodes: [
          ...graph(
            palette("lfo", "reused", { x: 0, y: 0 }),
            palette("midiIn", "cc", { x: 0, y: 0 }),
            ...(keepNative ? [palette("macro", "kept", { x: 0, y: 0 })] : [])
          ).nodes,
          {
            data: {
              radio: { name: "test", streamUrl: "https://example.com/a.mp3" },
            },
            id: "lane",
            position: { x: 0, y: 0 },
            type: "station",
          },
          {
            data: { effect: createDefaultEffectConfig("delay", "delay", 0) },
            id: "delay",
            position: { x: 0, y: 0 },
            type: "delay",
          },
        ],
        version: 2,
      });
      h.runtime.sync(patch);
      const worklet = await start(h.context);
      const bridge = native.sources.get("cc");
      expect(bridge).toBeDefined();
      native.sources.get("reused")?.value.setValue(0.875);
      const emit = () =>
        worklet.port.onmessage?.({
          data: { type: "values", values: worklet.dsp.process([], 100) },
        } as MessageEvent);
      const telemetry = () =>
        worklet.messages
          .filter((message) => message.type === "native-values")
          .at(-1)?.values;
      emit();
      expect(telemetry()).toEqual({ ...retained, reused: 0.75 });

      patch.nodes = patch.nodes.filter((node) => node.id !== "reused");
      h.runtime.sync(patch);
      emit();
      const afterRemoval = telemetry();
      expect(native.sources.get("cc")).toBe(bridge);

      patch.nodes.push(palette("envelope", "reused", { x: 0, y: 0 }));
      patch.edges.push({
        depth: 0.5,
        gain: 1,
        id: "envelope-pan",
        muted: false,
        parameter: "pan",
        source: "reused",
        sourceHandle: "out:control:main",
        target: "lane",
        targetHandle: "in:control:parameter",
      });
      h.runtime.sync(patch);
      gateModulator("reused", true);
      emit();
      expect(modulationReadouts.state.values.reused).toBeCloseTo(1);
      expect(h.setParam).toHaveBeenLastCalledWith(
        { kind: "pan", laneId: "lane" },
        1
      );
      expect(afterRemoval).toEqual(retained);
      expect(telemetry()).toEqual(retained);
      expect(native.sources.get("cc")).toBe(bridge);
    }
  );

  test("Run recovers a DSP-only bridge after native host startup rejects", async () => {
    const native = nativeHost();
    const getHost = mock(() => Promise.resolve(native.host));
    getHost.mockRejectedValueOnce(new Error("temporary host failure"));
    const h = harness(getHost);
    const patch = nodeGraphSchema.parse({
      ...graph(palette("envelope", "env", { x: 0, y: 0 })),
      edges: [
        ...[
          ["lane", "delay"],
          ["delay", "speakers"],
        ].map(([source, target]) => ({
          id: `${source}:${target}`,
          source,
          sourceHandle: "out:audio:main",
          target,
          targetHandle: "in:audio:main",
        })),
        {
          id: "control",
          parameter: "feedback",
          source: "env",
          sourceHandle: "out:control:main",
          target: "delay",
          targetHandle: "in:control:parameter",
        },
      ],
      nodes: [
        ...graph(palette("envelope", "env", { x: 0, y: 0 })).nodes,
        {
          data: {
            radio: { name: "test", streamUrl: "https://example.com/a.mp3" },
          },
          id: "lane",
          position: { x: 0, y: 0 },
          type: "station",
        },
        {
          data: { effect: createDefaultEffectConfig("delay", "delay", 0) },
          id: "delay",
          position: { x: 0, y: 0 },
          type: "delay",
        },
      ],
    });
    h.runtime.sync(patch);
    const worklet = await start(h.context);
    await h.runtime.whenSettled();
    expect(modulationReadouts.state.nativeWarning).toContain(
      "temporary host failure"
    );
    expect(native.sources.size).toBe(0);
    runModulation();
    await h.runtime.whenSettled();
    worklet.port.onmessage?.({
      data: { type: "values", values: { env: 0.75 } },
    } as MessageEvent);
    expect(native.sources.get("env")?.value.getValue()).toBeCloseTo(0.875);
    expect(modulationReadouts.state.nativeWarning).toBeNull();
    expect(h.context.addEventListener).toHaveBeenCalledTimes(1);
  });

  test("unchanged native frames do not open an empty graph transaction", async () => {
    const native = nativeHost();
    const transaction = mock(native.host.transaction);
    native.host.transaction = (write) => {
      transaction(() => undefined);
      return write();
    };
    const h = harness(async () => native.host);
    h.runtime.sync(graph(palette("macro", "macro", { x: 0, y: 0 })));
    const worklet = await start(h.context);
    transaction.mockClear();
    for (let index = 0; index < 20; index += 1) {
      worklet.port.onmessage?.({
        data: { type: "values", values: {} },
      } as MessageEvent);
    }
    expect(transaction).not.toHaveBeenCalled();
  });
  test("coupled-only Run and MIDI commands keep the acquired host and listener", async () => {
    const native = nativeHost();
    const getHost = mock(async () => native.host);
    const h = harness(getHost);
    const patch = nodeGraphSchema.parse({
      edges: [
        {
          id: "in",
          source: "lane",
          sourceHandle: "out:audio:main",
          target: "fx",
          targetHandle: "in:audio:main",
        },
        {
          id: "out",
          source: "fx",
          sourceHandle: "out:audio:main",
          target: "speakers",
          targetHandle: "in:audio:main",
        },
        {
          id: "control",
          parameter: "dryWet",
          source: "cc",
          sourceHandle: "out:control:main",
          target: "fx",
          targetHandle: "in:control:parameter",
        },
      ],
      nodes: [
        ...graph(palette("midiIn", "cc", { x: 0, y: 0 })).nodes,
        {
          data: {
            radio: { name: "test", streamUrl: "https://example.com/audio.mp3" },
          },
          id: "lane",
          position: { x: 0, y: 0 },
          type: "station",
        },
        {
          data: { effect: createDefaultEffectConfig("delay", "fx", 0) },
          id: "fx",
          position: { x: 0, y: 0 },
          type: "delay",
        },
      ],
      version: 2,
    });
    h.runtime.sync(patch);
    const worklet = await start(h.context);
    await h.runtime.whenSettled();
    expect(native.sources.size).toBe(0);
    for (let run = 0; run < 5; run += 1) {
      runModulation();
      // biome-ignore lint/performance/noAwaitInLoops: settle each Run before checking whether the next one retries.
      await h.runtime.whenSettled();
    }
    expect(getHost).toHaveBeenCalledTimes(1);
    expect(h.context.addEventListener).toHaveBeenCalledTimes(1);
    const configured = () =>
      worklet.messages.filter((message) => message.type === "configure").length;
    const initial = configured();
    for (let cc = 0; cc < 20; cc += 1) {
      publishModulationMidi(new Uint8Array([0xb0, 1, cc]));
      // biome-ignore lint/performance/noAwaitInLoops: verify each MIDI event after its startup continuations settle.
      await h.runtime.whenSettled();
    }
    expect(configured()).toBe(initial);
    expect(getHost).toHaveBeenCalledTimes(1);
    expect(worklet.dsp.process([], 1).cc).toBe(19 / 127);
  });
  test("loads the host's configured processor URL", async () => {
    const h = harness();
    h.runtime.sync(graph(palette("midiIn", "midi", { x: 0, y: 0 })));
    await start(h.context);
    expect(h.context.audioWorklet.addModule).toHaveBeenCalledWith(
      "/assets/custom-dsp.js"
    );
  });

  test("replays held notes and the latest CC received while loading", async () => {
    const h = harness();
    h.runtime.sync(
      graph(
        {
          ...palette("midiIn", "gate", { x: 0, y: 0 }),
          data: { mode: "gate" },
        },
        palette("midiIn", "cc", { x: 0, y: 0 })
      )
    );
    publishModulationMidi(new Uint8Array([0x90, 60, 100]));
    for (let value = 0; value < 100; value += 1) {
      publishModulationMidi(new Uint8Array([0xb0, 1, value]));
    }
    const worklet = await start(h.context);
    expect(worklet.dsp.process([], 1)).toMatchObject({ cc: 99 / 127, gate: 1 });
    publishModulationMidi(new Uint8Array([0x80, 60, 0]));
    expect(worklet.dsp.process([], 1).gate).toBe(0);
  });

  test("retains the last pressed held note and honors resets during loading", async () => {
    const h = harness();
    const midi = {
      ...palette("midiIn", "key", { x: 0, y: 0 }),
      data: { mode: "key" },
    };
    h.runtime.sync(graph(midi));
    publishModulationMidi(new Uint8Array([0x90, 60, 100]));
    publishModulationMidi(new Uint8Array([0x90, 62, 100]));
    publishModulationMidi(new Uint8Array([0x90, 60, 100]));
    const worklet = await start(h.context);
    expect(worklet.dsp.process([], 1).key).toBe(60 / 127);
    publishModulationMidi(new Uint8Array([255]));
    expect(worklet.dsp.process([], 1).key).toBe(0);
  });

  test.each([{ bytes: [255] }, { bytes: [0xb0, 123, 0] }])(
    "a startup reset %p clears older held notes",
    async (reset) => {
      const h = harness();
      h.runtime.sync(
        graph({
          ...palette("midiIn", "key", { x: 0, y: 0 }),
          data: { mode: "key" },
        })
      );
      publishModulationMidi(new Uint8Array([0x90, 60, 100]));
      publishModulationMidi(new Uint8Array(reset.bytes));
      publishModulationMidi(new Uint8Array([0x90, 62, 100]));
      const worklet = await start(h.context);
      expect(worklet.dsp.process([], 1).key).toBe(62 / 127);
      publishModulationMidi(new Uint8Array([0x80, 62, 0]));
      expect(worklet.dsp.process([], 1).key).toBe(0);
    }
  );

  test.each([false, true])(
    "a short trigger reaches the DSP when loaded=%s",
    async (loaded) => {
      const h = harness();
      h.runtime.sync(
        graph({
          ...palette("curve", "curve", { x: 0, y: 0 }),
          data: { loop: false },
        })
      );
      if (loaded) {
        await start(h.context);
      }
      gateModulator("curve", true);
      gateModulator("curve", false);
      const worklet = await start(h.context);
      expect(worklet.dsp.process([], 100).curve).toBeGreaterThan(0);
    }
  );

  test.each([false, true])(
    "a short MIDI trigger reaches a control target when loaded=%s",
    async (loaded) => {
      const h = harness();
      const patch = nodeGraphSchema.parse({
        ...graph(
          {
            ...palette("midiIn", "midi", { x: 0, y: 0 }),
            data: { mode: "gate" },
          },
          {
            ...palette("curve", "curve", { x: 0, y: 0 }),
            data: { loop: false },
          }
        ),
        edges: [
          {
            id: "trigger",
            source: "midi",
            sourceHandle: "out:control:main",
            target: "curve",
            targetHandle: "in:control:gate",
          },
        ],
      });
      h.runtime.sync(patch);
      if (loaded) {
        await start(h.context);
      }
      publishModulationMidi(new Uint8Array([0x90, 60, 100]));
      publishModulationMidi(new Uint8Array([0x80, 60, 0]));
      const worklet = await start(h.context);
      expect(worklet.dsp.process([], 100).curve).toBeGreaterThan(0);
      expect(worklet.dsp.process([], 1).midi).toBe(0);
    }
  );

  test("native failure restores native contribution while worklet sources continue", async () => {
    const h = harness(() => Promise.reject(new Error("native load failed")));
    h.runtime.sync(
      graph(
        palette("macro", "macro", { x: 0, y: 0 }),
        palette("midiIn", "cc", { x: 0, y: 0 })
      )
    );
    publishModulationMidi(new Uint8Array([0xb0, 1, 64]));
    const worklet = await start(h.context);
    expect(worklet.dsp.process([], 1)).toMatchObject({
      cc: 64 / 127,
      macro: 0,
    });
    expect(modulationReadouts.state.backends).toEqual({
      cc: "DSP",
      macro: "unavailable",
    });
    expect(modulationReadouts.state.nativeWarning).toContain(
      "native load failed"
    );
  });

  test("disposal during loading leaves no source or late worklet", async () => {
    const h = harness();
    h.runtime.sync(graph(palette("midiIn", "cc", { x: 0, y: 0 })));
    h.runtime.dispose();
    h.context.loaded.resolve();
    await h.runtime.whenSettled();
    expect(ModulationWorklet.current).toBeNull();
    expect(modulationReadouts.state.status).toBe("idle");
  });

  test.each(["startup", "refresh", "frame"])(
    "native %s failure releases sources and keeps worklet delivery running",
    async (phase) => {
      const native = nativeHost();
      const h = harness(async () => native.host);
      const patch = graph(
        palette("macro", "macro", { x: 0, y: 0 }),
        palette("midiIn", "cc", { x: 0, y: 0 })
      );
      if (phase === "startup") {
        native.state.nextWriteError = "native write failed";
      }
      h.runtime.sync(patch);
      const worklet = await start(h.context);
      if (phase !== "startup") {
        expect(native.sources.size).toBe(1);
        native.state.cleanupFails = true;
        if (phase === "refresh") {
          native.state.nextWriteError = "native write failed";
          expect(() => h.runtime.refresh()).not.toThrow();
        } else {
          native.state.nextDispatchError = "native write failed";
          worklet.port.onmessage?.({
            data: { type: "values", values: { cc: 0.25 } },
          } as MessageEvent);
        }
      }
      expect(native.sources.size).toBe(0);
      expect(modulationReadouts.state.backends).toEqual({
        cc: "DSP",
        macro: "unavailable",
      });
      expect(modulationReadouts.state.nativeWarning).toContain(
        "native write failed"
      );
      worklet.port.onmessage?.({
        data: { type: "values", values: { cc: 0.75 } },
      } as MessageEvent);
      expect(modulationReadouts.state.values).toEqual({ cc: 0.75 });
    }
  );

  test("cleanup failure still restores values and detaches the worklet", async () => {
    const native = nativeHost();
    const h = harness(async () => native.host);
    h.runtime.sync(graph(palette("macro", "macro", { x: 0, y: 0 })));
    const worklet = await start(h.context);
    native.state.cleanupFails = true;
    expect(() => h.runtime.dispose()).not.toThrow();
    expect(native.sources.size).toBe(0);
    expect(worklet.connections).toHaveLength(0);
    expect(worklet.port.onmessage).toBeNull();
    expect(modulationReadouts.state.values).toEqual({});
    expect(modulationReadouts.state.status).toBe("idle");
  });

  test("one source bridge preserves its value through fan-out edits and ends at its last native consumer", async () => {
    const native = nativeHost();
    const h = harness(async () => native.host);
    const patch = nodeGraphSchema.parse({
      ...graph(palette("midiIn", "cc", { x: 0, y: 0 })),
      edges: [
        ...[
          ["lane", "delay"],
          ["delay", "speakers"],
        ].map(([source, target]) => ({
          id: `${source}:${target}`,
          source,
          sourceHandle: "out:audio:main",
          target,
          targetHandle: "in:audio:main",
        })),
        ...["feedback", "filter"].map((parameter) => ({
          id: parameter,
          parameter,
          source: "cc",
          sourceHandle: "out:control:main",
          target: "delay",
          targetHandle: "in:control:parameter",
        })),
      ],
      nodes: [
        ...graph(palette("midiIn", "cc", { x: 0, y: 0 })).nodes,
        {
          data: {
            radio: { name: "test", streamUrl: "https://example.com/a.mp3" },
          },
          id: "lane",
          position: { x: 0, y: 0 },
          type: "station",
        },
        {
          data: { effect: createDefaultEffectConfig("delay", "delay", 0) },
          id: "delay",
          position: { x: 0, y: 0 },
          type: "delay",
        },
      ],
    });
    h.runtime.sync(patch);
    const worklet = await start(h.context);
    expect(native.sources.size).toBe(1);
    const bridge = native.sources.get("cc");
    worklet.port.onmessage?.({
      data: { type: "values", values: { cc: -0.375 } },
    } as MessageEvent);
    expect(bridge?.value.getValue()).toBeCloseTo(0.3125);
    patch.edges = patch.edges.filter((edge) => edge.id !== "filter");
    h.runtime.sync(patch);
    expect(native.sources.get("cc")).toBe(bridge);
    expect(bridge?.value.getValue()).toBeCloseTo(0.3125);
    patch.edges = patch.edges.map((edge) =>
      edge.id === "feedback" ? { ...edge, parameter: "dryWet" } : edge
    );
    h.runtime.sync(patch);
    expect(native.sources.size).toBe(0);
    worklet.port.onmessage?.({
      data: { type: "values", values: { cc: 0.75 } },
    } as MessageEvent);
    expect(modulationReadouts.state.values).toEqual({ cc: 0.75 });
  });
});

test("worklet-only patches do not request the openDAW engine; adding a native source starts it", async () => {
  const native = nativeHost();
  const getHost = mock(async () => native.host);
  const h = harness(getHost);
  h.runtime.sync(graph(palette("shapedLfo", "shape", { x: 0, y: 0 })));
  await start(h.context);
  expect(getHost).not.toHaveBeenCalled();
  expect(modulationReadouts.state.backends.shape).toBe("DSP");
  h.runtime.sync(graph(palette("macro", "macro", { x: 0, y: 0 })));
  await h.runtime.whenSettled();
  expect(native.sources.has("macro")).toBe(true);
  h.runtime.sync(graph(palette("shapedLfo", "shape", { x: 0, y: 0 })));
  expect(native.sources.size).toBe(0);
});

test("compiled outer controls keep Autotune wrapped until the last cable is removed", () => {
  const patch = nodeGraphSchema.parse({
    edges: [
      {
        id: "in",
        source: "lane",
        sourceHandle: "out:audio:main",
        target: "tune",
        targetHandle: "in:audio:main",
      },
      {
        id: "out",
        source: "tune",
        sourceHandle: "out:audio:main",
        target: "speakers",
        targetHandle: "in:audio:main",
      },
      ...["dryWet", "inputGain"].map((parameter) => ({
        id: parameter,
        parameter,
        source: "macro",
        sourceHandle: "out:control:main",
        target: "tune",
        targetHandle: "in:control:parameter",
      })),
    ],
    nodes: [
      ...graph(palette("macro", "macro", { x: 0, y: 0 })).nodes,
      {
        data: {
          radio: { name: "test", streamUrl: "https://example.com/a.mp3" },
        },
        id: "lane",
        position: { x: 0, y: 0 },
        type: "station",
      },
      {
        data: { effect: createDefaultEffectConfig("autotune", "tune", 0) },
        id: "tune",
        position: { x: 0, y: 0 },
        type: "autotune",
      },
    ],
    version: 2,
  });
  const wrapped = () =>
    compile(patch, { crossOriginIsolated: true }).lanes.get("lane")?.effects[0]
      ?.keepWrapper;
  expect(wrapped()).toBe(true);
  patch.edges = patch.edges.filter((edge) => edge.id !== "dryWet");
  expect(wrapped()).toBe(true);
  patch.edges = patch.edges.filter((edge) => edge.id !== "inputGain");
  expect(wrapped()).toBeUndefined();
});
