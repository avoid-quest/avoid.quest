import { afterEach, describe, expect, test } from "bun:test";
import { createDefaultEffectConfig } from "../dsp/effects/registry.js";
import { getWerkstattRuntimeStatus } from "../dsp/effects/werkstatt-runtime-status.js";
import {
  OfficialOpenDawRuntime,
  type RuntimeModuleLoader,
} from "./official-opendaw-runtime";

const originalAudioWorkletNode = Reflect.get(globalThis, "AudioWorkletNode");

afterEach(() => {
  if (originalAudioWorkletNode === undefined) {
    Reflect.deleteProperty(globalThis, "AudioWorkletNode");
  } else {
    Reflect.set(globalThis, "AudioWorkletNode", originalAudioWorkletNode);
  }
});

describe("OfficialOpenDawRuntime", () => {
  test("terminates a project when engine startup fails", async () => {
    Reflect.set(globalThis, "AudioWorkletNode", class {});

    const context = {
      destination: {},
    } as unknown as AudioContext;
    let terminateCount = 0;
    const startupError = new Error("engine startup failed");
    const loader = (async () => ({
      adapters: {
        ScriptCompiler: { create: () => ({}) },
      },
      boxes: {},
      core: {
        AudioWorklets: {
          install: () => undefined,
          createFor: async () => ({ context }),
        },
        Project: {
          new: () => ({
            engine: {
              isReady: () => Promise.reject(startupError),
              play: () => undefined,
            },
            startAudioWorklet: () => ({
              disconnect: () => undefined,
            }),
            terminate: () => {
              terminateCount++;
            },
          }),
        },
        SampleService: class {},
      },
      wasm: {
        WasmEngine: {
          install: () => undefined,
          ensureReady: async () => true,
        },
      },
    })) as unknown as RuntimeModuleLoader;
    const runtime = new OfficialOpenDawRuntime(context, undefined, loader);

    await expect(runtime.initialize()).rejects.toThrow(startupError);

    expect(terminateCount).toBe(1);
    expect(runtime.isReady).toBe(false);
  });

  test("shares one engine and creates one monitored AudioUnit per sound", async () => {
    Reflect.set(globalThis, "AudioWorkletNode", class {});

    const context = {
      destination: { context: null },
    } as unknown as AudioContext;
    Reflect.set(context.destination, "context", context);

    const registered: string[] = [];
    const unregistered: string[] = [];
    const disconnected: unknown[] = [];
    let playCount = 0;
    let projectCount = 0;
    let unitCount = 0;
    let terminated = false;
    let voidTransactionUnwraps = 0;
    let boxCount = 0;
    let deletedUnitCount = 0;
    const audioUnitBoxes: unknown[] = [];
    const sidechainReferences: unknown[] = [];
    const compiledWerkstatt: Array<{ source: string; uuid: Uint8Array }> = [];
    const restoredParameters: Array<{ uuid: number; value: number }> = [];
    const pendingCompiles: Array<{
      reject(cause: Error): void;
      resolve(): void;
      source: string;
      uuid: number;
    }> = [];
    const valueField = () => ({
      getValue: () => 0,
      setValue: () => undefined,
    });
    const createBox = (): Record<string, unknown> => {
      const incoming: unknown[] = [];
      boxCount++;
      const uuid = 100 + boxCount;
      const parameterBox = {
        label: {
          getValue: () => "drive",
          setValue: () => undefined,
        },
        value: {
          getValue: () => 0,
          setValue: (value: number) => restoredParameters.push({ uuid, value }),
        },
      };
      const box: Record<string, unknown> = {
        address: { uuid: new Uint8Array([uuid]) },
        audioEffects: {},
        delete: () => undefined,
        dry: valueField(),
        enabled: valueField(),
        entries: {
          incoming,
          pointerHub: { incoming: () => incoming },
        },
        gain: valueField(),
        index: valueField(),
        label: valueField(),
        mute: valueField(),
        pan: valueField(),
        parameters: {
          pointerHub: { filter: () => [{ box: parameterBox }] },
        },
        sideChain: {
          defer: () => sidechainReferences.push(null),
          refer: (target: unknown) => sidechainReferences.push(target),
        },
        solo: valueField(),
        wet: valueField(),
      };
      return new Proxy(box, {
        get(target, key) {
          if (typeof key === "string" && !(key in target)) {
            target[key] = valueField();
          }
          return target[key as string];
        },
      });
    };
    const createCell = (
      _graph: unknown,
      _uuid: unknown,
      configure: (box: Record<string, unknown>) => void
    ) => {
      const box = createBox();
      box.composite = {
        refer: (entries: { incoming: unknown[] }) => {
          entries.incoming.push({ box });
        },
      };
      configure(box);
      return box;
    };

    const engine = {
      isReady: async () => undefined,
      play: () => {
        playCount++;
      },
      registerMonitoringSource: (uuid: Uint8Array) => {
        registered.push(String(uuid[0]));
      },
      unregisterMonitoringSource: (uuid: Uint8Array) => {
        unregistered.push(String(uuid[0]));
      },
      subscribeDeviceMessage: () => ({ terminate: () => undefined }),
    };
    const worklet = {
      disconnect: (...args: unknown[]) => disconnected.push(args),
    };
    const project = {
      api: {
        createInstrument: () => {
          unitCount++;
          const audioUnitBox = {
            address: { uuid: new Uint8Array([unitCount]) },
            audioEffects: {},
          };
          audioUnitBoxes.push(audioUnitBox);
          return {
            audioUnitBox,
            instrumentBox: {},
            trackBox: {},
          };
        },
        insertEffect: () => createBox(),
        deleteAudioUnit: () => {
          deletedUnitCount++;
        },
        setBpm: () => undefined,
      },
      editing: {
        modify: (callback: () => unknown) => {
          const value = callback();
          return {
            unwrap: () => {
              if (value === undefined) {
                voidTransactionUnwraps++;
                throw new Error("unwrap failed");
              }
              return value;
            },
          };
        },
      },
      engine,
      startAudioWorklet: () => worklet,
      boxGraph: {},
      terminate: () => {
        terminated = true;
      },
    };
    const loader = (async () => ({
      adapters: {
        InstrumentFactories: { Tape: {} },
        ScriptCompiler: {
          create: () => ({
            compile: (
              _context: unknown,
              _editing: unknown,
              device: { address: { uuid: Uint8Array } },
              source: string
            ) => {
              compiledWerkstatt.push({
                source,
                uuid: device.address.uuid,
              });
              if (source.startsWith("deferred:")) {
                return new Promise<void>((resolve, reject) => {
                  pendingCompiles.push({
                    reject,
                    resolve,
                    source,
                    uuid: device.address.uuid[0] ?? -1,
                  });
                });
              }
              if (source.includes("syntax error")) {
                return Promise.reject(new Error("Syntax error"));
              }
              return Promise.resolve();
            },
          }),
        },
      },
      boxes: {
        AudioEffectCompositeCellBox: { create: createCell },
      },
      core: {
        AudioWorklets: {
          install: () => undefined,
          createFor: async () => ({ context }),
        },
        Project: {
          new: () => {
            projectCount++;
            return project;
          },
        },
        SampleService: class {},
        SoundfontService: class {},
        EffectFactories: {
          AudioNamed: {
            AudioEffectComposite: {},
            Compressor: {},
            StereoTool: {},
            Werkstatt: {},
          },
        },
      },
      wasm: {
        WasmEngine: {
          install: () => undefined,
          ensureReady: async () => true,
        },
      },
    })) as unknown as RuntimeModuleLoader;

    const runtime = new OfficialOpenDawRuntime(context, undefined, loader);
    const source = { context } as unknown as AudioNode;
    const destination = { context } as unknown as AudioNode;

    await Promise.all([
      runtime.connectSound("deck-a", source, destination),
      runtime.connectSound("deck-b", source, destination),
    ]);
    await runtime.connectSound("deck-a", source, destination);
    expect(() => runtime.setTempo(120)).not.toThrow();
    const compressor = createDefaultEffectConfig("compressor", "compressor", 0);
    compressor.sidechain = { channelId: "persisted-deck-b" };
    runtime.syncEffects("deck-a", [compressor]);
    const boxesAfterCompressor = boxCount;
    runtime.syncEffects("deck-a", [{ ...compressor, threshold: -18 }]);
    expect(boxCount).toBe(boxesAfterCompressor);
    runtime.setSidechainTarget("deck-a", "deck-b");
    expect(() => runtime.setDryWet("deck-a", 1)).not.toThrow();

    expect(sidechainReferences.at(-1)).toBe(audioUnitBoxes[1]);
    runtime.disconnectSound("deck-b");
    expect(sidechainReferences.at(-1)).toBeNull();
    await runtime.connectSound("deck-b", source, destination);
    expect(sidechainReferences.at(-1)).toBe(audioUnitBoxes[1]);

    const werkstatt = createDefaultEffectConfig("werkstatt", "werkstatt", 0);
    runtime.syncEffects("deck-a", [werkstatt]);
    await Promise.resolve();
    expect(compiledWerkstatt).toHaveLength(1);
    const werkstattUuid = compiledWerkstatt[0]?.uuid;

    runtime.syncEffects("deck-a", [
      {
        ...werkstatt,
        parameters: { drive: 0.75 },
      },
    ]);
    await Promise.resolve();
    expect(compiledWerkstatt).toHaveLength(1);

    runtime.syncEffects("deck-a", [
      {
        ...werkstatt,
        code: `${werkstatt.code}\n// hot swap`,
        parameters: { drive: 0.75 },
      },
    ]);
    await Promise.resolve();
    expect(compiledWerkstatt).toHaveLength(2);
    expect(compiledWerkstatt[1]?.uuid).toBe(werkstattUuid);

    runtime.syncEffects("deck-a", [
      {
        ...werkstatt,
        code: "syntax error",
      },
    ]);
    await Promise.resolve();
    await Promise.resolve();
    expect(compiledWerkstatt[2]?.uuid).toBe(werkstattUuid);
    expect(getWerkstattRuntimeStatus(werkstatt.id)).toEqual({
      state: "error",
      message: "Syntax error",
    });

    const nestedWerkstatt = {
      ...werkstatt,
      id: "nested-werkstatt",
      code: werkstatt.code,
    };
    const composite = createDefaultEffectConfig("fxComposite", "composite", 0);
    composite.chains[0]?.effects.push(nestedWerkstatt);
    runtime.syncEffects("deck-a", [composite]);
    await Promise.resolve();
    const nestedInitial = compiledWerkstatt.at(-1);

    runtime.syncEffects("deck-a", [
      {
        ...composite,
        chains: composite.chains.map((chain, index) =>
          index === 0
            ? {
                ...chain,
                effects: [{ ...nestedWerkstatt, parameters: { drive: 0.5 } }],
              }
            : chain
        ),
      },
    ]);
    await Promise.resolve();
    expect(compiledWerkstatt.at(-1)).toBe(nestedInitial);

    runtime.syncEffects("deck-a", [
      {
        ...composite,
        chains: composite.chains.map((chain, index) =>
          index === 0
            ? {
                ...chain,
                effects: [
                  {
                    ...nestedWerkstatt,
                    code: `${nestedWerkstatt.code}\n// nested hot swap`,
                  },
                ],
              }
            : chain
        ),
      },
    ]);
    await Promise.resolve();
    expect(compiledWerkstatt.at(-1)?.uuid).toBe(nestedInitial?.uuid);

    const race = {
      ...werkstatt,
      id: "werkstatt-race",
      code: "deferred:old-success",
      parameters: { drive: 0.1 },
    };
    runtime.syncEffects("deck-a", [race]);
    const oldSuccess = pendingCompiles.at(-1);
    runtime.syncEffects("deck-a", []);
    runtime.syncEffects("deck-a", [
      {
        ...race,
        code: "deferred:replacement-success",
        parameters: { drive: 0.8 },
      },
    ]);
    const replacementSuccess = pendingCompiles.at(-1);
    if (!(oldSuccess && replacementSuccess)) {
      throw new Error("Expected both Werkstatt compiles to be pending");
    }
    replacementSuccess?.resolve();
    await Promise.resolve();
    await Promise.resolve();
    oldSuccess?.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(getWerkstattRuntimeStatus(race.id)?.state).toBe("ready");
    expect(
      restoredParameters.some(
        ({ uuid, value }) => uuid === oldSuccess?.uuid && value === 0.1
      )
    ).toBe(false);
    expect(restoredParameters).toContainEqual({
      uuid: replacementSuccess.uuid,
      value: 0.8,
    });

    runtime.syncEffects("deck-a", []);
    runtime.syncEffects("deck-a", [
      {
        ...race,
        code: "deferred:old-failure",
        parameters: { drive: 0.2 },
      },
    ]);
    const oldFailure = pendingCompiles.at(-1);
    runtime.syncEffects("deck-a", []);
    runtime.syncEffects("deck-a", [
      {
        ...race,
        code: "deferred:replacement-failure",
        parameters: { drive: 0.9 },
      },
    ]);
    const replacementFailure = pendingCompiles.at(-1);
    if (!(oldFailure && replacementFailure)) {
      throw new Error("Expected both Werkstatt failures to be pending");
    }
    replacementFailure?.reject(new Error("Replacement failed"));
    await Promise.resolve();
    await Promise.resolve();
    oldFailure?.reject(new Error("Released compile failed"));
    await Promise.resolve();
    await Promise.resolve();

    expect(getWerkstattRuntimeStatus(race.id)).toEqual({
      state: "error",
      message: "Replacement failed",
    });
    expect(
      restoredParameters.some(
        ({ uuid, value }) => uuid === oldFailure?.uuid && value === 0.2
      )
    ).toBe(false);

    expect(projectCount).toBe(1);
    expect(playCount).toBe(1);
    expect(unitCount).toBe(2);
    expect(runtime.soundCount).toBe(2);
    expect(registered).toEqual(["1", "2", "2"]);
    expect(unregistered).toEqual(["2"]);
    expect(disconnected).toHaveLength(1);
    expect(voidTransactionUnwraps).toBe(0);

    runtime.syncEffects("deck-a", []);
    runtime.syncEffects("deck-a", [
      {
        ...race,
        code: "deferred:cleanup",
        parameters: { drive: 1 },
      },
    ]);
    const cleanupCompile = pendingCompiles.at(-1);
    runtime.cleanup();
    cleanupCompile?.resolve();
    await Promise.resolve();
    expect(terminated).toBe(true);
    expect(getWerkstattRuntimeStatus(race.id).state).toBe("idle");
    expect(
      restoredParameters.some(
        ({ uuid, value }) => uuid === cleanupCompile?.uuid && value === 1
      )
    ).toBe(false);
    expect(unregistered).toEqual(["2", "1", "2"]);

    const modules = await loader();
    let releaseInitialization:
      | ((loaded: Awaited<ReturnType<RuntimeModuleLoader>>) => void)
      | undefined;
    const deferredLoader = () =>
      new Promise<Awaited<ReturnType<RuntimeModuleLoader>>>((resolve) => {
        releaseInitialization = resolve;
      });
    const canceledRuntime = new OfficialOpenDawRuntime(
      context,
      undefined,
      deferredLoader
    );
    const canceled = canceledRuntime.connectSound(
      "canceled",
      source,
      destination,
      1
    );
    canceledRuntime.deleteSound("canceled", 2);
    releaseInitialization?.(modules);

    expect(await canceled).toBe(false);
    expect(canceledRuntime.soundCount).toBe(0);
    canceledRuntime.cleanup();

    let releaseStopped:
      | ((loaded: Awaited<ReturnType<RuntimeModuleLoader>>) => void)
      | undefined;
    const stoppedRuntime = new OfficialOpenDawRuntime(
      context,
      undefined,
      () =>
        new Promise((resolve) => {
          releaseStopped = resolve;
        })
    );
    const stoppedRegistrationCount = registered.length;
    const stopped = stoppedRuntime.connectSound(
      "stopped",
      source,
      destination,
      1
    );
    stoppedRuntime.disconnectSound("stopped", 2);
    releaseStopped?.(modules);

    expect(await stopped).toBe(false);
    expect(stoppedRuntime.soundCount).toBe(0);
    expect(registered).toHaveLength(stoppedRegistrationCount);
    stoppedRuntime.cleanup();

    let releaseReplacement:
      | ((loaded: Awaited<ReturnType<RuntimeModuleLoader>>) => void)
      | undefined;
    const replacementRuntime = new OfficialOpenDawRuntime(
      context,
      undefined,
      () =>
        new Promise((resolve) => {
          releaseReplacement = resolve;
        })
    );
    const oldSource = { context } as unknown as AudioNode;
    const newSource = { context } as unknown as AudioNode;
    const registrationCount = registered.length;
    const oldConnection = replacementRuntime.connectSound(
      "replacement",
      oldSource,
      destination,
      1
    );
    const newConnection = replacementRuntime.connectSound(
      "replacement",
      newSource,
      destination,
      2
    );
    releaseReplacement?.(modules);

    expect(await oldConnection).toBe(false);
    expect(await newConnection).toBe(true);
    expect(registered).toHaveLength(registrationCount + 1);
    const unregisterCount = unregistered.length;
    replacementRuntime.disconnectSound("replacement", 1);
    replacementRuntime.deleteSound("replacement", 1);
    expect(replacementRuntime.soundCount).toBe(1);
    expect(unregistered).toHaveLength(unregisterCount);
    replacementRuntime.deleteSound("replacement", 3);
    replacementRuntime.deleteSound("replacement", 4);
    expect(deletedUnitCount).toBe(1);
    expect(unregistered.at(-1)).toBe(registered.at(-1));
    replacementRuntime.cleanup();
  });
});
