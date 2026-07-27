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
import type { OfficialOpenDawRuntime } from "./official-opendaw-runtime";

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
    connectSound: mock(() => Promise.resolve(true)),
    deleteSound: mock(() => undefined),
    setDryWet: mock(() => undefined),
    setSidechainTarget: mock(() => undefined),
    setTempo: mock(() => undefined),
    syncEffects: mock(() => undefined),
  };
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
      createOfficialRuntime: () => runtime as unknown as OfficialOpenDawRuntime,
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
      createOfficialRuntime: () => runtime as unknown as OfficialOpenDawRuntime,
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

  test("keeps nested controller, worklet, and runtime selection in sync", async () => {
    const context = getAudioContext();
    const filter = new TestAudioNode(context);
    const destination = new TestAudioNode(context);
    const manager = createManager(context);
    const runtime = createRuntime();
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime as unknown as OfficialOpenDawRuntime,
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
      createOfficialRuntime: () => runtime as unknown as OfficialOpenDawRuntime,
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
});
