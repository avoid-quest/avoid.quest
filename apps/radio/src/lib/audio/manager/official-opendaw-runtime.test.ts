import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { asInstanceOf, UUID } from "@opendaw/lib-std";
import type { WerkstattDeviceBox } from "@opendaw/studio-boxes";
import type { EffectBox, Project, RestartWorklet } from "@opendaw/studio-core";
// biome-ignore lint/performance/noNamespaceImport: observe the production reporting boundary
import * as Sentry from "@sentry/core";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { OPENDAW_FACTORY_KEYS } from "../dsp/effects/official-opendaw-mapping.js";
import { createDefaultEffectConfig } from "../dsp/effects/registry.js";
import type { EffectConfig, OpenDawEffectType } from "../dsp/effects/types.js";
import { getWerkstattRuntimeStatus } from "../dsp/effects/werkstatt-runtime-status.js";
import { OfficialOpenDawRuntime } from "./official-opendaw-runtime.js";

const originalAudioWorkletNode = globalThis.AudioWorkletNode;
const runtimes: OfficialOpenDawRuntime[] = [];
const { Event: ProcessorEvent, EventTarget: ProcessorEventTarget } = new JSDOM(
  ""
).window;

afterEach(() => {
  for (const runtime of runtimes.splice(0)) {
    runtime.cleanup();
  }
  Reflect.set(globalThis, "AudioWorkletNode", originalAudioWorkletNode);
});

function deferred() {
  return Promise.withResolvers<void>();
}

async function finishCompile(
  pending: ReturnType<typeof deferred>,
  failure?: Error
) {
  if (failure) {
    pending.reject(failure);
  } else {
    pending.resolve();
  }
  // Drain the compiler and runtime promise continuations, including .catch().
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// Exercise the published Project, BoxGraph, adapter and ScriptCompiler. Only
// browser audio/worklet boundaries are local doubles. These tests do not prove
// DSP output, worklet-side registry ordering, WASM startup or valid NAM model
// decoding; those require a real browser/worklet and, for NAM, a model asset.
async function createHarness(engineReady: Promise<void> = Promise.resolve()) {
  Reflect.set(globalThis, "AudioWorkletNode", class {});
  const [adapters, boxes, core] = await Promise.all([
    import("@opendaw/studio-adapters"),
    import("@opendaw/studio-boxes"),
    import("@opendaw/studio-core"),
  ]);
  const compiles: ReturnType<typeof deferred>[] = [];
  const nodes = new Map<
    AudioNode,
    {
      kind: "gain" | "splitter" | "merger" | "worklet";
      edges: Set<{ destination: AudioNode; output: number; input: number }>;
    }
  >();
  const audioNode = (
    kind: "gain" | "splitter" | "merger" | "worklet" = "gain"
  ) => {
    const edges = new Set<{
      destination: AudioNode;
      output: number;
      input: number;
    }>();
    const node = Object.assign(new ProcessorEventTarget(), {
      connect: mock((destination: AudioNode, output = 0, input = 0) => {
        if (
          ![...edges].some(
            (edge) =>
              edge.destination === destination &&
              edge.output === output &&
              edge.input === input
          )
        ) {
          edges.add({ destination, input, output });
        }
        return destination;
      }),
      disconnect: mock(
        (destination?: AudioNode, output?: number, input?: number) => {
          if (!destination) {
            edges.clear();
            return;
          }
          const matches = [...edges].filter(
            (edge) =>
              edge.destination === destination &&
              (output === undefined || edge.output === output) &&
              (input === undefined || edge.input === input)
          );
          if (matches.length === 0) {
            throw new DOMException(
              "Audio nodes are not connected",
              "InvalidAccessError"
            );
          }
          for (const edge of matches) {
            edges.delete(edge);
          }
        }
      ),
      gain: { value: 1 },
      pan: { value: 0 },
    });
    Object.defineProperties(node, {
      connections: {
        get: () => new Set([...edges].map((edge) => edge.destination)),
      },
      context: { get: () => context },
    });
    nodes.set(node as unknown as AudioNode, { edges, kind });
    return node;
  };
  const worklet = Object.assign(audioNode("worklet"), {
    isReady: () => {
      initializing.resolve();
      return engineReady;
    },
  });
  let restart: RestartWorklet | undefined;
  const context = {
    audioWorklet: {
      addModule: mock((url: string) => {
        expect(url.startsWith("blob:")).toBe(true);
        const pending = deferred();
        compiles.push(pending);
        return pending.promise;
      }),
    },
    createChannelMerger: () => audioNode("merger"),
    createChannelSplitter: () => audioNode("splitter"),
    createGain: audioNode,
    createStereoPanner: audioNode,
    destination: audioNode(),
    sampleRate: 48_000,
  } as unknown as AudioContext;
  // Exercise the installed router too: its teardown leaves input edges behind.
  const { MonitoringRouter } = await import(
    new URL(
      "./MonitoringRouter.js",
      import.meta.resolve("@opendaw/studio-core")
    ).href
  );
  const commands = { updateMonitoringMap: () => undefined };
  let router = new MonitoringRouter(worklet, commands);
  let activeWorklet = worklet;
  const initializing = deferred();
  const subscriptions: Array<{
    deviceId: string;
    listener: (message: string) => void;
    terminate: ReturnType<typeof mock>;
  }> = [];
  const engine = {
    isReady: () => {
      initializing.resolve();
      return engineReady;
    },
    registerMonitoringSource: mock(
      (
        uuid: Uint8Array,
        source: AudioNode,
        channels: number,
        destination: ReturnType<typeof audioNode>
      ) => router.registerSource(uuid, source, channels, destination)
    ),
    subscribeDeviceMessage: (
      deviceId: string,
      listener: (message: string) => void
    ) => {
      const subscription = {
        deviceId,
        listener,
        terminate: mock(() => undefined),
      };
      subscriptions.push(subscription);
      return subscription;
    },
    unregisterMonitoringSource: mock((uuid: Uint8Array) =>
      router.unregisterSource(uuid)
    ),
  };
  let project: Project | undefined;
  const terminate = mock(() => {
    router.terminate();
    project?.terminate();
  });
  const runtime = new OfficialOpenDawRuntime(
    context,
    undefined,
    async () =>
      ({
        adapters,
        boxes,
        core: {
          ...core,
          AudioWorklets: {
            createFor: () => Promise.resolve({}),
            install: () => undefined,
          },
          Project: {
            fromSkeleton: (
              ...args: Parameters<typeof core.Project.fromSkeleton>
            ) => {
              project = core.Project.fromSkeleton(...args);
              return {
                api: project.api,
                boxAdapters: project.boxAdapters,
                boxGraph: project.boxGraph,
                editing: project.editing,
                engine,
                startAudioWorklet: (hook: RestartWorklet) => {
                  restart = hook;
                  worklet.connect(context.destination, 0);
                  const failed = () => {
                    worklet.removeEventListener("processorerror", failed);
                    router.terminate();
                    activeWorklet.disconnect();
                    hook.unload(undefined).then(() => undefined);
                  };
                  worklet.addEventListener("processorerror", failed);
                  return worklet;
                },
                terminate,
              };
            },
          },
          SampleService: class {},
        },
        wasm: {
          WasmEngine: {
            ensureReady: () => Promise.resolve(true),
            install: () => undefined,
          },
        },
      }) as never
  );
  runtimes.push(runtime);
  return {
    adapters,
    boxes,
    compiles,
    createSource: () => audioNode() as unknown as AudioNode,
    destination: audioNode() as unknown as AudioNode,
    engine,
    initializing,
    get project() {
      if (!project) {
        throw new Error("Runtime has not created its project");
      }
      return project;
    },
    // A pass-through monitoring processor isolates native routing from effect DSP.
    // Read destination inputs, including the muted sidechain return, before gain.
    renderReturn: (
      source: AudioNode,
      destination: AudioNode,
      samples: number[]
    ) => {
      const result = [0, 0];
      const visit = (node: AudioNode, channel: number, sample: number) => {
        if (node === destination) {
          result[channel] += sample;
          return;
        }
        const state = nodes.get(node);
        if (!state) {
          throw new Error("Unknown audio node");
        }
        for (const edge of state.edges) {
          if (
            (state.kind === "splitter" && edge.output !== channel) ||
            (state.kind === "worklet" && edge.output !== 1)
          ) {
            continue;
          }
          let nextChannel = state.kind === "splitter" ? 0 : channel;
          if (nodes.get(edge.destination)?.kind === "merger") {
            nextChannel = edge.input;
          }
          visit(edge.destination, nextChannel, sample);
        }
      };
      samples.forEach((sample, channel) => {
        visit(source, channel, sample);
      });
      return result;
    },
    restartWorklet: async (ready: Promise<void> = Promise.resolve()) => {
      if (!restart) {
        throw new Error("Worklet has not started");
      }
      router.terminate();
      activeWorklet.disconnect();
      await restart.unload(undefined);
      const replacement = Object.assign(audioNode("worklet"), {
        isReady: () => ready,
      });
      replacement.connect(context.destination, 0);
      activeWorklet = replacement;
      router = new MonitoringRouter(replacement, commands);
      restart.load(replacement as never);
      return replacement;
    },
    runtime,
    source: audioNode() as unknown as AudioNode,
    subscriptions,
    terminate,
    worklet,
  };
}

function werkstatt(code = "// first version") {
  return {
    ...createDefaultEffectConfig("werkstatt", "script", 0),
    code: `// @param amount 0.1\n${code}\nclass Processor { process() {} }`,
    enabled: true,
    parameters: { amount: 0.25 },
  };
}

function scriptDevice(harness: Awaited<ReturnType<typeof createHarness>>) {
  const devices = harness.project.boxGraph
    .boxes()
    .filter(
      (box): box is WerkstattDeviceBox =>
        box instanceof harness.boxes.WerkstattDeviceBox
    );
  expect(devices).toHaveLength(1);
  return devices[0];
}

function parameter(
  harness: Awaited<ReturnType<typeof createHarness>>,
  device: WerkstattDeviceBox
) {
  const [pointer] = device.parameters.pointerHub.filter();
  const box = pointer?.box;
  if (!(box instanceof harness.boxes.WerkstattParameterBox)) {
    throw new Error("Compiler did not create the declared parameter");
  }
  return box;
}

function wrapperForDevice(
  harness: Awaited<ReturnType<typeof createHarness>>,
  device: EffectBox
) {
  const cell = asInstanceOf(
    device.host.targetVertex.unwrap().box,
    harness.boxes.AudioEffectCompositeCellBox
  );
  return asInstanceOf(
    cell.composite.targetVertex.unwrap().box,
    harness.boxes.AudioEffectCompositeBox
  );
}

describe("OfficialOpenDawRuntime effect lifetime", () => {
  test("startup follows replacement worklets when earlier processors never become ready", async () => {
    const initial = deferred();
    const replacement = deferred();
    const h = await createHarness(initial.promise);
    let connected = false;
    const connecting = h.runtime
      .connectSound("deck", h.source, h.destination)
      .then((result) => {
        connected = result;
      });
    await h.initializing.promise;
    await h.restartWorklet(new Promise<void>(() => undefined));
    await h.restartWorklet(replacement.promise);
    expect(connected).toBe(false);
    replacement.resolve();
    await connecting;
    expect(connected).toBe(true);
    expect(h.runtime.soundCount).toBe(1);
    expect(h.runtime.isReady).toBe(true);
  });

  test("reports only the first worklet failure per runtime and ignores disposed runtimes", async () => {
    const enabled = spyOn(Sentry, "isEnabled").mockReturnValue(true);
    const capture = spyOn(Sentry, "captureException").mockReturnValue(
      "event-id"
    );
    try {
      const running = await createHarness();
      await running.runtime.initialize();
      running.worklet.dispatchEvent(new ProcessorEvent("processorerror"));
      await running.restartWorklet();
      await running.restartWorklet();
      const disposed = await createHarness();
      await disposed.runtime.initialize();
      disposed.runtime.cleanup();
      disposed.worklet.dispatchEvent(new ProcessorEvent("processorerror"));
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture.mock.calls[0]?.[0]).toMatchObject({
        code: "AUDIO_PROCESSOR_FAILED",
        context: { backend: "official" },
      });
      const other = await createHarness();
      await other.runtime.initialize();
      await other.restartWorklet();
      expect(capture).toHaveBeenCalledTimes(2);
    } finally {
      capture.mockRestore();
      enabled.mockRestore();
    }
  });

  test.each(["syncEffects", "endTransaction"] as const)(
    "a failed new connection releases its monitoring source after %s throws",
    async (failure) => {
      const h = await createHarness();
      await h.runtime.connectSound("live", h.source, h.destination);
      const liveBoxes = h.project.boxGraph.boxes().slice();
      const boundary =
        failure === "syncEffects"
          ? spyOn(h.runtime, "syncEffects")
          : spyOn(h.project.boxGraph, "endTransaction");
      boundary.mockImplementationOnce(() => {
        throw new Error("connection failed");
      });
      try {
        await expect(
          h.runtime.connectSound("failed", h.source, h.destination, 1, 2, {
            dryWet: 1,
            effects: [createDefaultEffectConfig("compressor", "comp", 0)],
            sidechainSoundId: null,
            tempo: 120,
          })
        ).rejects.toThrow("connection failed");
      } finally {
        boundary.mockRestore();
      }
      const [failedUuid] = h.engine.registerMonitoringSource.mock.calls[1];
      expect(h.runtime.soundCount).toBe(1);
      expect(h.engine.unregisterMonitoringSource).toHaveBeenCalledWith(
        failedUuid
      );
      expect(h.project.boxGraph.boxes()).toEqual(liveBoxes);
      h.runtime.deleteSound("failed");
      expect(h.project.boxGraph.boxes()).toEqual(liveBoxes);
      await expect(
        h.runtime.connectSound("failed", h.source, h.destination)
      ).resolves.toBe(true);
      expect(h.runtime.soundCount).toBe(2);
    }
  );

  test.each(["fields", "layout"] as const)(
    "a failed existing connection restores its settings before retrying %s",
    async (change) => {
      const h = await createHarness();
      await h.runtime.connectSidechainSource("key", h.source);
      const compressor = {
        ...createDefaultEffectConfig("compressor", "comp", 0),
        sidechain: { channelId: "key" },
        threshold: -12,
      };
      const settings = {
        dryWet: 0.5,
        effects: [compressor],
        sidechainSoundId: "key",
        tempo: 120,
      };
      await h.runtime.connectSound(
        "deck",
        h.source,
        h.destination,
        1,
        2,
        settings
      );
      const checksum = h.project.boxGraph.checksum();
      const next =
        change === "fields"
          ? { ...compressor, threshold: -24 }
          : createDefaultEffectConfig("plateReverb", "reverb", 0);
      const endTransaction = spyOn(h.project.boxGraph, "endTransaction");
      endTransaction.mockImplementationOnce(() => {
        throw new Error("commit failed");
      });
      try {
        await expect(
          h.runtime.connectSound("deck", h.source, h.destination, 2, 2, {
            ...settings,
            effects: [next],
            sidechainSoundId: null,
            tempo: 150,
          })
        ).rejects.toThrow("commit failed");
      } finally {
        endTransaction.mockRestore();
      }
      expect(h.project.boxGraph.checksum()).toEqual(checksum);
      // A later bind must use the last committed sidechain target and box handles.
      h.runtime.setDryWet("deck", 0.5);
      await h.runtime.connectSidechainSource("key", h.source);
      const restored = h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.CompressorDeviceBox);
      if (!(restored instanceof h.boxes.CompressorDeviceBox)) {
        throw new Error("Compressor missing");
      }
      expect(restored.threshold.getValue()).toBe(-12);
      expect(restored.sideChain.targetVertex.unwrap().box.address.uuid).toEqual(
        h.engine.registerMonitoringSource.mock.calls[0][0]
      );
      await h.runtime.connectSound("deck", h.source, h.destination, 3, 2, {
        ...settings,
        effects: [next],
        sidechainSoundId: null,
        tempo: 150,
      });
      const device = h.project.boxGraph
        .boxes()
        .find((box) =>
          change === "fields"
            ? box instanceof h.boxes.CompressorDeviceBox
            : box instanceof h.boxes.DattorroReverbDeviceBox
        );
      expect(device?.isAttached()).toBe(true);
      if (device instanceof h.boxes.CompressorDeviceBox) {
        expect(device.threshold.getValue()).toBe(-24);
      }
    }
  );
  test("restores live mono, stereo and sidechain returns on every worklet restart", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("stereo", h.source, h.destination);
    const monoSource = h.createSource();
    await h.runtime.connectSound("mono", monoSource, h.destination, 1, 1);
    const keySource = h.createSource();
    await h.runtime.connectSidechainSource("key", keySource);
    await h.runtime.connectSound("retired", h.source, h.destination);
    h.runtime.disconnectSound("retired");
    h.runtime.syncEffects("stereo", [werkstatt()]);
    await finishCompile(h.compiles[0]);
    const boxes = h.project.boxGraph.boxes().slice();
    const liveReturns = h.engine.registerMonitoringSource.mock.calls.slice(
      0,
      3
    );
    const [originalSubscription] = h.subscriptions;

    for (let index = 0; index < 2; index += 1) {
      h.engine.registerMonitoringSource.mockClear();
      // biome-ignore lint/performance/noAwaitInLoops: consecutive failures each replace the worklet
      const replacement = await h.restartWorklet();
      expect(replacement.disconnect).toHaveBeenCalledWith(
        h.source.context.destination,
        0,
        0
      );
      expect(h.engine.registerMonitoringSource.mock.calls).toEqual(liveReturns);
      expect(h.project.boxGraph.boxes()).toEqual(boxes);
    }
    expect(originalSubscription.terminate).toHaveBeenCalledTimes(1);
    h.subscriptions.at(-1)?.listener("restarted device error");
    expect(getWerkstattRuntimeStatus("script")).toEqual({
      message: "restarted device error",
      state: "error",
    });
  });

  test("repeated worklet restarts do not retain old monitoring graphs or remove dry output", async () => {
    const h = await createHarness();
    const dry = h.createSource();
    h.source.connect(dry);
    await h.runtime.connectSound("live", h.source, h.destination);
    const key = h.createSource();
    await h.runtime.connectSidechainSource("key", key);
    const connections = (node: AudioNode): Set<AudioNode> =>
      (node as unknown as { connections: Set<AudioNode> }).connections;
    const reachableCount = () => {
      const reached = new Set<AudioNode>();
      const visit = (node: AudioNode) => {
        if (reached.has(node)) {
          return;
        }
        reached.add(node);
        for (const destination of connections(node)) {
          visit(destination);
        }
      };
      visit(h.source);
      return reached.size;
    };
    const initialCount = reachableCount();

    for (let index = 0; index < 3; index += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: consecutive failures exercise retained native audio edges
      await h.restartWorklet();
      expect(reachableCount()).toBe(initialCount);
      expect(connections(h.source).has(dry)).toBe(true);
    }

    h.runtime.cleanup();
    expect(connections(h.source)).toEqual(new Set([dry]));
    expect(connections(key).size).toBe(0);
  });

  test.each(["disconnect", "delete", "replace"] as const)(
    "each monitoring return survives another source's %s and repeated restarts",
    async (action) => {
      const h = await createHarness();
      const stereoReturn = h.createSource();
      const mono = h.createSource();
      const monoReturn = h.createSource();
      const key = h.createSource();
      const dry = h.createSource();
      h.source.connect(dry);
      await h.runtime.connectSound("stereo", h.source, stereoReturn);
      await h.runtime.connectSound("mono", mono, monoReturn, 1, 1);
      await h.runtime.connectSidechainSource("key", key);
      const [, , , keyReturn] = h.engine.registerMonitoringSource.mock.calls[2];
      const liveReturns = () => {
        expect(h.renderReturn(mono, monoReturn, [0.375])).toEqual([
          0.375, 0.375,
        ]);
        expect(h.renderReturn(key, keyReturn, [0.5, 0.625])).toEqual([
          0.5, 0.625,
        ]);
        expect(h.renderReturn(key, monoReturn, [0.5, 0.625])).toEqual([0, 0]);
        expect(h.renderReturn(mono, keyReturn, [0.375])).toEqual([0, 0]);
      };
      liveReturns();
      expect(h.renderReturn(h.source, stereoReturn, [0.125, 0.25])).toEqual([
        0.125, 0.25,
      ]);
      const replacement = h.createSource();
      const replacementReturn = h.createSource();
      if (action === "replace") {
        await h.runtime.connectSound("stereo", replacement, replacementReturn);
      } else if (action === "delete") {
        h.runtime.deleteSound("stereo");
      } else {
        h.runtime.disconnectSound("stereo");
      }
      liveReturns();
      if (action === "replace") {
        expect(
          h.renderReturn(replacement, replacementReturn, [0.75, 0.875])
        ).toEqual([0.75, 0.875]);
      }
      expect(h.renderReturn(h.source, stereoReturn, [0.125, 0.25])).toEqual([
        0, 0,
      ]);
      expect(h.renderReturn(h.source, dry, [0.125, 0.25])).toEqual([
        0.125, 0.25,
      ]);
      for (let index = 0; index < 3; index += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: every crash replaces the active router
        await h.restartWorklet();
        liveReturns();
        if (action === "replace") {
          expect(
            h.renderReturn(replacement, replacementReturn, [0.75, 0.875])
          ).toEqual([0.75, 0.875]);
          expect(
            h.renderReturn(h.source, replacementReturn, [0.125, 0.25])
          ).toEqual([0, 0]);
        }
      }
      h.runtime.cleanup();
      h.runtime.cleanup();
      expect(h.renderReturn(mono, monoReturn, [0.375])).toEqual([0, 0]);
      expect(h.renderReturn(key, keyReturn, [0.5, 0.625])).toEqual([0, 0]);
      expect(
        h.renderReturn(replacement, replacementReturn, [0.75, 0.875])
      ).toEqual([0, 0]);
      expect(h.renderReturn(h.source, dry, [0.125, 0.25])).toEqual([
        0.125, 0.25,
      ]);
    }
  );

  test("a thousand sound syncs keep edits live without retaining undo history", async () => {
    const h = await createHarness();
    const compressor = createDefaultEffectConfig("compressor", "compressor", 0);
    const transactions: number[] = [];
    const subscription = h.runtime.initialize().then(() =>
      h.project.boxGraph.subscribeTransaction({
        onBeginTransaction: () => transactions.push(0),
        onEndTransaction: () => undefined,
      })
    );
    const observer = await subscription;
    try {
      for (let index = 0; index < 1000; index += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: each sync commits a complete desired sound state
        await h.runtime.connectSound(
          "deck",
          h.source,
          h.destination,
          index,
          2,
          {
            dryWet: 0.5,
            effects: [{ ...compressor, threshold: -index / 100 }],
            sidechainSoundId: null,
            tempo: 120,
          }
        );
      }
      const device = h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.CompressorDeviceBox);
      expect(device).toBeInstanceOf(h.boxes.CompressorDeviceBox);
      if (!(device instanceof h.boxes.CompressorDeviceBox)) {
        throw new Error("Compressor missing");
      }
      expect(device.threshold.getValue()).toBeCloseTo(-9.99);
      expect(transactions).toHaveLength(1000);
      expect(h.project.editing.canUndo()).toBe(false);
      expect(h.project.editing.hasNoChanges()).toBe(true);
    } finally {
      observer.terminate();
    }
  });

  test.each(Object.keys(OPENDAW_FACTORY_KEYS) as OpenDawEffectType[])(
    "%s retains its device and graph when toggled through its enabled field",
    async (type) => {
      const h = await createHarness();
      await h.runtime.connectSound("deck", h.source, h.destination);
      const baseline = h.project.boxGraph.boxes().slice();
      const config = {
        ...createDefaultEffectConfig(type, type, 0),
        enabled: true,
      };
      h.runtime.syncEffects("deck", [config]);
      const factoryName = OPENDAW_FACTORY_KEYS[type];
      const core = await import("@opendaw/studio-core");
      const device = h.project.boxGraph
        .boxes()
        .find(
          (box) =>
            !baseline.includes(box) &&
            box.name === core.EffectFactories.AudioNamed[factoryName].boxName &&
            !(
              box instanceof h.boxes.StereoToolDeviceBox &&
              ["Input trim", "Output trim", "Cable trim"].includes(
                box.label.getValue()
              )
            ) &&
            !(
              box instanceof h.boxes.AudioEffectCompositeBox &&
              box.label.getValue().startsWith("Radio wrapper:")
            )
        );
      if (!device) {
        throw new Error(`Missing ${type} device`);
      }
      const adapter = h.project.boxAdapters.adapterFor(
        device,
        h.adapters.Devices.isEffect
      );
      for (const dryWet of [1, 0.5]) {
        h.runtime.syncEffects("deck", [{ ...config, dryWet }]);
        const liveBoxes = h.project.boxGraph.boxes().slice();
        h.runtime.syncEffects("deck", [{ ...config, dryWet, enabled: false }]);
        expect(adapter.enabledField.getValue()).toBe(false);
        expect(h.project.boxGraph.boxes()).toEqual(liveBoxes);
        h.runtime.syncEffects("deck", [{ ...config, dryWet, enabled: true }]);
        expect(adapter.enabledField.getValue()).toBe(true);
        expect(h.project.boxGraph.boxes()).toEqual(liveBoxes);
        expect(device.isAttached()).toBe(true);
      }
      h.runtime.syncEffects("deck", [config]);
      expect(device.isAttached()).toBe(true);
      expect(h.project.boxGraph.findBox(device.address.uuid).unwrap()).toBe(
        device
      );
      expect(h.project.editing.hasNoChanges()).toBe(true);
    }
  );

  test.each(
    (Object.keys(OPENDAW_FACTORY_KEYS) as OpenDawEffectType[]).filter(
      (type) => type !== "autotune"
    )
  )(
    "%s keeps its uuid, parent and host chain when mix and gains leave unity",
    async (type) => {
      const h = await createHarness();
      await h.runtime.connectSound("deck", h.source, h.destination);
      const baseline = h.project.boxGraph.boxes().slice();
      const config = {
        ...createDefaultEffectConfig(type, type, 0),
        dryWet: 1,
        enabled: true,
        inputGain: 1,
        outputGain: 1,
      };
      h.runtime.syncEffects("deck", [config]);
      const core = await import("@opendaw/studio-core");
      const device = h.project.boxGraph
        .boxes()
        .find(
          (box) =>
            !baseline.includes(box) &&
            box.name ===
              core.EffectFactories.AudioNamed[OPENDAW_FACTORY_KEYS[type]]
                .boxName &&
            !(
              box instanceof h.boxes.StereoToolDeviceBox &&
              ["Input trim", "Output trim", "Cable trim"].includes(
                box.label.getValue()
              )
            ) &&
            !(
              box instanceof h.boxes.AudioEffectCompositeBox &&
              box.label.getValue().startsWith("Radio wrapper:")
            )
        );
      if (!device) {
        throw new Error(`Missing ${type} device`);
      }
      const adapter = h.project.boxAdapters.adapterFor(
        device,
        h.adapters.Devices.isEffect
      );
      const uuid = UUID.toString(device.address.uuid);
      const host = adapter.host.targetVertex.unwrap();
      const parent = asInstanceOf(
        host.box,
        h.boxes.AudioEffectCompositeCellBox
      );
      expect(
        asInstanceOf(
          parent.composite.targetVertex.unwrap().box,
          h.boxes.AudioEffectCompositeBox
        ).label.getValue()
      ).toBe(`Radio wrapper: ${type}`);
      const chain = adapter.deviceHost().audioEffects.unwrap();
      for (const field of ["dryWet", "inputGain", "outputGain"] as const) {
        for (const value of [0.5, 1]) {
          h.runtime.syncEffects("deck", [{ ...config, [field]: value }]);
          expect(UUID.toString(device.address.uuid)).toBe(uuid);
          expect(h.project.boxGraph.findBox(device.address.uuid).unwrap()).toBe(
            device
          );
          expect(adapter.host.targetVertex.unwrap()).toBe(host);
          expect(adapter.host.targetVertex.unwrap().box).toBe(parent);
          expect(adapter.deviceHost().audioEffects.unwrap()).toBe(chain);
        }
      }
    }
  );

  test("adding, reordering and removing effects keeps surviving devices and trim order", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const compressor = {
      ...createDefaultEffectConfig("compressor", "compressor", 0),
      enabled: true,
    };
    const delay = {
      ...createDefaultEffectConfig("delay", "delay", 1),
      dryWet: 0.5,
      enabled: true,
      signalGain: 0.5,
    };
    const reverb = {
      ...createDefaultEffectConfig("cheapReverb", "reverb", 2),
      dryWet: 1,
      enabled: true,
    };
    h.runtime.syncEffects("deck", [compressor, delay, reverb]);
    const device = asInstanceOf(
      h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.DelayDeviceBox),
      h.boxes.DelayDeviceBox
    );
    const survivor = asInstanceOf(
      h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.ReverbDeviceBox),
      h.boxes.ReverbDeviceBox
    );
    const retired = asInstanceOf(
      h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.CompressorDeviceBox),
      h.boxes.CompressorDeviceBox
    );
    const delayWrapper = wrapperForDevice(h, device);
    const reverbWrapper = wrapperForDevice(h, survivor);
    const chain = h.project.boxAdapters
      .adapterFor(reverbWrapper, h.adapters.Devices.isEffect)
      .deviceHost()
      .audioEffects.unwrap();
    const labels = () =>
      chain.adapters().map((adapter) => adapter.labelField.getValue());
    expect(labels()).toEqual([
      "Radio wrapper: compressor",
      "Output trim",
      "Cable trim",
      "Radio wrapper: delay",
      "Output trim",
      "Radio wrapper: cheapReverb",
      "Output trim",
    ]);
    const reordered = [
      { ...delay, order: 0 },
      { ...compressor, order: 1 },
      reverb,
    ];
    h.runtime.syncEffects("deck", reordered);
    expect(labels()).toEqual([
      "Cable trim",
      "Radio wrapper: delay",
      "Output trim",
      "Radio wrapper: compressor",
      "Output trim",
      "Radio wrapper: cheapReverb",
      "Output trim",
    ]);
    const added = {
      ...createDefaultEffectConfig("waveshaper", "shape", 1),
      enabled: true,
    };
    h.runtime.syncEffects("deck", [reordered[0], added, reverb]);
    expect(h.project.boxGraph.boxes()).toContain(device);
    expect(h.project.boxGraph.boxes()).toContain(survivor);
    expect(h.project.boxGraph.boxes()).not.toContain(retired);
    h.runtime.syncEffects("deck", [
      { ...delay, dryWet: 1, order: 0, signalGain: undefined },
      reverb,
    ]);
    expect(h.project.boxGraph.boxes()).toContain(device);
    expect(h.project.boxGraph.boxes()).toContain(survivor);
    expect(labels()).toEqual([
      "Radio wrapper: delay",
      "Output trim",
      "Radio wrapper: cheapReverb",
      "Output trim",
    ]);
    expect(delayWrapper.index.getValue()).toBe(0);
    expect(reverbWrapper.index.getValue()).toBe(2);
  });

  test.each([false, true])(
    "a knob edit emits only the changed field in one transaction (nested=%s)",
    async (nested) => {
      const h = await createHarness();
      await h.runtime.connectSound("deck", h.source, h.destination);
      const config = createDefaultEffectConfig("compressor", "compressor", 0);
      const container = createDefaultEffectConfig(
        "frequencySplit",
        "container",
        0
      );
      const effects = (compressor: typeof config): EffectConfig[] => {
        if (!nested) {
          return [compressor];
        }
        const [first, ...rest] = container.chains;
        return [
          {
            ...container,
            chains: [{ ...first, effects: [compressor] }, ...rest],
          } as EffectConfig,
        ];
      };
      h.runtime.syncEffects("deck", effects(config));
      const device = asInstanceOf(
        h.project.boxGraph
          .boxes()
          .find((box) => box instanceof h.boxes.CompressorDeviceBox),
        h.boxes.CompressorDeviceBox
      );
      const updates: Array<{ field: unknown; value: unknown }> = [];
      const transactions: boolean[] = [];
      const fields = h.project.boxGraph.subscribeToAllUpdates({
        onUpdate: (update) => {
          updates.push(
            update.type === "primitive"
              ? {
                  field: update.field(h.project.boxGraph),
                  value: update.newValue,
                }
              : { field: null, value: update.type }
          );
        },
      });
      const commits = h.project.boxGraph.subscribeTransaction({
        onBeginTransaction: () => undefined,
        onEndTransaction: (rolledBack) => {
          transactions.push(rolledBack);
        },
      });
      try {
        h.runtime.syncEffects("deck", effects({ ...config, threshold: -18 }));
        expect(updates).toEqual([{ field: device.threshold, value: -18 }]);
        expect(transactions).toEqual([false]);
        expect(h.project.editing.hasNoChanges()).toBe(true);
      } finally {
        fields.terminate();
        commits.terminate();
      }
    }
  );

  test.each(["fxComposite", "stereoSplit", "frequencySplit"] as const)(
    "%s edits nested chains and cell controls without resetting their devices",
    async (type) => {
      const h = await createHarness();
      await h.runtime.connectSound("deck", h.source, h.destination);
      const config = {
        ...createDefaultEffectConfig(type, "container", 0),
        enabled: true,
      };
      const delay = {
        ...createDefaultEffectConfig("delay", "delay", 0),
        enabled: true,
      };
      const reverb = {
        ...createDefaultEffectConfig("cheapReverb", "reverb", 0),
        dryWet: 1,
        enabled: true,
      };
      const [first, second] = config.chains;
      if (!(first && second)) {
        throw new Error("Container needs two chains");
      }
      first.effects = [delay];
      second.effects = [reverb];
      h.runtime.syncEffects("deck", [config]);
      const device = asInstanceOf(
        h.project.boxGraph
          .boxes()
          .find((box) => box instanceof h.boxes.DelayDeviceBox),
        h.boxes.DelayDeviceBox
      );
      const survivor = asInstanceOf(
        h.project.boxGraph
          .boxes()
          .find((box) => box instanceof h.boxes.ReverbDeviceBox),
        h.boxes.ReverbDeviceBox
      );
      const delayWrapper = wrapperForDevice(h, device);
      const reverbWrapper = wrapperForDevice(h, survivor);
      const previousBoxes = h.project.boxGraph.boxes().slice();
      const updated = {
        ...config,
        chains: [
          {
            ...second,
            effects: [{ ...reverb, enabled: false }],
            gain: 0.5,
            order: 0,
          },
          { ...first, effects: [{ ...delay, feedback: 0.75 }], order: 1 },
          ...config.chains.slice(2),
        ],
      };
      h.runtime.syncEffects("deck", [updated]);
      expect(h.project.boxGraph.boxes()).toEqual(previousBoxes);
      expect(device.feedback.getValue()).toBe(0.75);
      expect(survivor.enabled.getValue()).toBe(false);
      const cell = asInstanceOf(
        reverbWrapper.host.targetVertex.unwrap().box,
        h.boxes.AudioEffectCompositeCellBox
      );
      expect(cell.gain.getValue()).toBeCloseTo(20 * Math.log10(0.5));
      h.runtime.syncEffects("deck", [
        {
          ...updated,
          chains: [
            { ...updated.chains[0], effects: [delay, { ...reverb, order: 1 }] },
          ],
        } as EffectConfig,
      ]);
      expect(h.project.boxGraph.boxes()).toContain(device);
      expect(h.project.boxGraph.boxes()).toContain(survivor);
      expect(delayWrapper.host.targetVertex.unwrap()).toBe(
        reverbWrapper.host.targetVertex.unwrap()
      );
      expect(delayWrapper.index.getValue()).toBe(0);
      expect(reverbWrapper.index.getValue()).toBe(2);
    }
  );

  test("signal trim and mix edits preserve a compiling script and its parameters", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const config = werkstatt();
    h.runtime.syncEffects("deck", [config]);
    const device = scriptDevice(h);
    const amount = parameter(h, device);
    h.runtime.syncEffects("deck", [
      { ...config, dryWet: 0.5, parameters: { amount: 0.75 }, signalGain: 0.5 },
    ]);
    expect(scriptDevice(h)).toBe(device);
    expect(parameter(h, device)).toBe(amount);
    await finishCompile(h.compiles[0]);
    expect(amount.value.getValue()).toBe(0.75);
    expect(h.compiles).toHaveLength(1);
    expect(h.subscriptions).toHaveLength(1);
  });

  test("changing a NAM model replaces only that device and releases its old model", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const config = {
      ...createDefaultEffectConfig("neuralAmp", "amp", 0),
      modelData: "first model",
    };
    const delay = createDefaultEffectConfig("delay", "delay", 1);
    h.runtime.syncEffects("deck", [config, delay]);
    const original = asInstanceOf(
      h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.NeuralAmpDeviceBox),
      h.boxes.NeuralAmpDeviceBox
    );
    const model = original.model.targetVertex.unwrap();
    const survivor = asInstanceOf(
      h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.DelayDeviceBox),
      h.boxes.DelayDeviceBox
    );
    h.runtime.syncEffects("deck", [
      { ...config, modelData: "second model" },
      delay,
    ]);
    const replacement = asInstanceOf(
      h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.NeuralAmpDeviceBox),
      h.boxes.NeuralAmpDeviceBox
    );
    expect(replacement).not.toBe(original);
    expect(original.isAttached()).toBe(false);
    expect(model.box.isAttached()).toBe(false);
    expect(
      asInstanceOf(
        replacement.model.targetVertex.unwrap(),
        h.boxes.NeuralAmpModelBox
      ).model.getValue()
    ).toBe("second model");
    expect(h.project.boxGraph.boxes()).toContain(survivor);
    h.runtime.deleteSound("deck");
    expect(replacement.isAttached()).toBe(false);
    expect(
      h.project.boxGraph
        .boxes()
        .some((box) => box instanceof h.boxes.NeuralAmpModelBox)
    ).toBe(false);
  });

  test("disabled scripts compile their latest source only when enabled", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const config = { ...werkstatt(), enabled: false };
    h.runtime.syncEffects("deck", [config]);
    const device = scriptDevice(h);
    expect(h.compiles).toHaveLength(0);
    expect(getWerkstattRuntimeStatus(config.id).state).toBe("idle");
    h.runtime.syncEffects("deck", [{ ...config, code: "{ invalid script" }]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.compiles).toHaveLength(0);
    expect(getWerkstattRuntimeStatus(config.id).state).toBe("idle");

    const enabled = { ...werkstatt("// edited while off"), enabled: true };
    h.runtime.syncEffects("deck", [enabled]);
    expect(scriptDevice(h)).toBe(device);
    expect(h.compiles).toHaveLength(1);
    await finishCompile(h.compiles[0]);
    expect(getWerkstattRuntimeStatus(config.id).state).toBe("ready");
    const code = device.code.getValue();
    h.runtime.syncEffects("deck", [{ ...enabled, enabled: false }]);
    h.runtime.syncEffects("deck", [enabled]);
    expect(h.compiles).toHaveLength(1);
    expect(device.code.getValue()).toBe(code);

    const edited = {
      ...werkstatt("// another edit while off"),
      enabled: false,
    };
    h.runtime.syncEffects("deck", [edited]);
    expect(h.compiles).toHaveLength(1);
    expect(getWerkstattRuntimeStatus(config.id).state).toBe("ready");
    h.runtime.syncEffects("deck", [{ ...edited, enabled: true }]);
    expect(h.compiles).toHaveLength(2);
    await finishCompile(h.compiles[1]);
    expect(device.code.getValue()).toContain("// another edit while off");
  });

  test("a newer compile wins when the superseded compile completes last", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const first = werkstatt();
    h.runtime.syncEffects("deck", [first]);
    const device = scriptDevice(h);
    const amount = parameter(h, device);
    const second = {
      ...werkstatt("// second version"),
      parameters: { amount: 0.75 },
    };
    h.runtime.syncEffects("deck", [second]);

    expect(scriptDevice(h)).toBe(device);
    expect(h.compiles).toHaveLength(2);
    expect(h.subscriptions).toHaveLength(1);
    expect(getWerkstattRuntimeStatus(first.id).state).toBe("compiling");
    await finishCompile(h.compiles[1]);
    expect(amount.value.getValue()).toBe(0.75);
    expect(getWerkstattRuntimeStatus(first.id).state).toBe("ready");
    const currentCode = device.code.getValue();

    await finishCompile(h.compiles[0]);
    expect(amount.value.getValue()).toBe(0.75);
    expect(device.code.getValue()).toBe(currentCode);
    expect(getWerkstattRuntimeStatus(first.id).state).toBe("ready");
  });

  test.each(["replace", "remove"] as const)(
    "ignores compile completion and messages after %s",
    async (action) => {
      const h = await createHarness();
      await h.runtime.connectSound("deck", h.source, h.destination);
      const config = werkstatt();
      h.runtime.syncEffects("deck", [config]);
      const retired = scriptDevice(h);
      const oldParameter = parameter(h, retired);
      const [oldSubscription] = h.subscriptions;
      expect(oldSubscription.deviceId).toBe(
        UUID.toString(retired.address.uuid)
      );

      // Replacing the effect retires its compiler and device subscription.
      h.runtime.syncEffects(
        "deck",
        action === "replace"
          ? [
              {
                ...config,
                id: "replacement-script",
                parameters: { amount: 0.75 },
              },
            ]
          : []
      );
      expect(h.project.boxGraph.boxes()).not.toContain(retired);
      expect(h.project.boxGraph.boxes()).not.toContain(oldParameter);
      expect(oldSubscription.terminate).toHaveBeenCalledTimes(1);
      const status = getWerkstattRuntimeStatus(config.id);
      const oldValue = oldParameter.value.getValue();
      await finishCompile(h.compiles[0]);
      oldSubscription.listener("late retired-device error");
      expect(oldParameter.value.getValue()).toBe(oldValue);
      expect(getWerkstattRuntimeStatus(config.id)).toEqual(status);

      if (action === "replace") {
        const replacement = scriptDevice(h);
        expect(replacement).not.toBe(retired);
        await finishCompile(h.compiles[1]);
        expect(parameter(h, replacement).value.getValue()).toBe(0.75);
        expect(getWerkstattRuntimeStatus("replacement-script").state).toBe(
          "ready"
        );
        h.subscriptions[1].listener("current-device error");
        expect(getWerkstattRuntimeStatus("replacement-script")).toEqual({
          message: "current-device error",
          state: "error",
        });
      } else {
        expect(
          h.project.boxGraph
            .boxes()
            .some((box) => box instanceof h.boxes.WerkstattDeviceBox)
        ).toBe(false);
        expect(getWerkstattRuntimeStatus(config.id).state).toBe("idle");
      }
    }
  );

  test("parameter updates preserve the live device, parameter and subscription", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const config = werkstatt();
    h.runtime.syncEffects("deck", [config]);
    await finishCompile(h.compiles[0]);
    const device = scriptDevice(h);
    const amount = parameter(h, device);
    const liveBoxes = h.project.boxGraph.boxes().slice();

    h.runtime.syncEffects("deck", [
      { ...config, parameters: { amount: 0.625 } },
    ]);
    expect(scriptDevice(h)).toBe(device);
    expect(parameter(h, device)).toBe(amount);
    expect(amount.value.getValue()).toBe(0.625);
    expect(h.project.editing.canUndo()).toBe(false);
    expect(h.project.editing.hasNoChanges()).toBe(true);
    expect(h.project.boxGraph.boxes()).toEqual(liveBoxes);
    expect(h.compiles).toHaveLength(1);
    expect(h.subscriptions).toHaveLength(1);
    expect(h.subscriptions[0].terminate).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    "cleanup releases resources and ignores pending compile (reject=%s)",
    async (reject) => {
      const h = await createHarness();
      await h.runtime.connectSidechainSource("deck", h.source);
      const config = werkstatt();
      h.runtime.syncEffects("deck", [config]);
      const amount = parameter(h, scriptDevice(h));
      const value = amount.value.getValue();
      const [subscription] = h.subscriptions;

      h.runtime.cleanup();
      h.runtime.cleanup();
      expect(h.runtime.isReady).toBe(false);
      expect(h.runtime.soundCount).toBe(0);
      expect(h.runtime.getPerformanceSnapshot()).toBeNull();
      expect(subscription.terminate).toHaveBeenCalledTimes(1);
      expect(h.engine.unregisterMonitoringSource).toHaveBeenCalledTimes(1);
      const [, , , destination] =
        h.engine.registerMonitoringSource.mock.calls[0];
      expect(destination.gain.value).toBe(0);
      expect(destination.disconnect).toHaveBeenCalledTimes(1);
      expect(h.terminate).toHaveBeenCalledTimes(1);
      await finishCompile(
        h.compiles[0],
        reject ? new Error("late compiler failure") : undefined
      );
      subscription.listener("late device error");
      expect(amount.value.getValue()).toBe(value);
      expect(getWerkstattRuntimeStatus(config.id).state).toBe("idle");
      await expect(
        h.runtime.connectSound("late", h.source, h.destination)
      ).rejects.toThrow("closed");
      expect(h.engine.registerMonitoringSource).toHaveBeenCalledTimes(1);
    }
  );

  test("cleanup during initialization prevents pending sound registration", async () => {
    const readiness = deferred();
    const h = await createHarness(readiness.promise);
    const connection = h.runtime.connectSound("deck", h.source, h.destination);
    await h.initializing.promise;
    h.runtime.cleanup();
    readiness.resolve();

    await expect(connection).rejects.toThrow("initialization was canceled");
    expect(h.engine.registerMonitoringSource).not.toHaveBeenCalled();
    expect(h.terminate).toHaveBeenCalledTimes(1);
    expect(h.runtime.isReady).toBe(false);
    expect(h.runtime.soundCount).toBe(0);
    expect(h.subscriptions).toHaveLength(0);
    expect(h.compiles).toHaveLength(0);
  });
});
