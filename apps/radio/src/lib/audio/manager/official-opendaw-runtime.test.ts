import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { UUID } from "@opendaw/lib-std";
import type { WerkstattDeviceBox } from "@opendaw/studio-boxes";
import type { Project } from "@opendaw/studio-core";
// biome-ignore lint/performance/noNamespaceImport: observe the production reporting boundary
import * as Sentry from "@sentry/core";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { createDefaultEffectConfig } from "../dsp/effects/registry.js";
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
  const audioNode = () =>
    Object.assign(new ProcessorEventTarget(), {
      connect: mock(() => undefined),
      disconnect: mock(() => undefined),
      gain: { value: 1 },
      pan: { value: 0 },
    });
  const worklet = audioNode();
  const context = {
    audioWorklet: {
      addModule: mock((url: string) => {
        expect(url.startsWith("blob:")).toBe(true);
        const pending = deferred();
        compiles.push(pending);
        return pending.promise;
      }),
    },
    createGain: audioNode,
    createStereoPanner: audioNode,
    destination: audioNode(),
    sampleRate: 48_000,
  } as unknown as AudioContext;
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
        _uuid: Uint8Array,
        _source: AudioNode,
        _channels: number,
        _destination: ReturnType<typeof audioNode>
      ) => undefined
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
    unregisterMonitoringSource: mock(() => undefined),
  };
  let project: Project | undefined;
  const terminate = mock(() => project?.terminate());
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
                boxGraph: project.boxGraph,
                editing: project.editing,
                engine,
                startAudioWorklet: () => worklet,
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
    boxes,
    compiles,
    destination: { context } as unknown as AudioNode,
    engine,
    initializing,
    get project() {
      if (!project) {
        throw new Error("Runtime has not created its project");
      }
      return project;
    },
    runtime,
    source: { context } as unknown as AudioNode,
    subscriptions,
    terminate,
    worklet,
  };
}

function werkstatt(code = "// first version") {
  return {
    ...createDefaultEffectConfig("werkstatt", "script", 0),
    code: `// @param amount 0.1\n${code}\nclass Processor { process() {} }`,
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

describe("OfficialOpenDawRuntime effect lifetime", () => {
  test("reports a running processor's terminal failure once and ignores disposed runtimes", async () => {
    const enabled = spyOn(Sentry, "isEnabled").mockReturnValue(true);
    const capture = spyOn(Sentry, "captureException").mockReturnValue(
      "event-id"
    );
    try {
      const running = await createHarness();
      await running.runtime.initialize();
      running.worklet.dispatchEvent(new ProcessorEvent("processorerror"));
      running.worklet.dispatchEvent(new ProcessorEvent("processorerror"));
      const disposed = await createHarness();
      await disposed.runtime.initialize();
      disposed.runtime.cleanup();
      disposed.worklet.dispatchEvent(new ProcessorEvent("processorerror"));
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture.mock.calls[0]?.[0]).toMatchObject({
        code: "AUDIO_PROCESSOR_FAILED",
        context: { backend: "official" },
      });
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
      const liveBoxes = h.project.boxGraph.boxes();
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

      // Adding a signal trim changes the layout while preserving the effect ID.
      h.runtime.syncEffects(
        "deck",
        action === "replace"
          ? [{ ...config, parameters: { amount: 0.75 }, signalGain: 0.5 }]
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
        expect(getWerkstattRuntimeStatus(config.id).state).toBe("ready");
        h.subscriptions[1].listener("current-device error");
        expect(getWerkstattRuntimeStatus(config.id)).toEqual({
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
    const liveBoxes = h.project.boxGraph.boxes();

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
