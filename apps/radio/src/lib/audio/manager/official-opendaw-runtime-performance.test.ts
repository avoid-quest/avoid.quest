import { describe, expect, mock, test } from "bun:test";
import { OfficialOpenDawRuntime } from "./official-opendaw-runtime";

describe("OfficialOpenDawRuntime performance diagnostics", () => {
  test("delegates measurement and samples to openDAW's engine", () => {
    const perfBuffer = new Float32Array([0.1, 0.2, 0.3, 0]);
    const runtime = Object.create(
      OfficialOpenDawRuntime.prototype
    ) as OfficialOpenDawRuntime;
    const project = {
      engine: {
        cpuLoad: { getValue: () => 37 },
        perfBuffer,
        perfIndex: 0,
        preferences: {
          settings: { debug: { dspLoadMeasurement: false } },
        },
      },
    };
    Object.assign(runtime as object, {
      context: { currentTime: 0, sampleRate: 48_000 },
      project,
      soundUnits: new Map([["deck-a", { inputChannels: 2, source: {} }]]),
    });

    runtime.setPerformanceMeasurementEnabled(true);
    project.engine.perfIndex = 3;

    expect(project.engine.preferences.settings.debug.dspLoadMeasurement).toBe(
      true
    );
    const snapshot = runtime.getPerformanceSnapshot();
    expect(snapshot).toMatchObject({
      backend: "official",
      cpuLoadPercent: 37,
      monitoringChannelCount: 2,
      perfBufferMs: new Float32Array([0.1, 0.2, 0.3]),
      perfIndex: 3,
      quantumBudgetMs: 128 / 48,
      soundCount: 1,
      workletCount: 1,
    });
    expect(snapshot?.timing.sampleCount).toBe(3);
    expect(snapshot?.timing.p99LoadPercent).toBeCloseTo(11.25);
    expect(snapshot?.perfBufferMs).not.toBe(perfBuffer);
  });

  test("summarizes only samples from the current measurement interval", () => {
    const context = { currentTime: 0, sampleRate: 48_000 };
    const perfBuffer = new Float32Array([9, 8, 7, 6]);
    const runtime = Object.create(
      OfficialOpenDawRuntime.prototype
    ) as OfficialOpenDawRuntime;
    const project = {
      engine: {
        cpuLoad: { getValue: () => 0 },
        perfBuffer,
        perfIndex: 2,
        preferences: {
          settings: { debug: { dspLoadMeasurement: false } },
        },
      },
    };
    Object.assign(runtime as object, {
      context,
      project,
      soundUnits: new Map(),
    });

    runtime.setPerformanceMeasurementEnabled(true);
    perfBuffer.set([0.2, 0.3], 2);
    project.engine.perfIndex = 0;
    context.currentTime = 0.006;

    expect(runtime.getPerformanceSnapshot()?.perfBufferMs).toEqual(
      new Float32Array([0.2, 0.3])
    );

    runtime.setPerformanceMeasurementEnabled(false);
    context.currentTime = 0.01;
    runtime.setPerformanceMeasurementEnabled(true);
    perfBuffer[0] = 0.4;
    project.engine.perfIndex = 1;

    expect(runtime.getPerformanceSnapshot()?.perfBufferMs).toEqual(
      new Float32Array([0.4])
    );
  });

  test("keeps the latest full ring after the current interval wraps", () => {
    const context = { currentTime: 0, sampleRate: 128 };
    const perfBuffer = new Float32Array([0.4, 0.1, 0.2, 0.3]);
    const runtime = Object.create(
      OfficialOpenDawRuntime.prototype
    ) as OfficialOpenDawRuntime;
    const project = {
      engine: {
        cpuLoad: { getValue: () => 0 },
        perfBuffer,
        perfIndex: 1,
        preferences: {
          settings: { debug: { dspLoadMeasurement: false } },
        },
      },
    };
    Object.assign(runtime as object, {
      context,
      project,
      soundUnits: new Map(),
    });

    runtime.setPerformanceMeasurementEnabled(true);
    context.currentTime = 4;

    expect(runtime.getPerformanceSnapshot()?.perfBufferMs).toEqual(
      new Float32Array([0.1, 0.2, 0.3, 0.4])
    );
  });

  test("applies a pre-initialization measurement request to the engine", async () => {
    const originalAudioWorkletNode = globalThis.AudioWorkletNode;
    Reflect.set(globalThis, "AudioWorkletNode", class {});
    const preferences = {
      settings: { debug: { dspLoadMeasurement: false } },
    };
    const project = {
      engine: {
        cpuLoad: { getValue: () => 0 },
        isReady: () => Promise.resolve(),
        perfBuffer: new Float32Array(4),
        perfIndex: 0,
        play: () => undefined,
        preferences,
      },
      startAudioWorklet: () => ({ disconnect: () => undefined }),
      terminate: () => undefined,
    };
    const context = {
      currentTime: 0,
      destination: {},
      sampleRate: 48_000,
    } as unknown as AudioContext;
    const runtime = new OfficialOpenDawRuntime(
      context,
      undefined,
      async () =>
        ({
          adapters: {
            BpmDetector: { Unknown: "unknown" },
            ScriptCompiler: { create: () => ({}) },
          },
          boxes: {},
          core: {
            AudioWorklets: {
              createFor: () => Promise.resolve({}),
              install: () => undefined,
            },
            Project: { new: () => project },
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

    try {
      runtime.setPerformanceMeasurementEnabled(true);
      await runtime.initialize();

      expect(preferences.settings.debug.dspLoadMeasurement).toBe(true);
    } finally {
      runtime.cleanup();
      Reflect.set(globalThis, "AudioWorkletNode", originalAudioWorkletNode);
    }
  });

  test("reports no official sample before the project exists", () => {
    const runtime = Object.create(
      OfficialOpenDawRuntime.prototype
    ) as OfficialOpenDawRuntime;
    Object.assign(runtime as object, {
      context: { currentTime: 0, sampleRate: 48_000 },
      project: null,
      soundUnits: new Map(),
    });

    expect(runtime.getPerformanceSnapshot()).toBeNull();
  });

  test("registers a mono input as one openDAW monitoring channel", async () => {
    const context = {} as AudioContext;
    const source = { context } as unknown as AudioNode;
    const destination = { context } as unknown as AudioNode;
    const registerMonitoringSource = mock(() => undefined);
    const unit = {
      audioUnitBox: { address: { uuid: "unit" } },
      destination: null,
      effects: [],
      groups: [],
      inputChannels: 2,
      monitoring: true,
      source: null,
    };
    const runtime = Object.create(
      OfficialOpenDawRuntime.prototype
    ) as OfficialOpenDawRuntime;
    Object.assign(runtime as object, {
      connectionGenerations: new Map(),
      context,
      initialize: () => Promise.resolve(),
      project: {
        editing: { modify: (action: () => void) => action() },
        engine: {
          registerMonitoringSource,
          unregisterMonitoringSource: mock(() => undefined),
        },
      },
      sidechainTargets: new Map(),
      soundUnits: new Map([["mic", unit]]),
    });

    expect(await runtime.connectSound("mic", source, destination, 1, 1)).toBe(
      true
    );
    expect(registerMonitoringSource).toHaveBeenCalledWith(
      "unit",
      source,
      1,
      destination
    );
  });
});
