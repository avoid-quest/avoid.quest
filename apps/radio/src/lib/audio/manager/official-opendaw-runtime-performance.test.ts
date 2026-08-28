import { describe, expect, mock, test } from "bun:test";
import { OfficialOpenDawRuntime } from "./official-opendaw-runtime";

describe("OfficialOpenDawRuntime diagnostics", () => {
  test("reports openDAW's monitoring topology", () => {
    const runtime = Object.create(
      OfficialOpenDawRuntime.prototype
    ) as OfficialOpenDawRuntime;
    const project = {
      engine: {},
    };
    Object.assign(runtime as object, {
      project,
      soundUnits: new Map([["deck-a", { inputChannels: 2, source: {} }]]),
    });

    expect(runtime.getPerformanceSnapshot()).toEqual({
      backend: "official",
      monitoringChannelCount: 2,
      soundCount: 1,
      workletCount: 1,
    });
  });

  test("initializes a low-overhead project skeleton", async () => {
    const originalAudioWorkletNode = globalThis.AudioWorkletNode;
    Reflect.set(globalThis, "AudioWorkletNode", class {});
    const skeleton = {};
    const createSkeleton = mock(() => skeleton);
    const project = {
      engine: {
        isReady: () => Promise.resolve(),
        play: mock(() => undefined),
      },
      startAudioWorklet: () => ({ disconnect: () => undefined }),
      terminate: () => undefined,
    };
    const createProject = mock(() => project);
    const context = {
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
            ProjectSkeleton: { empty: createSkeleton },
            ScriptCompiler: { create: () => ({}) },
          },
          boxes: {},
          core: {
            AudioWorklets: {
              createFor: () => Promise.resolve({}),
              install: () => undefined,
            },
            Project: {
              fromSkeleton: createProject,
              new: () => project,
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

    try {
      await runtime.initialize();

      expect(createSkeleton).toHaveBeenCalledWith({
        createDefaultUser: false,
        createOutputMaximizer: false,
      });
      expect(createProject).toHaveBeenCalledWith(
        expect.anything(),
        skeleton,
        false
      );
      expect(project.engine.play).not.toHaveBeenCalled();
    } finally {
      runtime.cleanup();
      Reflect.set(globalThis, "AudioWorkletNode", originalAudioWorkletNode);
    }
  });

  test("reports no official snapshot before the project exists", () => {
    const runtime = Object.create(
      OfficialOpenDawRuntime.prototype
    ) as OfficialOpenDawRuntime;
    Object.assign(runtime as object, {
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
