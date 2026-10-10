import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { asInstanceOf, UUID } from "@opendaw/lib-std";
import type { WerkstattDeviceBox } from "@opendaw/studio-boxes";
import type { EffectBox, Project, RestartWorklet } from "@opendaw/studio-core";
// biome-ignore lint/performance/noNamespaceImport: observe the production reporting boundary
import * as Sentry from "@sentry/core";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { createNativeModulationSession } from "@/lib/node-graph/modulation-native";
import { MODULATION_DATA_SCHEMAS } from "@/lib/node-graph/modulation-schema";
import { OPENDAW_FACTORY_KEYS } from "../dsp/effects/official-opendaw-mapping.js";
import { createDefaultEffectConfig } from "../dsp/effects/registry.js";
import type { EffectConfig, OpenDawEffectType } from "../dsp/effects/types.js";
import {
  getWerkstattRuntimeStatus,
  subscribeWerkstattRuntimeStatus,
} from "../dsp/effects/werkstatt-runtime-status.js";
import {
  OfficialOpenDawRuntime,
  OPENDAW_STARTUP_SECONDS,
} from "./official-opendaw-runtime.js";

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
    wake: mock(() => undefined),
  });
  let restart: RestartWorklet | undefined;
  /** Startup deadlines, each ending once the audio clock reaches its stop. */
  const deadlines: {
    onended: (() => void) | null;
    stop: ReturnType<typeof mock>;
  }[] = [];
  const stateListeners = new Set<() => void>();
  const context = {
    addEventListener: (_type: "statechange", listener: () => void) =>
      stateListeners.add(listener),
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
    createConstantSource: () => {
      const deadline = {
        onended: null,
        start: () => undefined,
        stop: mock(() => undefined),
      };
      deadlines.push(deadline);
      return deadline;
    },
    createGain: audioNode,
    createStereoPanner: audioNode,
    currentTime: 0,
    destination: audioNode(),
    removeEventListener: (_type: "statechange", listener: () => void) =>
      stateListeners.delete(listener),
    sampleRate: 48_000,
    state: "running",
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
    wake: mock(() => undefined),
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
                liveStreamReceiver: project.liveStreamReceiver,
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
    /** The context closes, as a page tearing its audio down does. */
    close: () => {
      Object.assign(context, { state: "closed" });
      for (const listener of stateListeners) {
        listener();
      }
    },
    compiles,
    createSource: () => audioNode() as unknown as AudioNode,
    deadlines,
    destination: audioNode() as unknown as AudioNode,
    /** The audio clock runs past every startup deadline. */
    elapse: () => {
      for (const deadline of deadlines.splice(0)) {
        deadline.onended?.();
      }
    },
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
        wake: mock(() => undefined),
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
  test("accepts four stereo inputs and rejects a fifth", async () => {
    const h = await createHarness();
    for (const id of ["one", "two", "three", "four"]) {
      // biome-ignore lint/performance/noAwaitInLoops: fill the shared monitoring channels in order
      expect(await h.runtime.connectSound(id, h.source, h.destination)).toBe(
        true
      );
    }
    await expect(
      h.runtime.connectSound("five", h.source, h.destination)
    ).rejects.toThrow("openDAW monitoring supports at most 8 input channels");
    expect(h.runtime.getPerformanceSnapshot()).toMatchObject({
      monitoringChannelCount: 8,
      soundCount: 4,
    });
  });

  test("keeps more than four parallel chains in the published openDAW composite", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const config = createDefaultEffectConfig("fxComposite", "split", 0);
    const [chain] = config.chains;
    if (!chain) {
      throw new Error("Expected a default chain");
    }
    config.enabled = true;
    config.chains = Array.from({ length: 12 }, (_, order) => ({
      ...chain,
      effects: [createDefaultEffectConfig("delay", `delay-${order}`, 0)],
      id: `chain-${order}`,
      order,
    }));
    h.runtime.syncEffects("deck", [config]);
    const composite = h.project.boxGraph
      .boxes()
      .find(
        (box) =>
          box instanceof h.boxes.AudioEffectCompositeBox &&
          box.label.getValue() === "FX Composite"
      );
    if (!(composite instanceof h.boxes.AudioEffectCompositeBox)) {
      throw new Error("Expected an openDAW Split");
    }
    const cells = composite.entries.pointerHub.incoming().map(({ box }) => box);
    expect(cells).toHaveLength(12);
    expect(
      cells.every(
        (box) =>
          box instanceof h.boxes.AudioEffectCompositeCellBox &&
          box.audioEffects.pointerHub.incoming().length > 0
      )
    ).toBe(true);
  });

  test.each(["fxComposite", "stereoSplit", "frequencySplit"] as const)(
    "%s keeps branch names out of live engine cell updates",
    async (type) => {
      const h = await createHarness();
      await h.runtime.connectSound("deck", h.source, h.destination);
      const changedFields: string[] = [];
      const subscription = h.project.boxGraph.subscribeToAllUpdatesImmediate({
        onUpdate: (update) => {
          if (update.type === "primitive") {
            changedFields.push(update.address.toString());
          }
        },
      });
      try {
        const config = createDefaultEffectConfig(type, "split", 0);
        config.enabled = true;
        h.runtime.syncEffects("deck", [config]);
        const renamed = {
          ...config,
          chains: config.chains.map((chain) => ({
            ...chain,
            gain: 0.5,
            name: `Renamed ${chain.order}`,
          })),
        };
        h.runtime.syncEffects("deck", [renamed]);
        const cells = h.project.boxGraph
          .boxes()
          .filter((box) => box instanceof h.boxes.AudioEffectCompositeCellBox);
        expect(cells.length).toBeGreaterThan(0);
        // The published WASM engine rejects incremental cell-label writes.
        // Names belong to the authored config; live audio fields still update.
        for (const cell of cells) {
          expect(changedFields).not.toContain(cell.label.address.toString());
        }
        expect(cells.some((cell) => cell.gain.getValue() < 0)).toBe(true);
      } finally {
        subscription.terminate();
      }
    }
  );

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

  test.each(["disconnectSound", "deleteSound"] as const)(
    "%s releases monitoring after the source graph has already disconnected",
    async (operation) => {
      const h = await createHarness();
      await h.runtime.connectSound("removed", h.source, h.destination);
      const survivor = h.createSource();
      await h.runtime.connectSound("survivor", survivor, h.destination);
      h.source.disconnect();

      expect(() => h.runtime[operation]("removed")).not.toThrow();
      expect(h.engine.unregisterMonitoringSource).toHaveBeenCalledTimes(1);
      expect(h.renderReturn(survivor, h.destination, [0.25, 0.5])).toEqual([
        0.25, 0.5,
      ]);
      expect(() => h.runtime[operation]("removed")).not.toThrow();
      await expect(
        h.runtime.connectSound("removed", h.source, h.destination)
      ).resolves.toBe(true);
      expect(h.renderReturn(h.source, h.destination, [0.5, 0.25])).toEqual([
        0.5, 0.25,
      ]);
    }
  );

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
            tempo: 150,
          })
        ).rejects.toThrow("commit failed");
      } finally {
        endTransaction.mockRestore();
      }
      expect(h.project.boxGraph.checksum()).toEqual(checksum);
      // A later bind must use the last committed key and box handles.
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
  test("a retained effect retries the same field edit after its transaction rolls back", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const config = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      threshold: -12,
    };
    h.runtime.syncEffects("deck", [config]);
    const device = asInstanceOf(
      h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.CompressorDeviceBox),
      h.boxes.CompressorDeviceBox
    );
    const checksum = h.project.boxGraph.checksum();
    const updated = { ...config, threshold: -24 };
    const endTransaction = spyOn(h.project.boxGraph, "endTransaction");
    endTransaction.mockImplementationOnce(() => {
      throw new Error("edit failed");
    });
    try {
      expect(() => h.runtime.syncEffects("deck", [updated])).toThrow(
        "edit failed"
      );
    } finally {
      endTransaction.mockRestore();
    }
    expect(h.project.boxGraph.checksum()).toEqual(checksum);
    expect(device.threshold.getValue()).toBe(-12);
    h.runtime.syncEffects("deck", [updated]);
    expect(h.project.boxGraph.findBox(device.address.uuid).unwrap()).toBe(
      device
    );
    expect(device.threshold.getValue()).toBe(-24);
  });

  test.each(["sync", "connect", "write"] as const)(
    "a failed %s commits no script until the enclosing graph transaction succeeds",
    async (operation) => {
      const h = await createHarness();
      await h.runtime.connectSound("deck", h.source, h.destination);
      const config = { ...werkstatt(), enabled: operation !== "write" };
      h.runtime.syncEffects("deck", [config]);
      if (config.enabled) {
        await finishCompile(h.compiles[0]);
      }
      const device = scriptDevice(h);
      const code = device.code.getValue();
      const checksum = h.project.boxGraph.checksum();
      const compiled = h.compiles.length;
      const status = getWerkstattRuntimeStatus(config.id).state;
      const updated =
        operation === "write"
          ? { ...config, enabled: true }
          : werkstatt("// retry after rollback");
      const sync = () =>
        operation === "connect"
          ? h.runtime.connectSound(
              "deck",
              h.source,
              h.destination,
              undefined,
              2,
              {
                dryWet: 1,
                effects: [updated],
                tempo: 120,
              }
            )
          : Promise.resolve().then(() =>
              operation === "write"
                ? h.runtime.writeEffect("deck", config.id, updated)
                : h.runtime.syncEffects("deck", [updated])
            );
      const endTransaction = spyOn(h.project.boxGraph, "endTransaction");
      endTransaction.mockImplementationOnce(() => {
        throw new Error("script edit failed");
      });
      try {
        await expect(sync()).rejects.toThrow("script edit failed");
      } finally {
        endTransaction.mockRestore();
      }
      expect(h.project.boxGraph.checksum()).toEqual(checksum);
      expect(device.code.getValue()).toBe(code);
      expect(h.compiles).toHaveLength(compiled);
      expect(getWerkstattRuntimeStatus(config.id).state).toBe(status);
      await sync();
      expect(h.compiles).toHaveLength(compiled + 1);
      await finishCompile(h.compiles[compiled]);
      expect(scriptDevice(h)).toBe(device);
      expect(device.code.getValue()).toContain(updated.code);
      expect(getWerkstattRuntimeStatus(config.id).state).toBe("ready");
    }
  );

  test.each([
    ["write", "syncEffects"],
    ["write", "deleteSound"],
    ["sync", "syncEffects"],
    ["sync", "deleteSound"],
  ] as const)(
    "a script enabled by %s and retired by %s in one transaction never reaches the worklet",
    async (enable, retire) => {
      const h = await createHarness();
      await h.runtime.connectSound("deck", h.source, h.destination);
      const config = { ...werkstatt(), enabled: false };
      h.runtime.syncEffects("deck", [config]);
      const device = scriptDevice(h);
      const enabled = { ...config, enabled: true };

      h.project.boxGraph.beginTransaction();
      if (enable === "write") {
        expect(h.runtime.writeEffect("deck", config.id, enabled)).toBe(
          "applied"
        );
      } else {
        h.runtime.syncEffects("deck", [enabled]);
      }
      if (retire === "syncEffects") {
        h.runtime.syncEffects("deck", []);
      } else {
        h.runtime.deleteSound("deck");
      }
      h.project.boxGraph.endTransaction();
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(device.isAttached()).toBe(false);
      expect(h.compiles).toHaveLength(0);
      expect(h.subscriptions).toHaveLength(0);
      expect(getWerkstattRuntimeStatus(config.id).state).toBe("idle");
      expect(
        h.project.boxGraph
          .boxes()
          .some((box) => box instanceof h.boxes.WerkstattParameterBox)
      ).toBe(false);
    }
  );

  test("a deferred compile uses the replacement script owned at commit", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const config = { ...werkstatt(), enabled: false };
    h.runtime.syncEffects("deck", [config]);
    const retired = scriptDevice(h);
    const replacement = werkstatt("// replacement script");

    h.project.boxGraph.beginTransaction();
    h.runtime.writeEffect("deck", config.id, { ...config, enabled: true });
    h.runtime.syncEffects("deck", []);
    h.runtime.syncEffects("deck", [replacement]);
    h.project.boxGraph.endTransaction();

    const device = scriptDevice(h);
    expect(retired.isAttached()).toBe(false);
    expect(device).not.toBe(retired);
    expect(h.compiles).toHaveLength(1);
    await finishCompile(h.compiles[0]);
    expect(device.code.getValue()).toContain("// replacement script");
    expect(parameter(h, device).value.getValue()).toBe(0.25);
    expect(
      h.subscriptions.map((subscription) => subscription.deviceId)
    ).toEqual([UUID.toString(device.address.uuid)]);
    expect(getWerkstattRuntimeStatus(config.id).state).toBe("ready");
  });

  test.each(["fxComposite", "stereoSplit", "frequencySplit"] as const)(
    "%s defers descendant scripts while an ancestor is disabled",
    async (type) => {
      const h = await createHarness();
      await h.runtime.connectSound("deck", h.source, h.destination);
      const script = werkstatt("// first inactive version");
      const inner = {
        ...createDefaultEffectConfig(type, "inner", 0),
        enabled: true,
      };
      inner.chains[0].effects = [script];
      const outer = {
        ...createDefaultEffectConfig("fxComposite", "outer", 0),
        enabled: false,
      };
      outer.chains[0].effects = [inner];
      const compressor = createDefaultEffectConfig("compressor", "comp", 1);
      h.runtime.syncEffects("deck", [outer, compressor]);
      const device = scriptDevice(h);
      expect(h.compiles).toHaveLength(0);
      expect(getWerkstattRuntimeStatus(script.id).state).toBe("idle");
      const edited = structuredClone(outer);
      const [editedInner] = edited.chains[0].effects;
      if (!("chains" in editedInner)) {
        throw new Error("Inner container missing");
      }
      editedInner.chains[0].effects = [werkstatt("// latest inactive version")];
      h.runtime.syncEffects("deck", [edited, compressor]);
      expect(h.compiles).toHaveLength(0);
      h.runtime.syncEffects("deck", [{ ...edited, enabled: true }, compressor]);
      expect(h.compiles).toHaveLength(1);
      await finishCompile(h.compiles[0]);
      expect(scriptDevice(h)).toBe(device);
      expect(device.code.getValue()).toContain("// latest inactive version");
      expect(getWerkstattRuntimeStatus(script.id).state).toBe("ready");
    }
  );

  test("an existing sound can sync again after its effect transaction rolls back", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    await h.runtime.connectSidechainSource("key", h.source);
    const config = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      sidechain: { channelId: "key" },
    };
    const liveBoxes = h.project.boxGraph.boxes().slice();
    const endTransaction = spyOn(h.project.boxGraph, "endTransaction");
    endTransaction.mockImplementationOnce(() => {
      throw new Error("effect sync failed");
    });
    try {
      expect(() => h.runtime.syncEffects("deck", [config])).toThrow(
        "effect sync failed"
      );
    } finally {
      endTransaction.mockRestore();
    }
    expect(h.project.boxGraph.boxes()).toEqual(liveBoxes);
    h.runtime.syncEffects("deck", [config]);
    const device = asInstanceOf(
      h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.CompressorDeviceBox),
      h.boxes.CompressorDeviceBox
    );
    expect(device.isAttached()).toBe(true);
    expect(device.sideChain.targetVertex.unwrap().box.address.uuid).toEqual(
      h.engine.registerMonitoringSource.mock.calls[1][0]
    );
  });

  test("each keyed effect binds to the key its sidechain names, or to none", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    await h.runtime.connectSidechainSource("talk", h.createSource());
    await h.runtime.connectSidechainSource("news", h.createSource());
    const [, talk, news] = h.engine.registerMonitoringSource.mock.calls.map(
      ([uuid]) => uuid
    );
    const keyed = (id: string, type: "compressor" | "gate", key?: string) => ({
      ...createDefaultEffectConfig(type, id, 0),
      ...(key ? { sidechain: { channelId: key } } : {}),
    });
    h.runtime.syncEffects("deck", [
      keyed("comp", "compressor", "talk"),
      { ...keyed("gate", "gate", "news"), order: 1 },
      { ...keyed("self", "compressor"), order: 2 },
    ]);
    const devices = h.project.boxGraph
      .boxes()
      .filter(
        (box) =>
          box instanceof h.boxes.CompressorDeviceBox ||
          box instanceof h.boxes.GateDeviceBox
      );
    type Keyed = {
      sideChain: {
        targetVertex: {
          nonEmpty: () => boolean;
          unwrap: () => { box: { address: { uuid: unknown } } };
        };
      };
    };
    const keyOf = (device: unknown) => {
      const { targetVertex } = (device as Keyed).sideChain;
      return targetVertex.nonEmpty()
        ? targetVertex.unwrap().box.address.uuid
        : null;
    };
    const gates = devices.filter((box) => box instanceof h.boxes.GateDeviceBox);
    const compressors = devices.filter(
      (box) => !(box instanceof h.boxes.GateDeviceBox)
    );
    expect(gates.map(keyOf)).toEqual([news]);
    // One Compressor keys from talk, the other detects on its own input.
    expect(compressors.map(keyOf)).toContainEqual(talk);
    expect(compressors.map(keyOf)).toContainEqual(null);
  });

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
      h.runtime.syncEffects("deck", []);
      expect(h.project.boxGraph.boxes()).toEqual(baseline);
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
        expect(
          h.runtime.writeEffect("deck", config.id, {
            ...config,
            threshold: -18,
          })
        ).toBe("applied");
        expect(h.project.boxGraph.findBox(device.address.uuid).unwrap()).toBe(
          device
        );
        expect(device.threshold.getValue()).toBe(-18);
        expect(updates).toEqual([{ field: device.threshold, value: -18 }]);
        expect(transactions).toEqual([false]);
        expect(h.project.editing.hasNoChanges()).toBe(true);
      } finally {
        fields.terminate();
        commits.terminate();
      }
    }
  );

  test("a ready Werkstatt edit commits its mix and parameters together", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const config = werkstatt();
    h.runtime.syncEffects("deck", [config]);
    await finishCompile(h.compiles[0]);
    const device = scriptDevice(h);
    const wrapper = wrapperForDevice(h, device);
    const amount = parameter(h, device);
    const committed: Array<{ amount: number; wet: number }> = [];
    const subscription = h.project.boxGraph.subscribeTransaction({
      onBeginTransaction: () => undefined,
      onEndTransaction: (aborted) => {
        if (!aborted) {
          committed.push({
            amount: amount.value.getValue(),
            wet: wrapper.wet.getValue(),
          });
        }
      },
    });
    try {
      expect(
        h.runtime.writeEffect("deck", config.id, {
          ...config,
          dryWet: 0.5,
          parameters: { amount: 0.75 },
        })
      ).toBe("applied");
      expect(committed).toEqual([
        { amount: 0.75, wet: wrapper.wet.getValue() },
      ]);
      expect(wrapper.wet.getValue()).toBeCloseTo(20 * Math.log10(0.5));
      expect(getWerkstattRuntimeStatus(config.id).state).toBe("ready");
      expect(h.project.editing.canUndo()).toBe(false);
    } finally {
      subscription.terminate();
    }
  });

  test("transient fields preserve the authored baseline and undo history", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const config = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      enabled: true,
    };
    h.runtime.syncEffects("deck", [config]);
    const device = asInstanceOf(
      h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.CompressorDeviceBox),
      h.boxes.CompressorDeviceBox
    );
    for (let frame = 0; frame < 1000; frame += 1) {
      expect(
        h.runtime.writeEffect(
          "deck",
          config.id,
          { ...config, threshold: -20 - frame / 1000 },
          true
        )
      ).toBe("applied");
    }
    expect(device.threshold.getValue()).toBeCloseTo(-20.999, 5);
    // The same authored tree is still unchanged after transient writes.
    h.runtime.syncEffects("deck", [config]);
    expect(device.threshold.getValue()).toBeCloseTo(-20.999, 5);
    expect(h.project.editing.hasNoChanges()).toBe(true);
    expect(h.project.editing.canUndo()).toBe(false);
    h.runtime.writeEffect("deck", config.id, config, true);
    expect(device.threshold.getValue()).toBe(config.threshold);
  });

  test("transient targets needing a layout return structural without preparing boxes", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const config = {
      ...createDefaultEffectConfig("autotune", "tune", 0),
      enabled: true,
    };
    h.runtime.syncEffects("deck", [config]);
    const before = h.project.boxGraph.boxes().slice();
    expect(
      h.runtime.writeEffect("deck", config.id, { ...config, dryWet: 0.5 }, true)
    ).toBe("structural");
    expect(
      h.runtime.writeEffect(
        "deck",
        config.id,
        { ...config, signalGain: 0.5 },
        true
      )
    ).toBe("structural");
    expect(h.project.boxGraph.boxes()).toEqual(before);
    expect(h.project.editing.hasNoChanges()).toBe(true);
  });

  test("transient branch gain and pan restore the authored cell without replacing it", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const config = createDefaultEffectConfig("fxComposite", "split", 0);
    h.runtime.syncEffects("deck", [config]);
    const [chain] = config.chains;
    if (!chain) {
      throw new Error("Missing authored chain");
    }
    const cell = asInstanceOf(
      h.project.boxGraph
        .boxes()
        .find(
          (box) =>
            box instanceof h.boxes.AudioEffectCompositeCellBox &&
            box.label.getValue() === chain.name
        ),
      h.boxes.AudioEffectCompositeCellBox
    );
    h.runtime.writeEffect(
      "deck",
      config.id,
      {
        ...config,
        chains: config.chains.map((entry) =>
          entry.id === chain.id ? { ...entry, gain: 0.5, pan: -0.7 } : entry
        ),
      },
      true
    );
    expect(cell.gain.getValue()).toBeCloseTo(20 * Math.log10(0.5));
    expect(cell.pan.getValue()).toBeCloseTo(-0.7, 6);
    h.runtime.syncEffects("deck", [config]);
    expect(cell.gain.getValue()).toBeCloseTo(20 * Math.log10(chain.gain));
    expect(cell.pan.getValue()).toBe(chain.pan);
    h.runtime.writeEffect("deck", config.id, config, true);
    expect(cell.gain.getValue()).toBeCloseTo(20 * Math.log10(chain.gain));
    expect(cell.pan.getValue()).toBe(chain.pan);
    expect(h.project.boxGraph.findBox(cell.address.uuid).unwrap()).toBe(cell);
  });

  test.each(["initial", "ready", "replacement"] as const)(
    "transient Werkstatt writes are unavailable during %s compilation",
    async (phase) => {
      const h = await createHarness();
      await h.runtime.connectSound("deck", h.source, h.destination);
      const config = werkstatt();
      h.runtime.syncEffects("deck", [config]);
      if (phase !== "initial") {
        await finishCompile(h.compiles[0]);
      }
      if (phase === "replacement") {
        config.code = werkstatt("// replacement source").code;
        h.runtime.syncEffects("deck", [config]);
      }
      const device = scriptDevice(h);
      const checksum = h.project.boxGraph.checksum();
      const status = getWerkstattRuntimeStatus(config.id);
      expect(
        h.runtime.writeEffect(
          "deck",
          config.id,
          { ...config, dryWet: 0.5, parameters: { amount: 0.7 } },
          true
        )
      ).toBe("unavailable");
      expect(h.project.boxGraph.checksum()).toEqual(checksum);
      expect(getWerkstattRuntimeStatus(config.id)).toEqual(status);
      if (phase !== "ready") {
        await finishCompile(h.compiles[phase === "replacement" ? 1 : 0]);
      }
      expect(parameter(h, device).value.getValue()).toBe(0.25);
      expect(h.project.editing.canUndo()).toBe(false);
    }
  );

  test("plan-owned Autotune wrappers and signal trims preserve authored effect order", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const tune = {
      ...createDefaultEffectConfig("autotune", "tune", 0),
      enabled: true,
    };
    const delay = {
      ...createDefaultEffectConfig("delay", "delay", 1),
      enabled: true,
    };
    h.runtime.syncEffects("deck", [tune, delay]);
    const device = asInstanceOf(
      h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.AutotuneDeviceBox),
      h.boxes.AutotuneDeviceBox
    );
    const sibling = asInstanceOf(
      h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.DelayDeviceBox),
      h.boxes.DelayDeviceBox
    );
    const later = wrapperForDevice(h, sibling);
    for (const keepWrapper of [true, false, true, false]) {
      h.runtime.syncEffects("deck", [
        { ...tune, keepWrapper, signalGain: keepWrapper ? 1 : undefined },
        delay,
      ]);
      const first = keepWrapper ? wrapperForDevice(h, device) : device;
      expect(first.host.targetVertex.unwrap()).toBe(
        later.host.targetVertex.unwrap()
      );
      expect(first.index.getValue()).toBeLessThan(later.index.getValue());
      if (keepWrapper) {
        const trim = h.project.boxGraph
          .boxes()
          .find(
            (box) =>
              box instanceof h.boxes.StereoToolDeviceBox &&
              box.label.getValue() === "Cable trim"
          );
        if (!(trim instanceof h.boxes.StereoToolDeviceBox)) {
          throw new Error("Missing signal trim");
        }
        expect(trim.host.targetVertex.unwrap()).toBe(
          first.host.targetVertex.unwrap()
        );
        expect(trim.index.getValue()).toBeLessThan(first.index.getValue());
      }
      expect(device.isAttached()).toBe(true);
      expect(sibling.isAttached()).toBe(true);
      expect(h.project.editing.hasNoChanges()).toBe(true);
    }
  });

  test("model and Autotune layout changes use the structural path", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const nam = createDefaultEffectConfig("neuralAmp", "amp", 0);
    const tune = createDefaultEffectConfig("autotune", "tune", 1);
    h.runtime.syncEffects("deck", [nam, tune]);
    expect(
      h.runtime.writeEffect("deck", nam.id, { ...nam, modelId: "new-model" })
    ).toBe("structural");
    expect(
      h.runtime.writeEffect("deck", tune.id, { ...tune, dryWet: 0.5 })
    ).toBe("structural");
    const oldModel = h.project.boxGraph
      .boxes()
      .find((box) => box instanceof h.boxes.NeuralAmpDeviceBox);
    h.runtime.syncEffects("deck", [
      { ...nam, modelId: "new-model" },
      { ...tune, dryWet: 0.5 },
    ]);
    expect(h.project.boxGraph.boxes()).not.toContain(oldModel);
    const device = asInstanceOf(
      h.project.boxGraph
        .boxes()
        .find((box) => box instanceof h.boxes.AutotuneDeviceBox),
      h.boxes.AutotuneDeviceBox
    );
    expect(wrapperForDevice(h, device).wet.getValue()).toBeCloseTo(
      20 * Math.log10(0.5)
    );
    expect(h.project.editing.hasNoChanges()).toBe(true);
  });

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

  test("enabling a script through a field write compiles it and preserves its device", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const config = { ...werkstatt(), enabled: false };
    h.runtime.syncEffects("deck", [config]);
    const device = scriptDevice(h);
    const enabled = { ...config, enabled: true };
    expect(h.runtime.writeEffect("deck", config.id, enabled)).toBe("applied");
    await finishCompile(h.compiles[0]);
    expect(scriptDevice(h)).toBe(device);
    expect(device.code.getValue()).toContain("// first version");
    expect(parameter(h, device).value.getValue()).toBe(0.25);
    expect(getWerkstattRuntimeStatus(config.id).state).toBe("ready");
    h.runtime.writeEffect("deck", config.id, {
      ...enabled,
      parameters: { amount: 0.7 },
    });
    expect(parameter(h, device).value.getValue()).toBeCloseTo(0.7);
    expect(getWerkstattRuntimeStatus(config.id).state).toBe("ready");
  });

  test("a failed script keeps its error until its source changes", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const config = werkstatt("{ invalid script");
    const states: string[] = [];
    const unsubscribe = subscribeWerkstattRuntimeStatus(config.id, () => {
      states.push(getWerkstattRuntimeStatus(config.id).state);
    });
    try {
      h.runtime.syncEffects("deck", [config]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const device = scriptDevice(h);
      const code = device.code.getValue();
      const status = getWerkstattRuntimeStatus(config.id);
      expect(status.state).toBe("error");
      expect(states).toEqual(["compiling", "error"]);
      expect(h.compiles).toHaveLength(0);

      h.runtime.syncEffects("deck", [config]);
      h.runtime.syncEffects("deck", [{ ...config, dryWet: 0.5 }]);
      h.runtime.syncEffects("deck", [{ ...config, enabled: false }]);
      h.runtime.syncEffects("deck", [config]);
      expect(getWerkstattRuntimeStatus(config.id)).toEqual(status);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(states).toEqual(["compiling", "error"]);
      expect(device.code.getValue()).toBe(code);

      const corrected = werkstatt("// corrected script");
      h.runtime.syncEffects("deck", [corrected]);
      expect(scriptDevice(h)).toBe(device);
      expect(states).toEqual(["compiling", "error", "compiling"]);
      await finishCompile(h.compiles[0]);
      expect(states).toEqual(["compiling", "error", "compiling", "ready"]);
      expect(device.code.getValue()).toContain("// corrected script");
    } finally {
      unsubscribe();
    }
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
    expect(amount.value.getValue()).toBeCloseTo(0.1);
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

  test("parameter edits wait for a replacement script instead of changing the old declarations", async () => {
    const h = await createHarness();
    await h.runtime.connectSound("deck", h.source, h.destination);
    const first = werkstatt();
    h.runtime.syncEffects("deck", [first]);
    await finishCompile(h.compiles[0]);
    const device = scriptDevice(h);
    const amount = parameter(h, device);
    const second = werkstatt("// replacement script");
    h.runtime.syncEffects("deck", [second]);
    expect(
      h.runtime.writeEffect("deck", second.id, {
        ...second,
        parameters: { amount: 0.75 },
      })
    ).toBe("applied");
    expect(amount.value.getValue()).toBe(0.25);
    await finishCompile(h.compiles[1]);
    expect(parameter(h, device).value.getValue()).toBe(0.75);
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

  test("a startup that never gets ready gives up on the audio clock and lets go", async () => {
    const readiness = deferred();
    const h = await createHarness(readiness.promise);
    const connection = h.runtime.connectSound("deck", h.source, h.destination);
    await h.initializing.promise;
    // A suspended context's clock stands still, so the bound waits for it.
    expect(h.deadlines[0]?.stop).toHaveBeenCalledWith(OPENDAW_STARTUP_SECONDS);
    expect(h.runtime.startupFailed).toBe(false);

    h.elapse();
    await expect(connection).rejects.toThrow("didn't start");
    expect(h.terminate).toHaveBeenCalledTimes(1);
    expect(h.runtime.isReady).toBe(false);
    expect(h.runtime.startupFailed).toBe(true);

    // Getting ready late revives nothing, and a later sound falls back at
    // once instead of waiting out a startup of its own.
    readiness.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.runtime.isReady).toBe(false);
    expect(h.engine.registerMonitoringSource).not.toHaveBeenCalled();
    await expect(
      h.runtime.connectSound("mic", h.createSource(), h.destination)
    ).rejects.toThrow("didn't start");
    expect(h.deadlines).toHaveLength(0);
    expect(h.terminate).toHaveBeenCalledTimes(1);
  });

  test("a context that closes as openDAW starts gives up at once", async () => {
    const readiness = deferred();
    const h = await createHarness(readiness.promise);
    const connection = h.runtime.connectSound("deck", h.source, h.destination);
    await h.initializing.promise;

    // A closed context's clock never reaches the deadline.
    h.close();
    await expect(connection).rejects.toThrow("closed");
    expect(h.terminate).toHaveBeenCalledTimes(1);
    expect(h.runtime.isReady).toBe(false);
  });

  test("a context closed already doesn't start openDAW", async () => {
    const h = await createHarness();
    h.close();
    await expect(
      h.runtime.connectSound("deck", h.source, h.destination)
    ).rejects.toThrow("closed audio context");
    expect(h.deadlines).toHaveLength(0);
    expect(h.engine.registerMonitoringSource).not.toHaveBeenCalled();
  });

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

test("modulation output owners retain silence independently of endpoint subscribers", async () => {
  const h = await createHarness();
  const host = await h.runtime.getModulationHost();
  expect(host.project.boxGraph).toBe(h.project.boxGraph);
  const initialConnections = h.worklet.connections.size;
  const releaseListener = host.onEndpointsChanged(() => undefined);
  expect(h.worklet.connections.size).toBe(initialConnections);
  const releaseFirst = host.retainOutput();
  const releaseLast = host.retainOutput();
  releaseListener();
  expect(h.worklet.connections.size).toBe(initialConnections + 1);
  releaseFirst();
  expect(h.worklet.connections.size).toBe(initialConnections + 1);
  releaseLast();
  expect(h.worklet.connections.size).toBe(initialConnections);
});

test("bypass then official recreation preserves coupled Mix and signal gain requirements", async () => {
  const h = await createHarness();
  await h.runtime.connectSound("deck", h.source, h.destination);
  const config = {
    ...createDefaultEffectConfig("autotune", "tune", 0),
    enabled: true,
    keepWrapper: true,
    signalGain: 1,
  };
  h.runtime.syncEffects("deck", [config]);
  h.runtime.deleteSound("deck");
  await h.runtime.connectSound("deck", h.source, h.destination);
  h.runtime.syncEffects("deck", [config]);
  expect(
    h.runtime.writeEffect(
      "deck",
      "tune",
      { ...config, dryWet: 0.25, signalGain: 0.5 },
      true
    )
  ).toBe("applied");
  const wrappers = h.project.boxGraph
    .boxes()
    .filter((box) => box instanceof h.boxes.AudioEffectCompositeBox);
  const wrapper = wrappers.find(
    (box) => box.label.getValue() === "Radio wrapper: autotune"
  );
  expect(wrapper?.wet.getValue()).toBeCloseTo(20 * Math.log10(0.25));
  expect(wrapper?.dry.getValue()).toBeCloseTo(20 * Math.log10(0.75));
  expect(
    h.project.boxGraph
      .boxes()
      .filter((box) => box instanceof h.boxes.StereoToolDeviceBox)
      .some((box) => Math.abs(box.volume.getValue() + 6.0206) < 0.001)
  ).toBe(true);
  h.runtime.syncEffects("deck", [
    { ...config, keepWrapper: false, signalGain: undefined },
  ]);
  expect(
    h.project.boxGraph
      .boxes()
      .filter((box) => box instanceof h.boxes.StereoToolDeviceBox)
  ).toHaveLength(0);
});

test("#405 worklet restart keeps native modulation sources, assignments and bridge delivery running", async () => {
  const h = await createHarness();
  await h.runtime.connectSound("deck", h.source, h.destination);
  const config = createDefaultEffectConfig("delay", "delay", 0);
  h.runtime.syncEffects("deck", [config]);
  const host = await h.runtime.getModulationHost();
  const native = createNativeModulationSession(host, () => undefined);
  const target = {
    effectId: "delay",
    field: "feedback",
    kind: "effect" as const,
    laneId: "lane",
  };
  native.sync(
    [
      {
        data: MODULATION_DATA_SCHEMAS.macro.parse({ bipolar: true }),
        id: "bridge",
        type: "macro",
      },
    ],
    [
      {
        depth: 0.25,
        enabled: true,
        id: "cable",
        soundId: "deck",
        source: "bridge",
        target,
      },
    ]
  );
  const boxes = h.project.boxGraph.boxes().slice();
  const bridge = boxes.find(
    (box) => box instanceof h.boxes.MacroModulatorBox
  ) as import("@opendaw/studio-boxes").MacroModulatorBox;
  try {
    native.frame({ bridge: 0.5 });
    const replacement = await h.restartWorklet();
    expect(replacement.connections.size).toBeGreaterThan(0);
    expect(replacement.wake).toHaveBeenCalled();
    expect(h.project.boxGraph.boxes()).toEqual(boxes);
    expect(host.field("deck", target)).toBeDefined();
    native.frame({ bridge: -0.5 });
    expect(bridge.value.getValue()).toBe(0.25);
    expect(
      boxes
        .filter((box) => box instanceof h.boxes.ModulationBox)
        .every((box) => box.isAttached())
    ).toBe(true);
  } finally {
    native.dispose();
  }
});
