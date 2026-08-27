import { describe, expect, mock, test } from "bun:test";
import { OfficialOpenDawRuntime } from "./official-opendaw-runtime";

describe("OfficialOpenDawRuntime performance diagnostics", () => {
  test("delegates measurement and samples to openDAW's engine", () => {
    const perfBuffer = new Float32Array([0.1, 0.2, 0.3]);
    const runtime = Object.create(
      OfficialOpenDawRuntime.prototype
    ) as OfficialOpenDawRuntime;
    const project = {
      engine: {
        cpuLoad: { getValue: () => 37 },
        perfBuffer,
        perfIndex: 2,
        preferences: {
          settings: { debug: { dspLoadMeasurement: false } },
        },
      },
    };
    Object.assign(runtime as object, {
      context: { sampleRate: 48_000 },
      project,
      soundUnits: new Map([["deck-a", { inputChannels: 2, source: {} }]]),
    });

    runtime.setPerformanceMeasurementEnabled(true);

    expect(project.engine.preferences.settings.debug.dspLoadMeasurement).toBe(
      true
    );
    const snapshot = runtime.getPerformanceSnapshot();
    expect(snapshot).toMatchObject({
      backend: "official",
      cpuLoadPercent: 37,
      monitoringChannelCount: 2,
      perfBufferMs: perfBuffer,
      perfIndex: 2,
      quantumBudgetMs: 128 / 48,
      soundCount: 1,
      workletCount: 1,
    });
    expect(snapshot?.timing.sampleCount).toBe(3);
    expect(snapshot?.timing.p99LoadPercent).toBeCloseTo(11.25);
    expect(snapshot?.perfBufferMs).not.toBe(perfBuffer);
  });

  test("reports no official sample before the project exists", () => {
    const runtime = Object.create(
      OfficialOpenDawRuntime.prototype
    ) as OfficialOpenDawRuntime;
    Object.assign(runtime as object, {
      context: { sampleRate: 48_000 },
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
