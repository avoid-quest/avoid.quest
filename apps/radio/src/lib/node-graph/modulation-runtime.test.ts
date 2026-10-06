import { afterEach, describe, expect, mock, test } from "bun:test";
import { AudioContextManager } from "../audio/playback/audio-context";
import {
  FakeAudioContext,
  FakeGainNode,
} from "../audio/routing/fake-audio-nodes";
import { publishModulationMidi } from "../midi/modulation-input";
import { ModulationDsp, type ModulationMessage } from "./modulation-dsp";
import type { NativeModulationSession } from "./modulation-native";
import {
  createModulationRuntime,
  gateModulator,
  modulationReadouts,
} from "./modulation-runtime";
import { createPaletteNode } from "./palette";
import { type NodeGraph, nodeGraphSchema } from "./schema";

class ModulationContext extends FakeAudioContext {
  readonly state = "running";
  readonly destination = new FakeGainNode(this);
  readonly loaded = Promise.withResolvers<void>();
  readonly audioWorklet = { addModule: mock(() => this.loaded.promise) };
  readonly connectedTaps = new Set<unknown>();
  rejectInput: number | null = null;
  addEventListener() {
    /* This harness keeps the audio context running. */
  }
  removeEventListener() {
    /* No state listeners are installed by the harness. */
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

function palette(...args: Parameters<typeof createPaletteNode>) {
  const node = createPaletteNode(...args);
  if (!node) {
    throw new Error("Missing palette node");
  }
  return node;
}

function graph(...nodes: unknown[]): NodeGraph {
  return nodeGraphSchema.parse({
    edges: [],
    nodes: [...nodes, palette("speakers", "speakers", { x: 0, y: 0 })],
    version: 2,
  });
}
function harness(
  getNativeSession?: () => Promise<NativeModulationSession | null>
) {
  const context = new ModulationContext();
  (
    AudioContextManager.getInstance() as unknown as { context: AudioContext }
  ).context = context as unknown as AudioContext;
  globalThis.AudioWorkletNode =
    ModulationWorklet as unknown as typeof AudioWorkletNode;
  const values = mock((_next: Readonly<Record<string, number>>) => undefined);
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
  const runtime = createModulationRuntime({
    getAudioTap: () => tap as unknown as AudioNode,
    getNativeSession,
    getWorkletProcessorUrl: () => "/assets/custom-dsp.js",
    onValues: values,
  });
  runtimes.push(runtime);
  return { context, inputs, runtime, values };
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

describe("modulation runtime startup", () => {
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
    expect(
      worklet.messages.filter((message) => message.type === "midi")
    ).toHaveLength(2);
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

  test("disposes a native session whose initial configuration throws and keeps DSP active", async () => {
    const session = {
      dispatch: mock(() => undefined),
      dispose: mock(() => undefined),
      sync: mock(() => {
        throw new Error("native sync failed");
      }),
    };
    const h = harness(async () => session);
    h.runtime.sync(graph(palette("macro", "macro", { x: 0, y: 0 })));
    const worklet = await start(h.context);
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(modulationReadouts.state.nativeWarning).toContain(
      "native sync failed"
    );
    expect(modulationReadouts.state.backends.macro).toBe("DSP");
    expect(worklet.dsp.process([], 1).macro).toBe(0.5);
  });

  test("a later native sync failure falls back even if native disposal throws", async () => {
    const session = {
      dispatch: mock(() => undefined),
      dispose: mock(() => {
        throw new Error("native disposal failed");
      }),
      sync: mock(() => undefined),
    };
    const h = harness(async () => session);
    const patch = graph(palette("macro", "macro", { x: 0, y: 0 }));
    h.runtime.sync(patch);
    const worklet = await start(h.context);
    session.sync.mockImplementation(() => {
      throw new Error("native sync failed");
    });
    expect(() => h.runtime.sync(patch)).not.toThrow();
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(modulationReadouts.state.backends.macro).toBe("DSP");
    expect(worklet.dsp.process([], 1).macro).toBe(0.5);
  });

  test("native disposal failure still stops the worklet and restores values", async () => {
    const session = {
      dispatch: mock(() => undefined),
      dispose: mock(() => {
        throw new Error("native disposal failed");
      }),
      sync: mock(() => undefined),
    };
    const h = harness(async () => session);
    h.runtime.sync(graph(palette("macro", "macro", { x: 0, y: 0 })));
    const worklet = await start(h.context);
    expect(() => h.runtime.dispose()).not.toThrow();
    expect(worklet.messages.at(-1)?.type).toBe("stop");
    expect(worklet.connections.size).toBe(0);
    expect(h.values).toHaveBeenLastCalledWith({});
  });

  test("failed follower setup disconnects partial taps and allows a retry", async () => {
    const h = harness();
    const followers = [0, 1].map((index) =>
      palette("follower", `follower-${index}`, { x: 0, y: 0 })
    );
    const patch = nodeGraphSchema.parse({
      ...graph(palette("station", "source", { x: 0, y: 0 }), ...followers),
      edges: followers.map(({ id }) => ({
        id: `tap-${id}`,
        source: "source",
        sourceHandle: "out:audio:main",
        target: id,
        targetHandle: "in:audio:main",
      })),
    });
    h.context.rejectInput = 1;
    h.runtime.sync(patch);
    const first = await start(h.context);
    expect(modulationReadouts.state.status).toBe("error");
    expect(h.context.connectedTaps.size).toBe(0);
    expect(first.connections.size).toBe(0);
    h.context.rejectInput = null;
    h.runtime.sync(patch);
    const second = await start(h.context);
    expect(second).not.toBe(first);
    expect(modulationReadouts.state.status).toBe("running");
    expect([...h.context.connectedTaps]).toEqual([0, 1]);
  });

  test("a ninth wired follower is refused before taps are connected", async () => {
    const h = harness();
    const followers = Array.from({ length: 9 }, (_, index) =>
      palette("follower", `follower-${index}`, { x: 0, y: 0 })
    );
    const patch = nodeGraphSchema.parse({
      edges: followers.map(({ id }) => ({
        id: `tap-${id}`,
        source: "source",
        sourceHandle: "out:audio:main",
        target: id,
        targetHandle: "in:audio:main",
      })),
      nodes: [
        palette("station", "source", { x: 0, y: 0 }),
        palette("speakers", "speakers", { x: 0, y: 0 }),
        ...followers,
      ],
      version: 2,
    });
    h.runtime.sync(patch);
    const worklet = await start(h.context);
    expect(h.inputs).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    worklet.port.onmessage?.({
      data: { type: "values", values: { "follower-0": 0.5 } },
    } as unknown as MessageEvent<{
      type: string;
      values: Record<string, number>;
    }>);
    expect(h.values).toHaveBeenLastCalledWith({ "follower-0": 0.5 });
  });
});
