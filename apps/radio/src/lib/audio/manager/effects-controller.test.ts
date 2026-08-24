import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { DesiredEffectsState } from "../../channel-effects.js";
import { createDefaultEffectConfig } from "../dsp/effects/registry.js";
import type { WorkletManager } from "../playback/index.js";
import type { SoundInstance } from "./audio-manager-types.js";
import { EffectsController } from "./effects-controller.js";
import type { EffectsGraphRuntime } from "./effects-graph-runtime.js";

class TestAudioParam {
  value = 0;

  cancelAndHoldAtTime(_time: number): void {
    // Test ramps settle synchronously.
  }
  cancelScheduledValues(_time: number): void {
    // Test ramps settle synchronously.
  }
  linearRampToValueAtTime(value: number, _time: number): void {
    this.value = value;
  }
  setValueAtTime(value: number, _time: number): void {
    this.value = value;
  }
}

class TestAudioNode {
  readonly connections = new Set<TestAudioNode>();
  readonly context: TestAudioContext;

  constructor(context: TestAudioContext) {
    this.context = context;
  }

  connect(destination: TestAudioNode): TestAudioNode {
    this.connections.add(destination);
    return destination;
  }

  disconnect(destination?: TestAudioNode): void {
    if (destination) {
      this.connections.delete(destination);
      return;
    }
    this.connections.clear();
  }
}

class TestGainNode extends TestAudioNode {
  readonly gain = new TestAudioParam();
}

class TestConstantSourceNode extends TestAudioNode {
  onended: (() => void) | null = null;

  start(): void {
    // Test sources start synchronously.
  }

  stop(): void {
    this.onended?.();
  }
}

class TestAudioContext {
  currentTime = 0;

  createConstantSource(): ConstantSourceNode {
    return new TestConstantSourceNode(this) as unknown as ConstantSourceNode;
  }

  createGain(): GainNode {
    return new TestGainNode(this) as unknown as GainNode;
  }
}

function createManager(context: TestAudioContext) {
  return {
    addEffect: mock(() => undefined),
    cleanup: mock(() => undefined),
    createStreamSource: mock(() => undefined),
    init: mock(() => Promise.resolve()),
    node: new TestAudioNode(context) as unknown as AudioWorkletNode,
    on: mock(() => undefined),
    outputNode: new TestAudioNode(context) as unknown as GainNode,
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
    connectSidechainSource: mock(
      (_soundId: string, _source: AudioNode, _generation?: number) =>
        Promise.resolve(true)
    ),
    connectSound: mock(
      (
        _soundId: string,
        _source: AudioNode,
        _destination: AudioNode,
        _generation?: number
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

let originalCrossOriginIsolated: PropertyDescriptor | undefined;

beforeEach(() => {
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
  if (originalCrossOriginIsolated) {
    Object.defineProperty(
      globalThis,
      "crossOriginIsolated",
      originalCrossOriginIsolated
    );
    return;
  }
  Reflect.deleteProperty(globalThis, "crossOriginIsolated");
});

describe("EffectsController", () => {
  test("reconciles one desired snapshot when the graph becomes ready", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const destination = new TestAudioNode(context);
    const manager = createManager(context);
    const controller = new EffectsController({
      createWorkletManager: () => manager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const distortion = createDefaultEffectConfig("distortion", "distortion", 0);
    distortion.enabled = true;
    const desired: DesiredEffectsState = {
      tree: [distortion],
      dryWet: 0.4,
      sidechainSoundId: null,
      tempo: 128,
    };

    expect(await controller.reconcile("target", desired)).toEqual({
      backend: null,
      ready: false,
      status: "inactive",
    });
    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      destination as unknown as AudioNode
    );

    expect(controller.getRuntimeOutcome("target")).toEqual({
      backend: "compatibility",
      ready: true,
      status: "ready",
    });
    expect(manager.addEffect).toHaveBeenCalledWith(
      "target",
      "distortion",
      "distortion",
      expect.objectContaining({ enabled: 1 }),
      0
    );
    expect(manager.setEffectsDryWet).toHaveBeenCalledWith("target", 0.4);
    expect(manager.setTempo).toHaveBeenCalledWith("target", 128);
  });

  test("connects a dry graph without creating an effects runtime", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const createOfficialRuntime = mock(() => createRuntime());
    const createWorkletManager = mock(() => createManager(context));
    const controller = new EffectsController({
      createOfficialRuntime,
      createWorkletManager,
      notifyListeners: () => undefined,
      sounds: new Map([["dry", sound("dry", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });

    expect(
      await controller.connectGraph(
        "dry",
        filter as unknown as AudioNode,
        new TestAudioNode(context) as unknown as AudioNode
      )
    ).toBe(true);
    expect(createOfficialRuntime).not.toHaveBeenCalled();
    expect(createWorkletManager).not.toHaveBeenCalled();
    expect(controller.getRuntimeOutcome("dry")).toEqual({
      backend: "bypass",
      ready: true,
      status: "ready",
    });
  });

  test("selects the official adapter for an official desired tree", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const runtime = createRuntime();
    const createWorkletManager = mock(() => createManager(context));
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const reverb = createDefaultEffectConfig("plateReverb", "reverb", 0);
    reverb.enabled = true;
    await controller.reconcile("target", {
      tree: [reverb],
      dryWet: 0.7,
      sidechainSoundId: null,
      tempo: 124,
    });

    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );

    expect(controller.getRuntimeOutcome("target")).toEqual({
      backend: "official",
      ready: true,
      status: "ready",
    });
    expect(createWorkletManager).not.toHaveBeenCalled();
  });

  test("falls back to compatibility with the same desired tree", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const runtime = createRuntime();
    runtime.connectSound.mockRejectedValue(new Error("official unavailable"));
    const manager = createManager(context);
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager: () => manager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const reverb = createDefaultEffectConfig("plateReverb", "reverb", 0);
    reverb.enabled = true;
    await controller.reconcile("target", {
      tree: [reverb],
      dryWet: 0.7,
      sidechainSoundId: null,
      tempo: 124,
    });

    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );

    expect(controller.getRuntimeOutcome("target")).toEqual({
      backend: "compatibility",
      ready: true,
      status: "ready",
    });
    expect(manager.addEffect).toHaveBeenCalledWith(
      "target",
      "reverb",
      "plateReverb",
      expect.objectContaining({ enabled: 1 }),
      0
    );
  });

  test("switches an active official graph to compatibility from one snapshot", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const runtime = createRuntime();
    const manager = createManager(context);
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager: () => manager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const reverb = createDefaultEffectConfig("plateReverb", "reverb", 0);
    reverb.enabled = true;
    await controller.reconcile("target", {
      tree: [reverb],
      dryWet: 1,
      sidechainSoundId: null,
      tempo: 120,
    });
    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    const distortion = createDefaultEffectConfig("distortion", "distortion", 0);
    distortion.enabled = true;

    const outcome = await controller.reconcile("target", {
      tree: [distortion],
      dryWet: 1,
      sidechainSoundId: null,
      tempo: 120,
    });

    expect(outcome).toEqual({
      backend: "compatibility",
      ready: true,
      status: "ready",
    });
    expect(manager.addEffect).toHaveBeenCalledWith(
      "target",
      "distortion",
      "distortion",
      expect.objectContaining({ enabled: 1 }),
      0
    );
  });

  test("replaying an unchanged desired tree is idempotent", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const manager = createManager(context);
    const controller = new EffectsController({
      createWorkletManager: () => manager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const distortion = createDefaultEffectConfig("distortion", "distortion", 0);
    distortion.enabled = true;
    const desired: DesiredEffectsState = {
      tree: [distortion],
      dryWet: 1,
      sidechainSoundId: null,
      tempo: 120,
    };
    await controller.reconcile("target", desired);
    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );

    await controller.reconcile("target", desired);

    expect(manager.addEffect).toHaveBeenCalledTimes(1);
    expect(controller.getRuntimeOutcome("target")).toEqual({
      backend: "compatibility",
      ready: true,
      status: "ready",
    });
  });

  test("creates compatibility processing through the supplied runtime factory", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const destination = new TestAudioNode(context);
    const manager = createManager(context);
    const createWorkletManager = mock(() => manager);
    const controller = new EffectsController({
      createWorkletManager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const distortion = createDefaultEffectConfig("distortion", "distortion", 0);
    distortion.enabled = true;
    controller.add("target", distortion);

    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      destination as unknown as AudioNode
    );

    expect(createWorkletManager).toHaveBeenCalledWith(context, "/worklet.js");
    expect(manager.createStreamSource).toHaveBeenCalledWith("target");
    expect(manager.addEffect).toHaveBeenCalledWith(
      "target",
      "distortion",
      "distortion",
      expect.objectContaining({ enabled: 1 }),
      0
    );
  });

  test("stop cancels an in-flight official connection", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const runtime = createRuntime();
    let resolveConnection: ((connected: boolean) => void) | undefined;
    runtime.connectSound.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConnection = resolve;
        })
    );
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager: () => createManager(context),
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
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

    expect(runtime.deleteSound).toHaveBeenCalledTimes(1);
    expect(runtime.syncEffects).not.toHaveBeenCalled();
  });

  test("a stale rejected connection cannot delete its graph replacement", async () => {
    const context = new TestAudioContext();
    const originalFilter = new TestAudioNode(context);
    const replacementFilter = new TestAudioNode(context);
    const target = sound("target", originalFilter);
    const pendingConnections: Array<{
      reject: (reason: unknown) => void;
      resolve: (connected: boolean) => void;
    }> = [];
    const runtime = createRuntime();
    runtime.connectSound.mockImplementation(
      () =>
        new Promise<boolean>((resolve, reject) => {
          pendingConnections.push({ reject, resolve });
        })
    );
    const createWorkletManager = mock(() => createManager(context));
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", target]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const reverb = createDefaultEffectConfig("plateReverb", "reverb", 0);
    reverb.enabled = true;
    controller.add("target", reverb);
    const destination = new TestAudioNode(context);
    const originalConnection = controller.connectGraph(
      "target",
      originalFilter as unknown as AudioNode,
      destination as unknown as AudioNode
    );
    await Promise.resolve();

    target.nodes = { filter: replacementFilter } as never;
    const replacementConnection = controller.connectGraph(
      "target",
      replacementFilter as unknown as AudioNode,
      destination as unknown as AudioNode
    );
    await Promise.resolve();

    pendingConnections[1]?.resolve(true);
    await replacementConnection;
    pendingConnections[0]?.reject(new Error("stale connection failed"));
    await originalConnection;

    expect(runtime.deleteSound).not.toHaveBeenCalled();
    expect(runtime.syncEffects).toHaveBeenCalledTimes(1);
    expect(runtime.connectSound).toHaveBeenNthCalledWith(
      2,
      "target",
      replacementFilter,
      expect.anything(),
      expect.any(Number)
    );
    expect(controller.getRuntimeOutcome("target")).toEqual({
      backend: "official",
      ready: true,
      status: "ready",
    });
  });

  test("cleanup prevents an in-flight official connection from registering", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const runtime = createRuntime();
    let resolveConnection: ((connected: boolean) => void) | undefined;
    runtime.connectSound.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConnection = resolve;
        })
    );
    const createWorkletManager = mock(() => createManager(context));
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
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
    expect(createWorkletManager).not.toHaveBeenCalled();
  });

  test("keeps one owned graph while an effect edit supersedes runtime selection", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const runtime = createRuntime();
    const pendingConnections: Array<(connected: boolean) => void> = [];
    runtime.connectSound.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          pendingConnections.push(resolve);
        })
    );
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager: () => createManager(context),
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const reverb = createDefaultEffectConfig("plateReverb", "reverb", 0);
    reverb.enabled = true;
    controller.add("target", reverb);
    const connecting = controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    await Promise.resolve();

    controller.update("target", reverb.id, reverb.type, { decay: 0.7 });
    await Promise.resolve();
    pendingConnections[0]?.(true);

    expect(await connecting).toBe(true);
    expect(filter.connections).toHaveLength(1);

    pendingConnections[1]?.(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.syncEffects).toHaveBeenCalledTimes(1);
  });
});
