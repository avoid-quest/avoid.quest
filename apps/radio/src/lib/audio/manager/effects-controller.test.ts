import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  DesiredEffectsState,
  EffectsRuntimeOutcome,
} from "../../channel-effects.js";
import { createDefaultEffectConfig } from "../dsp/effects/registry.js";
import type { EffectConfig } from "../dsp/effects/types.js";
import type { WorkletManager } from "../playback/index.js";
import type { AudioManager } from "./audio-manager.js";
import type { SoundInstance } from "./audio-manager-types.js";
import { EffectsController } from "./effects-controller.js";
import type {
  EffectsGraphRuntime,
  EffectWriteResult,
  OfficialSoundSettings,
} from "./effects-graph-runtime.js";

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
    nodes: { filter },
    sourceId: soundId,
  } as unknown as SoundInstance;
}

function createRuntime() {
  const performanceSnapshot = {
    backend: "official" as const,
    monitoringChannelCount: 2,
    soundCount: 1,
    workletCount: 1 as const,
  };
  return {
    cleanup: mock(() => undefined),
    connectSidechainSource: mock(
      (
        _soundId: string,
        _source: AudioNode,
        _generation?: number,
        _inputChannels?: 1 | 2
      ) => Promise.resolve(true)
    ),
    connectSound: mock(
      (
        _soundId: string,
        _source: AudioNode,
        _destination: AudioNode,
        _generation?: number,
        _inputChannels?: 1 | 2,
        _settings?: OfficialSoundSettings
      ) => Promise.resolve(true)
    ),
    deleteSound: mock((_soundId: string) => undefined),
    disconnectSound: mock(() => undefined),
    getPerformanceSnapshot: mock(() => performanceSnapshot),
    setSidechainTarget: mock(() => undefined),
    syncEffects: mock(
      (
        _soundId: string,
        _effects: readonly import("../dsp/effects/types.js").EffectConfig[]
      ) => undefined
    ),
    writeEffect: mock(
      (
        _soundId: string,
        _effectId: string,
        _config: import("../dsp/effects/types.js").EffectConfig
      ) => "applied" as const
    ),
  } satisfies EffectsGraphRuntime;
}

function desiredEffects(
  tree: DesiredEffectsState["tree"],
  overrides: Partial<Omit<DesiredEffectsState, "tree">> = {}
): DesiredEffectsState {
  return {
    dryWet: 1,
    sidechainSoundId: null,
    tempo: 120,
    tree,
    ...overrides,
  };
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
  test("a shared graph unit's insert runs without creating a playback sound", async () => {
    const context = new TestAudioContext();
    const runtime = createRuntime();
    const sounds = new Map<string, SoundInstance>();
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      notifyListeners: () => undefined,
      sounds,
      workletProcessorUrl: () => "/worklet.js",
    });
    const input = new TestAudioNode(context) as unknown as AudioNode;
    const output = new TestAudioNode(context) as unknown as AudioNode;
    const effect = {
      ...createDefaultEffectConfig("compressor", "fx", 0),
      enabled: true,
    };

    const outcome = await controller.attachInsert(
      "unit",
      input,
      output,
      desiredEffects([effect])
    );

    expect(sounds.size).toBe(0);
    expect(outcome.backend).toBe("official");
    expect(runtime.connectSound.mock.calls[0]?.[0]).toBe("unit");
    expect(runtime.connectSound.mock.calls[0]?.[5]?.effects).toEqual([effect]);
    // It reconciles like a sound's effects, until it is detached.
    const edited = { ...effect, threshold: -30 };
    expect(
      (await controller.reconcile("unit", desiredEffects([edited]))).status
    ).toBe("ready");
    controller.detachInsert("unit");
    expect(runtime.deleteSound).toHaveBeenCalled();
    expect(
      (await controller.reconcile("unit", desiredEffects([effect]))).status
    ).toBe("failed");
  });

  test("a compatibility runtime error on an insert fails its outcome", async () => {
    Object.defineProperty(globalThis, "crossOriginIsolated", {
      configurable: true,
      value: false,
    });
    const context = new TestAudioContext();
    const manager = createManager(context);
    const handlers = new Map<string, (payload: unknown) => void>();
    Object.assign(manager, {
      on: (event: string, handler: (payload: unknown) => void) => {
        handlers.set(event, handler);
      },
    });
    const controller = new EffectsController({
      createOfficialRuntime: () => createRuntime(),
      createWorkletManager: () => manager,
      notifyListeners: () => undefined,
      sounds: new Map(),
      workletProcessorUrl: () => "/worklet.js",
    });
    const outcomes: EffectsRuntimeOutcome[] = [];
    controller.subscribeRuntimeOutcome("unit", (outcome) => {
      outcomes.push(outcome);
    });
    const effect = {
      ...createDefaultEffectConfig("compressor", "fx", 0),
      enabled: true,
    };
    const attached = await controller.attachInsert(
      "unit",
      new TestAudioNode(context) as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode,
      desiredEffects([effect])
    );
    expect(attached.backend).toBe("compatibility");

    handlers.get("sourceError")?.({
      code: "EFFECT_INIT_FAILED",
      effectId: "fx",
      error: "Could not start",
      id: "err-1",
      sourceId: "unit",
      timestamp: 1,
    });

    expect(outcomes.at(-1)).toMatchObject({
      backend: "compatibility",
      error: new Error("[fx] Could not start"),
      status: "failed",
    });
    expect(controller.getRuntimeOutcome("unit").status).toBe("failed");
  });

  test("an insert detached before its runtime settles leaves nothing connected", async () => {
    const context = new TestAudioContext();
    const runtime = createRuntime();
    const connected = Promise.withResolvers<boolean>();
    runtime.connectSound.mockImplementation(() => connected.promise);
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      notifyListeners: () => undefined,
      sounds: new Map(),
      workletProcessorUrl: () => "/worklet.js",
    });
    const input = new TestAudioNode(context);
    const output = new TestAudioNode(context);
    const effect = {
      ...createDefaultEffectConfig("compressor", "fx", 0),
      enabled: true,
    };

    const pending = controller.attachInsert(
      "removed",
      input as unknown as AudioNode,
      output as unknown as AudioNode,
      desiredEffects([effect])
    );
    controller.detachInsert("removed");
    connected.resolve(true);
    await pending;

    expect(input.connections.size).toBe(0);
    expect(runtime.deleteSound).toHaveBeenCalled();
    expect(controller.getRuntimeOutcome("removed").status).toBe("inactive");
  });

  test("exposes openDAW performance data without exposing its Project", () => {
    const runtime = createRuntime();
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      notifyListeners: () => undefined,
      sounds: new Map(),
      workletProcessorUrl: () => "/worklet.js",
    });
    Object.assign(controller as object, { officialRuntime: runtime });

    expect(controller.getPerformanceSnapshot()).toBe(
      runtime.getPerformanceSnapshot()
    );
  });

  test.each([true, false])(
    "direct knobs keep the selected backend (official=%s)",
    async (official) => {
      Object.defineProperty(globalThis, "crossOriginIsolated", {
        configurable: true,
        value: official,
      });
      const context = new TestAudioContext();
      const source = new TestAudioNode(context);
      const destination = new TestAudioNode(context);
      const runtime = createRuntime();
      let liveThreshold = 0;
      runtime.writeEffect.mockImplementation((_soundId, _effectId, written) => {
        if (written.type === "compressor") {
          liveThreshold = written.threshold;
        }
        return "applied";
      });
      const manager = createManager(context);
      const controller = new EffectsController({
        createOfficialRuntime: () => runtime,
        createWorkletManager: () => manager,
        notifyListeners: () => undefined,
        sounds: new Map([["lane", sound("lane", source)]]),
        workletProcessorUrl: () => "/worklet.js",
      });
      const config = {
        ...createDefaultEffectConfig("compressor", "comp", 0),
        enabled: true,
      };
      await controller.reconcile("lane", desiredEffects([config]));
      await controller.connectGraph(
        "lane",
        source as unknown as AudioNode,
        destination as unknown as AudioNode
      );
      const connections = [...source.connections];
      const edited = { ...config, threshold: -23 };
      expect(controller.setEffectFields("lane", config.id, edited)).toBe(
        official ? "applied" : "structural"
      );
      if (!official) {
        await controller.reconcile("lane", desiredEffects([edited]));
      }
      expect(controller.getRuntimeOutcome("lane").backend).toBe(
        official ? "official" : "compatibility"
      );
      expect([...source.connections]).toEqual(connections);
      if (official) {
        expect(liveThreshold).toBe(-23);
      } else {
        expect(manager.updateEffect).toHaveBeenCalledWith(
          "lane",
          config.id,
          expect.objectContaining({ threshold: -23 })
        );
      }
      controller.cleanup();
    }
  );

  test.each(["throw", "unavailable"] as const)(
    "a container edit keeps its failed descendant pending (%s)",
    async (failure) => {
      const context = new TestAudioContext();
      const source = new TestAudioNode(context);
      const destination = new TestAudioNode(context);
      const child = {
        ...createDefaultEffectConfig("compressor", "comp", 0),
        enabled: true,
      };
      const container = {
        ...createDefaultEffectConfig("fxComposite", "bus", 0),
        enabled: true,
      };
      container.chains[0].effects = [child];
      let liveGain = container.chains[0].gain;
      let liveThreshold = child.threshold;
      const runtime = {
        ...createRuntime(),
        writeEffect: mock(
          (
            _soundId: string,
            _effectId: string,
            config: EffectConfig
          ): EffectWriteResult => {
            if (config.type === "fxComposite") {
              liveGain = config.chains[0].gain;
              return "applied";
            }
            if (failure === "throw") {
              throw new Error("Descendant write failed");
            }
            return "unavailable";
          }
        ),
      };
      const applyEffects = (effects: readonly EffectConfig[]): undefined => {
        const [parent] = effects;
        if (parent.type === "fxComposite") {
          liveGain = parent.chains[0].gain;
          const [compressor] = parent.chains[0].effects;
          if (compressor.type === "compressor") {
            liveThreshold = compressor.threshold;
          }
        }
      };
      runtime.syncEffects.mockImplementation((_soundId, effects) =>
        applyEffects(effects)
      );
      runtime.connectSound.mockImplementation(
        (_soundId, _source, _destination, _generation, _channels, settings) => {
          if (settings) {
            applyEffects(settings.effects);
          }
          return Promise.resolve(true);
        }
      );
      const controller = new EffectsController({
        createOfficialRuntime: () => runtime,
        createWorkletManager: () => createManager(context),
        notifyListeners: () => undefined,
        sounds: new Map([["lane", sound("lane", source)]]),
        workletProcessorUrl: () => "/worklet.js",
      });
      try {
        await controller.reconcile("lane", desiredEffects([container]));
        await controller.connectGraph(
          "lane",
          source as unknown as AudioNode,
          destination as unknown as AudioNode
        );
        const editedChild = { ...child, threshold: -23 };
        const edited = {
          ...container,
          chains: [
            { ...container.chains[0], effects: [editedChild], gain: 0.5 },
          ],
        };
        expect(controller.setEffectFields("lane", container.id, edited)).toBe(
          "applied"
        );
        if (failure === "throw") {
          expect(() =>
            controller.setEffectFields("lane", child.id, editedChild)
          ).toThrow("Descendant write failed");
        } else {
          expect(
            controller.setEffectFields("lane", child.id, editedChild)
          ).toBe("unavailable");
        }
        expect(liveGain).toBe(0.5);
        expect(liveThreshold).toBe(child.threshold);
        await controller.reconcile("lane", desiredEffects([edited]));
        expect(liveGain).toBe(0.5);
        expect(liveThreshold).toBe(-23);
      } finally {
        controller.cleanup();
      }
    }
  );

  test("knobs on a disabled Radio-only effect keep the official lane and its authored state", async () => {
    const context = new TestAudioContext();
    const source = new TestAudioNode(context);
    const runtime = createRuntime();
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      notifyListeners: () => undefined,
      sounds: new Map([["lane", sound("lane", source)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const comp = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      enabled: true,
    };
    const distortion = {
      ...createDefaultEffectConfig("distortion", "dist", 1),
      enabled: false,
    };
    await controller.reconcile("lane", desiredEffects([comp, distortion]));
    await controller.connectGraph(
      "lane",
      source as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    runtime.writeEffect.mockImplementation(() => {
      throw new Error(
        "No official device exists for the disabled Radio-only effect"
      );
    });
    const edited = { ...distortion, amount: 0.9 };
    expect(await controller.setEffectFields("lane", edited.id, edited)).toBe(
      "applied"
    );
    runtime.connectSound.mockImplementation(() => {
      throw new Error("The selected backend must survive this knob");
    });
    expect(
      (await controller.reconcile("lane", desiredEffects([comp, edited])))
        .backend
    ).toBe("official");
    controller.cleanup();
  });

  test("a knob edited during connection becomes the connected authored value", async () => {
    const context = new TestAudioContext();
    const source = new TestAudioNode(context);
    const runtime = createRuntime();
    const connecting = Promise.withResolvers<boolean>();
    runtime.connectSound.mockImplementation(() => connecting.promise);
    let connectedEffects: readonly import("../dsp/effects/types.js").EffectConfig[] =
      [];
    runtime.syncEffects.mockImplementation((_soundId, effects) => {
      connectedEffects = effects;
    });
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      notifyListeners: () => undefined,
      sounds: new Map([["lane", sound("lane", source)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const config = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      enabled: true,
    };
    await controller.reconcile("lane", desiredEffects([config]));
    const connected = controller.connectGraph(
      "lane",
      source as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    expect(
      await controller.setEffectFields("lane", config.id, {
        ...config,
        threshold: -27,
      })
    ).toBe("applied");
    connecting.resolve(true);
    await connected;
    expect(connectedEffects).toEqual([{ ...config, threshold: -27 }]);
    expect(controller.getRuntimeOutcome("lane").backend).toBe("official");
    controller.cleanup();
  });

  test("publishes readiness once connected, and transient writes stay unauthored", async () => {
    const context = new TestAudioContext();
    const source = new TestAudioNode(context);
    const runtime = createRuntime();
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      notifyListeners: () => undefined,
      sounds: new Map([["lane", sound("lane", source)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const config = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      enabled: true,
    };
    await controller.reconcile("lane", desiredEffects([config]));
    await controller.connectGraph(
      "lane",
      source as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    controller.pauseSource("lane");
    const connecting = Promise.withResolvers<boolean>();
    let liveThreshold = config.threshold;
    let connected: readonly import("../dsp/effects/types.js").EffectConfig[] =
      [];
    runtime.connectSound.mockImplementation(
      (_id, _source, _destination, _generation, _channels, settings) => {
        connected = settings?.effects ?? [];
        liveThreshold = config.threshold;
        return connecting.promise;
      }
    );
    runtime.writeEffect.mockImplementation((_id, _effectId, written) => {
      if (written.type === "compressor") {
        liveThreshold = written.threshold;
      }
      return "applied";
    });
    const ready = Promise.withResolvers<void>();
    const unsubscribe = controller.subscribeRuntimeOutcome(
      "lane",
      (outcome) => {
        if (outcome.backend === "official" && outcome.ready) {
          controller.setEffectFields(
            "lane",
            config.id,
            { ...config, threshold: -12 },
            true
          );
          ready.resolve();
        }
      }
    );
    controller.resumeSource("lane");
    expect(liveThreshold).toBe(config.threshold);
    connecting.resolve(true);
    await ready.promise;
    expect(liveThreshold).toBe(-12);
    // The next connection still receives the authored compressor value.
    controller.resumeSource("lane");
    expect(connected).toEqual([config]);
    unsubscribe();
    controller.cleanup();
  });

  test("a throwing outcome listener leaves the backend and other listeners working", async () => {
    const context = new TestAudioContext();
    const source = new TestAudioNode(context);
    const controller = new EffectsController({
      createOfficialRuntime: () => createRuntime(),
      notifyListeners: () => undefined,
      sounds: new Map([["lane", sound("lane", source)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const config = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      enabled: true,
    };
    await controller.reconcile("lane", desiredEffects([config]));
    await controller.connectGraph(
      "lane",
      source as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    const unsubscribeFailed = controller.subscribeRuntimeOutcome("lane", () => {
      throw new Error("Overlay listener failed");
    });
    const observed: string[] = [];
    const unsubscribeHealthy = controller.subscribeRuntimeOutcome(
      "lane",
      (outcome) => {
        if (outcome.ready && outcome.backend) {
          observed.push(outcome.backend);
        }
      }
    );
    try {
      const outcome = await controller.reconcile(
        "lane",
        desiredEffects([{ ...config, threshold: -27 }])
      );
      expect(outcome).toEqual({
        backend: "official",
        ready: true,
        status: "ready",
      });
      expect(controller.getRuntimeOutcome("lane")).toEqual(outcome);
      expect(observed).toEqual(["official"]);
    } finally {
      unsubscribeFailed();
      unsubscribeHealthy();
      controller.cleanup();
    }
  });

  test("runtime outcome subscriptions survive sound cleanup until unsubscribed", async () => {
    const context = new TestAudioContext();
    const source = new TestAudioNode(context);
    const controller = new EffectsController({
      createOfficialRuntime: () => createRuntime(),
      notifyListeners: () => undefined,
      sounds: new Map([["lane", sound("lane", source)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const config = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      enabled: true,
    };
    const ready: string[] = [];
    const unsubscribe = controller.subscribeRuntimeOutcome(
      "lane",
      (outcome) => {
        if (outcome.ready && outcome.backend) {
          ready.push(outcome.backend);
        }
      }
    );
    const connect = async () => {
      await controller.reconcile("lane", desiredEffects([config]));
      await controller.connectGraph(
        "lane",
        source as unknown as AudioNode,
        new TestAudioNode(context) as unknown as AudioNode
      );
    };
    await connect();
    controller.cleanupSound("lane");
    await connect();
    expect(ready).toEqual(["official", "official"]);
    unsubscribe();
    controller.cleanupSound("lane");
    await connect();
    expect(ready).toEqual(["official", "official"]);
    controller.cleanup();
  });

  test("a knob edited while the key source registers reaches the connected runtime", async () => {
    const context = new TestAudioContext();
    const source = new TestAudioNode(context);
    const key = new TestAudioNode(context);
    const runtime = createRuntime();
    const registering = Promise.withResolvers<void>();
    const registered = Promise.withResolvers<boolean>();
    let liveThreshold = 0;
    const apply = (effects: DesiredEffectsState["tree"]) => {
      const config = effects.find((effect) => effect.type === "compressor");
      if (config?.type === "compressor") {
        liveThreshold = config.threshold;
      }
    };
    runtime.connectSound.mockImplementation(
      (_id, _source, _destination, _generation, _channels, settings) => {
        apply(settings?.effects ?? []);
        return Promise.resolve(true);
      }
    );
    runtime.syncEffects.mockImplementation((_id, effects) => {
      apply(effects);
    });
    runtime.writeEffect.mockImplementation((_id, _effectId, written) => {
      apply([written]);
      return "applied";
    });
    runtime.connectSidechainSource.mockImplementation(() => {
      registering.resolve();
      return registered.promise;
    });
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      notifyListeners: () => undefined,
      sounds: new Map([
        ["lane", sound("lane", source)],
        ["key", sound("key", key)],
      ]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const destination = new TestAudioNode(context) as unknown as AudioNode;
    await controller.connectGraph(
      "key",
      key as unknown as AudioNode,
      destination
    );
    const config = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      enabled: true,
    };
    await controller.reconcile(
      "lane",
      desiredEffects([config], { sidechainSoundId: "key" })
    );
    const connected = controller.connectGraph(
      "lane",
      source as unknown as AudioNode,
      destination
    );
    await registering.promise;
    expect(
      controller.setEffectFields("lane", config.id, {
        ...config,
        threshold: -27,
      })
    ).toBe("applied");
    registered.resolve(true);
    await connected;
    expect(liveThreshold).toBe(-27);
    expect(controller.getRuntimeOutcome("lane").backend).toBe("official");
    controller.cleanup();
  });

  test("disabled effect knobs update the bypassed lane without reconnecting", async () => {
    const context = new TestAudioContext();
    const source = new TestAudioNode(context);
    const runtime = createRuntime();
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      notifyListeners: () => undefined,
      sounds: new Map([["lane", sound("lane", source)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const config = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      enabled: false,
    };
    await controller.reconcile("lane", desiredEffects([config]));
    await controller.connectGraph(
      "lane",
      source as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    const edited = { ...config, threshold: -27 };
    expect(controller.setEffectFields("lane", config.id, edited)).toBe(
      "applied"
    );
    expect(
      (await controller.reconcile("lane", desiredEffects([edited]))).backend
    ).toBe("bypass");
    runtime.connectSound.mockImplementation(
      (_id, _source, _destination, _generation, _channels, settings) => {
        expect(settings?.effects).toEqual([{ ...edited, enabled: true }]);
        return Promise.resolve(true);
      }
    );
    await controller.reconcile(
      "lane",
      desiredEffects([{ ...edited, enabled: true }])
    );
    expect(controller.getRuntimeOutcome("lane").backend).toBe("official");
    controller.cleanup();
  });

  test("exposes desired-state reconciliation instead of granular Effects mutations", () => {
    const controllerMutations = [
      "add",
      "remove",
      "update",
      "reorder",
      "setDryWet",
      "setTempo",
      "setSidechain",
      "prepare",
      "getWorkletManager",
    ];
    const managerMutations = [
      "addEffect",
      "removeEffect",
      "updateEffect",
      "reorderEffects",
      "setEffectsDryWet",
      "setEffectsTempo",
      "setEffectsSidechain",
      "ensureEffectsReady",
      "getWorkletManager",
    ] as const;
    const managerHasNoGranularMutation: Extract<
      keyof AudioManager,
      (typeof managerMutations)[number]
    > extends never
      ? true
      : false = true;

    expect(
      controllerMutations.filter((name) => name in EffectsController.prototype)
    ).toEqual([]);
    expect(managerHasNoGranularMutation).toBe(true);
  });

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
      dryWet: 0.4,
      sidechainSoundId: null,
      tempo: 128,
      tree: [distortion],
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
  });

  test("keeps the dry graph active when compatibility initialization fails", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const manager = createManager(context);
    const failure = new Error("compatibility unavailable");
    (manager.init as ReturnType<typeof mock>).mockRejectedValue(failure);
    const controller = new EffectsController({
      createWorkletManager: () => manager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const distortion = createDefaultEffectConfig("distortion", "distortion", 0);
    distortion.enabled = true;
    await controller.reconcile("target", desiredEffects([distortion]));

    expect(
      await controller.connectGraph(
        "target",
        filter as unknown as AudioNode,
        new TestAudioNode(context) as unknown as AudioNode
      )
    ).toBe(true);
    expect(controller.getRuntimeOutcome("target")).toEqual({
      backend: "bypass",
      error: failure,
      ready: true,
      status: "failed",
    });
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
      dryWet: 0.7,
      sidechainSoundId: null,
      tempo: 124,
      tree: [reverb],
    });
    const destination = new TestAudioNode(context);

    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      destination as unknown as AudioNode,
      1
    );

    expect(controller.getRuntimeOutcome("target")).toEqual({
      backend: "official",
      ready: true,
      status: "ready",
    });
    expect(createWorkletManager).not.toHaveBeenCalled();
    expect(runtime.connectSound.mock.calls[0]?.[4]).toBe(1);
  });

  test("toggling one official effect retains the other enabled effect and sends both devices", async () => {
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
    const reverb = {
      ...createDefaultEffectConfig("plateReverb", "reverb", 0),
      enabled: true,
    };
    const disabledOfficial = createDefaultEffectConfig("delay", "disabled", 1);
    const disabledLegacy = createDefaultEffectConfig("limiter", "legacy", 2);
    const survivor = {
      ...createDefaultEffectConfig("compressor", "survivor", 3),
      enabled: true,
    };
    const tree = [reverb, disabledOfficial, disabledLegacy, survivor];
    await controller.reconcile("target", desiredEffects(tree));
    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    for (const enabled of [false, true]) {
      const updated = { ...reverb, enabled };
      // biome-ignore lint/performance/noAwaitInLoops: consecutive desired states retain the same runtime
      await controller.reconcile(
        "target",
        desiredEffects([updated, disabledOfficial, disabledLegacy, survivor])
      );
      expect(controller.getRuntimeOutcome("target")).toEqual({
        backend: "official",
        ready: true,
        status: "ready",
      });
      expect(runtime.connectSound.mock.calls.at(-1)?.[5]).toEqual({
        dryWet: 1,
        effects: [updated, disabledOfficial, survivor],
        sidechainSoundId: null,
        tempo: 120,
      });
      expect(runtime.deleteSound).not.toHaveBeenCalled();
      expect(createWorkletManager).not.toHaveBeenCalled();
    }
    await controller.reconcile("target", desiredEffects([]));
    expect(controller.getRuntimeOutcome("target").backend).toBe("bypass");
  });

  test.each(["disabled", "dry"] as const)(
    "%s settings select the same backend after an official connection or a fresh start",
    async (mode) => {
      const context = new TestAudioContext();
      const previousFilter = new TestAudioNode(context);
      const freshFilter = new TestAudioNode(context);
      const runtime = createRuntime();
      const controller = new EffectsController({
        createOfficialRuntime: () => runtime,
        notifyListeners: () => undefined,
        sounds: new Map([
          ["previous", sound("previous", previousFilter)],
          ["fresh", sound("fresh", freshFilter)],
        ]),
        workletProcessorUrl: () => "/worklet.js",
      });
      const reverb = {
        ...createDefaultEffectConfig("plateReverb", "reverb", 0),
        enabled: true,
      };
      await controller.reconcile("previous", desiredEffects([reverb]));
      await controller.connectGraph(
        "previous",
        previousFilter as unknown as AudioNode,
        new TestAudioNode(context) as unknown as AudioNode
      );
      expect(controller.getRuntimeOutcome("previous").backend).toBe("official");
      const desired = desiredEffects(
        [{ ...reverb, enabled: mode !== "disabled" }],
        { dryWet: mode === "dry" ? 0 : 1 }
      );
      await controller.reconcile("previous", desired);
      await controller.reconcile("fresh", desired);
      await controller.connectGraph(
        "fresh",
        freshFilter as unknown as AudioNode,
        new TestAudioNode(context) as unknown as AudioNode
      );
      expect(controller.getRuntimeOutcome("previous")).toEqual(
        controller.getRuntimeOutcome("fresh")
      );
      expect(controller.getRuntimeOutcome("previous").backend).toBe("bypass");
      expect(runtime.deleteSound).toHaveBeenCalledWith(
        "previous",
        expect.any(Number)
      );
      expect(runtime.connectSound).toHaveBeenCalledTimes(1);
      controller.cleanup();
    }
  );

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
      dryWet: 0.7,
      sidechainSoundId: null,
      tempo: 124,
      tree: [reverb],
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
  });

  test("reports a ready bypass when resumed runtime selection fails", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const manager = createManager(context);
    const failure = new Error("compatibility unavailable");
    (manager.init as ReturnType<typeof mock>).mockRejectedValue(failure);
    const controller = new EffectsController({
      createWorkletManager: () => manager,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    const distortion = createDefaultEffectConfig("distortion", "distortion", 0);
    distortion.enabled = true;
    const failed = await controller.reconcile(
      "target",
      desiredEffects([distortion])
    );
    expect(failed).toEqual({
      backend: "bypass",
      error: failure,
      ready: true,
      status: "failed",
    });

    controller.pauseSource("target");
    controller.resumeSource("target");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(controller.getRuntimeOutcome("target")).toEqual(failed);
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
      dryWet: 1,
      sidechainSoundId: null,
      tempo: 120,
      tree: [reverb],
    });
    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    const distortion = createDefaultEffectConfig("distortion", "distortion", 0);
    distortion.enabled = true;

    const outcome = await controller.reconcile("target", {
      dryWet: 1,
      sidechainSoundId: null,
      tempo: 120,
      tree: [distortion],
    });

    expect(outcome).toEqual({
      backend: "compatibility",
      ready: true,
      status: "ready",
    });
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
      dryWet: 1,
      sidechainSoundId: null,
      tempo: 120,
      tree: [distortion],
    };
    await controller.reconcile("target", desired);
    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );

    const outcome = await controller.reconcile("target", desired);

    expect(outcome).toEqual({
      backend: "compatibility",
      ready: true,
      status: "ready",
    });
    expect(controller.getRuntimeOutcome("target")).toEqual({
      backend: "compatibility",
      ready: true,
      status: "ready",
    });
  });

  test("applies a shared tempo update to every compatibility sound", async () => {
    const context = new TestAudioContext();
    const firstFilter = new TestAudioNode(context);
    const secondFilter = new TestAudioNode(context);
    const firstManager = createManager(context);
    const secondManager = createManager(context);
    const managers = [firstManager, secondManager];
    const controller = new EffectsController({
      createWorkletManager: () => {
        const manager = managers.shift();
        if (!manager) {
          throw new Error("Unexpected compatibility manager request");
        }
        return manager;
      },
      notifyListeners: () => undefined,
      sounds: new Map([
        ["first", sound("first", firstFilter)],
        ["second", sound("second", secondFilter)],
      ]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const distortion = createDefaultEffectConfig("distortion", "distortion", 0);
    distortion.enabled = true;
    await controller.reconcile("first", desiredEffects([distortion]));
    await controller.reconcile("second", desiredEffects([distortion]));
    await controller.connectGraph(
      "first",
      firstFilter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    await controller.connectGraph(
      "second",
      secondFilter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    const firstSetTempo = firstManager.setTempo as ReturnType<typeof mock>;
    const secondSetTempo = secondManager.setTempo as ReturnType<typeof mock>;
    firstSetTempo.mockClear();
    secondSetTempo.mockClear();

    await controller.reconcile(
      "first",
      desiredEffects([distortion], { tempo: 140 })
    );
    await controller.reconcile(
      "second",
      desiredEffects([distortion], { tempo: 140 })
    );

    expect(firstSetTempo).toHaveBeenCalledWith("first", 140);
    expect(secondSetTempo).toHaveBeenCalledWith("second", 140);
  });

  test("bypass invalidates a pending official connection before it can apply settings", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const runtime = createRuntime();
    const pending = Promise.withResolvers<boolean>();
    const started = Promise.withResolvers<void>();
    let owner: number | undefined;
    let appliedTempo = 120;
    runtime.connectSound.mockImplementation(
      async (_id, _source, _destination, generation, _channels, settings) => {
        owner = generation;
        started.resolve();
        await pending.promise;
        if (owner !== generation) {
          return false;
        }
        appliedTempo = settings?.tempo ?? 120;
        return true;
      }
    );
    runtime.deleteSound.mockImplementation(() => {
      owner = undefined;
    });
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      notifyListeners: () => undefined,
      sounds: new Map([["target", sound("target", filter)]]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const reverb = createDefaultEffectConfig("plateReverb", "reverb", 0);
    reverb.enabled = true;
    await controller.reconcile(
      "target",
      desiredEffects([reverb], { tempo: 150 })
    );
    const connecting = controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    await started.promise;
    await controller.reconcile("target", desiredEffects([]));
    pending.resolve(true);
    await connecting;
    expect(appliedTempo).toBe(120);
  });

  test("bypass releases an updating official sound and its unused sidechain", async () => {
    const context = new TestAudioContext();
    const filter = new TestAudioNode(context);
    const keyFilter = new TestAudioNode(context);
    const runtime = createRuntime();
    const registered = new Set<string>();
    const pending = Promise.withResolvers<boolean>();
    const started = Promise.withResolvers<void>();
    runtime.connectSound.mockImplementation((id) => {
      registered.add(id);
      return Promise.resolve(true);
    });
    runtime.connectSidechainSource.mockImplementation((id) => {
      registered.add(id);
      return Promise.resolve(true);
    });
    runtime.deleteSound.mockImplementation((id: string) => {
      registered.delete(id);
    });
    const controller = new EffectsController({
      createOfficialRuntime: () => runtime,
      createWorkletManager: () => createManager(context),
      notifyListeners: () => undefined,
      sounds: new Map([
        ["target", sound("target", filter)],
        ["key", sound("key", keyFilter)],
      ]),
      workletProcessorUrl: () => "/worklet.js",
    });
    const destination = new TestAudioNode(context) as unknown as AudioNode;
    await controller.connectGraph(
      "key",
      keyFilter as unknown as AudioNode,
      destination
    );
    const reverb = createDefaultEffectConfig("plateReverb", "reverb", 0);
    reverb.enabled = true;
    await controller.reconcile(
      "target",
      desiredEffects([reverb], { sidechainSoundId: "key" })
    );
    await controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      destination
    );
    expect(registered).toEqual(new Set(["target", "key"]));

    runtime.connectSound.mockImplementation(() => {
      started.resolve();
      return pending.promise;
    });
    const updating = controller.reconcile(
      "target",
      desiredEffects([reverb], { sidechainSoundId: "key", tempo: 150 })
    );
    await started.promise;
    await controller.reconcile(
      "target",
      desiredEffects([], { sidechainSoundId: "key" })
    );
    expect(registered.size).toBe(0);
    pending.resolve(false);
    await updating;

    const distortion = createDefaultEffectConfig("distortion", "distortion", 0);
    distortion.enabled = true;
    expect(
      await controller.reconcile("target", desiredEffects([distortion]))
    ).toEqual({ backend: "compatibility", ready: true, status: "ready" });
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
    await controller.reconcile("target", desiredEffects([reverb]));
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
    await controller.reconcile("target", desiredEffects([reverb]));
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
    expect(runtime.connectSound).toHaveBeenNthCalledWith(
      2,
      "target",
      replacementFilter,
      expect.anything(),
      expect.any(Number),
      2,
      { dryWet: 1, effects: [reverb], sidechainSoundId: null, tempo: 120 }
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
    await controller.reconcile("target", desiredEffects([compressor]));
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
    await controller.reconcile("target", desiredEffects([reverb]));
    const connecting = controller.connectGraph(
      "target",
      filter as unknown as AudioNode,
      new TestAudioNode(context) as unknown as AudioNode
    );
    await Promise.resolve();

    const updatedReverb = { ...reverb, decay: 0.7 };
    const reconciling = controller.reconcile(
      "target",
      desiredEffects([updatedReverb])
    );
    await Promise.resolve();
    pendingConnections[0]?.(true);

    expect(await connecting).toBe(true);
    expect(filter.connections).toHaveLength(1);

    pendingConnections[1]?.(true);
    await reconciling;

    expect(controller.getRuntimeOutcome("target")).toEqual({
      backend: "official",
      ready: true,
      status: "ready",
    });
  });
});
