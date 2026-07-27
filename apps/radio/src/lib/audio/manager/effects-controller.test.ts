import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createDefaultEffectConfig } from "../dsp/effects/registry";
import {
  AudioContextManager,
  getAudioContext,
  type WorkletManager,
} from "../playback";
import {
  type AudioEngineLifecycleHarness,
  installAudioEngineLifecycleHarness,
} from "./audio-engine-lifecycle-test-harness";
import type { SoundInstance } from "./audio-manager-types";
import { EffectsController } from "./effects-controller";
import type { EffectsGraphRuntime } from "./effects-graph-runtime";

class TestAudioNode {
  readonly context: BaseAudioContext;
  readonly connections = new Set<TestAudioNode>();

  constructor(context: BaseAudioContext) {
    this.context = context;
  }

  connect(destination: TestAudioNode): TestAudioNode {
    this.connections.add(destination);
    return destination;
  }

  disconnect(destination?: TestAudioNode): void {
    if (destination) {
      this.connections.delete(destination);
    } else {
      this.connections.clear();
    }
  }
}

function createManager(context: AudioContext) {
  const node = new TestAudioNode(context);
  const outputNode = new TestAudioNode(context);
  return {
    addEffect: mock(() => undefined),
    cleanup: mock(() => undefined),
    createStreamSource: mock(() => undefined),
    init: mock(() => Promise.resolve()),
    node: node as unknown as AudioWorkletNode,
    on: mock(() => undefined),
    outputNode: outputNode as unknown as GainNode,
    pauseSource: mock(() => undefined),
    removeEffect: mock(() => undefined),
    reorderEffects: mock(() => undefined),
    resumeSource: mock(() => undefined),
    setEffectsDryWet: mock(() => undefined),
    setTempo: mock(() => undefined),
    startSource: mock(() => undefined),
    stopSource: mock(() => undefined),
    updateEffect: mock(() => undefined),
  } as unknown as WorkletManager;
}

function sound(soundId: string, filter: TestAudioNode): SoundInstance {
  return {
    sourceId: soundId,
    nodes: { filter },
  } as unknown as SoundInstance;
}

function createRuntime() {
  return {
    cleanup: mock(() => undefined),
    connectSidechainSource: mock(() => Promise.resolve(true)),
    connectSound: mock(
      (
        _soundId: string,
        _source: AudioNode,
        _destination: AudioNode,
        _generation: number
      ) => Promise.resolve(true)
    ),
    deleteSound: mock(() => undefined),
    disconnectSound: mock(() => undefined),
    setDryWet: mock(() => undefined),
    setSidechainTarget: mock(() => undefined),
    setTempo: mock(() => undefined),
    syncEffects: mock(() => undefined),
  } satisfies EffectsGraphRuntime;
}

describe("EffectsController lifecycle", () => {
  let harness: AudioEngineLifecycleHarness;
  let originalCrossOriginIsolated: PropertyDescriptor | undefined;

  beforeEach(() => {
    harness = installAudioEngineLifecycleHarness();
    originalCrossOriginIsolated = Object.getOwnPropertyDescriptor(
      globalThis,
      "crossOriginIsolated"
    );
    Object.defineProperty(globalThis, "crossOriginIsolated", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    AudioContextManager.resetForTesting();
    harness.restore();
    if (originalCrossOriginIsolated) {
      Object.defineProperty(
        globalThis,
        "crossOriginIsolated",
        originalCrossOriginIsolated
      );
    } else {
      Reflect.deleteProperty(globalThis, "crossOriginIsolated");
    }
  });

  test("registers an active compatibility-only sound as an official sidechain source", async () => {
    const context = getAudioContext();
    const sourceFilter = new TestAudioNode(context);
    const targetFilter = new TestAudioNode(context);
    const sounds = new Map([
      ["source", sound("source", sourceFilter)],
      ["target", sound("target", targetFilter)],
    ]);
    const runtime = createRuntime();
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager: (audioContext) => createManager(audioContext),
      notifyListeners: () => undefined,
      sounds,
      workletProcessorUrl: () => "/worklet.js",
    });
    const destination = new TestAudioNode(context);

    await controller.connectGraph(
      "source",
      sourceFilter as unknown as AudioNode,
      destination as unknown as AudioNode
    );
    await controller.getOrCreateWorkletManager("target");
    const compressor = createDefaultEffectConfig("compressor", "compressor", 0);
    compressor.enabled = true;
    compressor.sidechain = { channelId: "source-channel" };
    expect(controller.add("target", compressor)).toBe(true);
    controller.setSidechain("target", "source");
    await controller.connectGraph(
      "target",
      targetFilter as unknown as AudioNode,
      destination as unknown as AudioNode
    );

    expect(runtime.connectSidechainSource).toHaveBeenCalledWith(
      "source",
      sourceFilter,
      expect.any(Number)
    );
    expect(runtime.setSidechainTarget).toHaveBeenCalledWith("target", "source");
  });

  test("rebinds one physical sidechain after source graph reconstruction without duplicates", async () => {
    const context = getAudioContext();
    const sourceFilter = new TestAudioNode(context);
    const targetFilter = new TestAudioNode(context);
    const sourceInstance = sound("source", sourceFilter);
    const sounds = new Map([
      ["source", sourceInstance],
      ["target", sound("target", targetFilter)],
    ]);
    const managers: WorkletManager[] = [];
    const controller = new EffectsController({
      createWorkletManager: (audioContext) => {
        const manager = createManager(audioContext);
        managers.push(manager);
        return manager;
      },
      notifyListeners: () => undefined,
      sounds,
      workletProcessorUrl: () => "/worklet.js",
    });
    const destination = new TestAudioNode(context);
    await controller.getOrCreateWorkletManager("target");
    await controller.connectGraph(
      "source",
      sourceFilter as unknown as AudioNode,
      destination as unknown as AudioNode
    );
    controller.setSidechain("target", "source");
    const targetNode = managers[0]?.node as unknown as TestAudioNode;

    expect(sourceFilter.connections.has(targetNode)).toBe(true);
    sourceFilter.disconnect();
    await controller.connectGraph(
      "source",
      sourceFilter as unknown as AudioNode,
      destination as unknown as AudioNode
    );

    expect(sourceFilter.connections.has(targetNode)).toBe(true);
    expect(
      [...sourceFilter.connections].filter((node) => node === targetNode)
    ).toHaveLength(1);

    sourceInstance.nodes = null;
    controller.cleanupSound("source");
    expect(sourceFilter.connections.has(targetNode)).toBe(false);

    const replacementFilter = new TestAudioNode(context);
    sourceInstance.nodes = { filter: replacementFilter } as never;
    await controller.connectGraph(
      "source",
      replacementFilter as unknown as AudioNode,
      destination as unknown as AudioNode
    );

    expect(replacementFilter.connections.has(targetNode)).toBe(true);
    expect(
      [...replacementFilter.connections].filter((node) => node === targetNode)
    ).toHaveLength(1);
  });

  test("keeps compatibility audio connected until official initialization succeeds", async () => {
    const context = getAudioContext();
    const filter = new TestAudioNode(context);
    const destination = new TestAudioNode(context);
    const manager = createManager(context);
    let resolveConnection: ((connected: boolean) => void) | undefined;
    const runtime = createRuntime();
    runtime.connectSound.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConnection = resolve;
        })
    );
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager: () => manager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    await controller.getOrCreateWorkletManager("target");
    const compressor = createDefaultEffectConfig("compressor", "compressor", 0);
    compressor.enabled = true;
    controller.add("target", compressor);

    const connecting = controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      destination as unknown as AudioNode
    );
    await Promise.resolve();

    expect(
      filter.connections.has(manager.node as unknown as TestAudioNode)
    ).toBe(true);
    expect(
      (manager.outputNode as unknown as TestAudioNode).connections.has(
        destination
      )
    ).toBe(true);

    resolveConnection?.(true);
    await connecting;

    expect(
      filter.connections.has(manager.node as unknown as TestAudioNode)
    ).toBe(false);
    expect(
      (manager.outputNode as unknown as TestAudioNode).connections.has(
        destination
      )
    ).toBe(false);
  });

  test("replays queued effects and dry-wet state after creating the source", async () => {
    const context = getAudioContext();
    const filter = new TestAudioNode(context);
    const destination = new TestAudioNode(context);
    const manager = createManager(context);
    const controller = new EffectsController({
      createWorkletManager: () => manager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    controller.setDryWet("target", 0.35);
    await controller.getOrCreateWorkletManager("target");
    const distortion = createDefaultEffectConfig("distortion", "distortion", 0);
    distortion.enabled = true;

    expect(controller.add("target", distortion)).toBe(true);
    expect(manager.addEffect).not.toHaveBeenCalled();
    expect(manager.setEffectsDryWet).not.toHaveBeenCalled();

    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      destination as unknown as AudioNode
    );

    expect(manager.addEffect).toHaveBeenCalledWith(
      "target",
      distortion.id,
      distortion.type,
      expect.objectContaining({ enabled: 1 }),
      distortion.order
    );
    expect(manager.setEffectsDryWet).toHaveBeenCalledWith("target", 0.35);
  });

  test("keeps nested controller, worklet, and runtime selection in sync", async () => {
    const context = getAudioContext();
    const filter = new TestAudioNode(context);
    const destination = new TestAudioNode(context);
    const manager = createManager(context);
    const runtime = createRuntime();
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager: () => manager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    await controller.getOrCreateWorkletManager("target");
    const container = createDefaultEffectConfig("fxComposite", "container", 0);
    const limiter = createDefaultEffectConfig("limiter", "nested-limiter", 0);
    container.enabled = true;
    limiter.enabled = true;
    const firstChain = container.chains[0];
    if (!firstChain) {
      throw new Error("Composite effect requires a chain");
    }
    firstChain.effects = [limiter];
    controller.add("target", container);
    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      destination as unknown as AudioNode
    );

    expect(runtime.connectSound).not.toHaveBeenCalled();
    controller.remove("target", limiter.id);
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.removeEffect).not.toHaveBeenCalled();
    expect(manager.updateEffect).toHaveBeenCalledWith(
      "target",
      container.id,
      expect.objectContaining({ chains: expect.any(Array) })
    );
    expect(runtime.connectSound).toHaveBeenCalledTimes(1);
    expect(runtime.syncEffects).toHaveBeenLastCalledWith(
      "target",
      expect.arrayContaining([
        expect.objectContaining({ id: container.id, type: "fxComposite" }),
      ])
    );

    controller.update("target", container.id, container.type, {
      chains: container.chains,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.connectSidechainSource).toHaveBeenCalledWith(
      "target",
      filter,
      expect.any(Number)
    );
  });

  test("silences the official route on stop and reconnects it on replay", async () => {
    const context = getAudioContext();
    const filter = new TestAudioNode(context);
    const destination = new TestAudioNode(context);
    const manager = createManager(context);
    const runtime = createRuntime();
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager: () => manager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    await controller.getOrCreateWorkletManager("target");
    const reverb = createDefaultEffectConfig("plateReverb", "reverb", 0);
    reverb.enabled = true;
    controller.add("target", reverb);
    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      destination as unknown as AudioNode
    );

    controller.stopSource("target");

    expect(manager.stopSource).toHaveBeenCalledWith("target");
    expect(runtime.disconnectSound).toHaveBeenCalledWith(
      "target",
      expect.any(Number)
    );

    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      destination as unknown as AudioNode
    );

    expect(runtime.connectSound).toHaveBeenCalledTimes(2);
    expect(
      filter.connections.has(manager.node as unknown as TestAudioNode)
    ).toBe(false);
  });

  test("silences the official route on pause and restores it on resume", async () => {
    const context = getAudioContext();
    const filter = new TestAudioNode(context);
    const destination = new TestAudioNode(context);
    const manager = createManager(context);
    const runtime = createRuntime();
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager: () => manager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    await controller.getOrCreateWorkletManager("target");
    const reverb = createDefaultEffectConfig("plateReverb", "reverb", 0);
    reverb.enabled = true;
    controller.add("target", reverb);
    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      destination as unknown as AudioNode
    );

    controller.pauseSource("target");

    expect(manager.pauseSource).toHaveBeenCalledWith("target");
    expect(runtime.disconnectSound).toHaveBeenCalledWith(
      "target",
      expect.any(Number)
    );
    expect(runtime.deleteSound).not.toHaveBeenCalled();
    expect(
      filter.connections.has(manager.node as unknown as TestAudioNode)
    ).toBe(false);

    controller.resumeSource("target");
    expect(
      filter.connections.has(manager.node as unknown as TestAudioNode)
    ).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.resumeSource).toHaveBeenCalledWith("target");
    expect(runtime.connectSound).toHaveBeenCalledTimes(2);
    expect(
      filter.connections.has(manager.node as unknown as TestAudioNode)
    ).toBe(false);
  });

  test("stop cancels an in-flight official connection", async () => {
    const context = getAudioContext();
    const filter = new TestAudioNode(context);
    const manager = createManager(context);
    let resolveConnection: ((connected: boolean) => void) | undefined;
    const runtime = createRuntime();
    runtime.connectSound.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConnection = resolve;
        })
    );
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager: () => manager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    await controller.getOrCreateWorkletManager("target");
    const reverb = createDefaultEffectConfig("plateReverb", "reverb", 0);
    reverb.enabled = true;
    controller.add("target", reverb);
    const connecting = controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    await Promise.resolve();

    controller.stopSource("target");
    resolveConnection?.(true);
    await connecting;

    expect(runtime.disconnectSound).toHaveBeenCalledTimes(1);
    expect(runtime.syncEffects).not.toHaveBeenCalled();
  });

  test("stale official initialization cannot register a cleaned-up sound", async () => {
    const context = getAudioContext();
    const filter = new TestAudioNode(context);
    const sounds = new Map([["target", sound("target", filter)]]);
    let resolveConnection: ((connected: boolean) => void) | undefined;
    const runtime = createRuntime();
    runtime.connectSound.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConnection = resolve;
        })
    );
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager: (audioContext) => createManager(audioContext),
      notifyListeners: () => undefined,
      sounds,
      workletProcessorUrl: () => "/worklet.js",
    });
    await controller.getOrCreateWorkletManager("target");
    const compressor = createDefaultEffectConfig("compressor", "compressor", 0);
    compressor.enabled = true;
    controller.add("target", compressor);
    const connecting = controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );

    await Promise.resolve();
    controller.cleanupSound("target");
    resolveConnection?.(true);
    await connecting;

    expect(runtime.deleteSound).toHaveBeenCalledTimes(1);
    expect(runtime.syncEffects).not.toHaveBeenCalled();
    expect(runtime.connectSidechainSource).not.toHaveBeenCalled();
  });

  test("does not register a pending official connection as a compatibility sidechain", async () => {
    const context = getAudioContext();
    const firstFilter = new TestAudioNode(context);
    const secondFilter = new TestAudioNode(context);
    const destination = new TestAudioNode(context);
    const connections = new Map<string, (connected: boolean) => void>();
    const runtime = createRuntime();
    runtime.connectSound.mockImplementation(
      (soundId) =>
        new Promise<boolean>((resolve) => {
          connections.set(soundId, resolve);
        })
    );
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager: (audioContext) => createManager(audioContext),
      notifyListeners: () => undefined,
      sounds: new Map([
        ["first", sound("first", firstFilter)],
        ["second", sound("second", secondFilter)],
      ]),
      workletProcessorUrl: () => "/worklet.js",
    });
    for (const soundId of ["first", "second"]) {
      await controller.getOrCreateWorkletManager(soundId);
      const reverb = createDefaultEffectConfig(
        "plateReverb",
        `${soundId}-reverb`,
        0
      );
      reverb.enabled = true;
      controller.add(soundId, reverb);
    }

    const firstConnection = controller.connectGraph(
      "first",
      firstFilter as unknown as AudioNode,
      destination as unknown as AudioNode
    );
    const secondConnection = controller.connectGraph(
      "second",
      secondFilter as unknown as AudioNode,
      destination as unknown as AudioNode
    );
    await Promise.resolve();
    connections.get("first")?.(true);
    await firstConnection;

    expect(runtime.connectSidechainSource).not.toHaveBeenCalledWith(
      "second",
      secondFilter,
      expect.any(Number)
    );

    connections.get("second")?.(true);
    await secondConnection;
  });
});
