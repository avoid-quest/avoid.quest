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
    const audioUnitBoxes: unknown[] = [];
    const sidechainReferences: unknown[] = [];
    const compiledWerkstatt: Array<{ source: string; uuid: Uint8Array }> = [];
    const valueField = () => ({
      getValue: () => 0,
      setValue: () => undefined,
    });
    const createBox = (): Record<string, unknown> => {
      const incoming: unknown[] = [];
      boxCount++;
      return {
        address: { uuid: new Uint8Array([100 + boxCount]) },
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
          pointerHub: { filter: () => [] },
        },
        sideChain: {
          defer: () => sidechainReferences.push(null),
          refer: (target: unknown) => sidechainReferences.push(target),
        },
        solo: valueField(),
        wet: valueField(),
      };
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

    const worklet = {
      disconnect: (...args: unknown[]) => disconnected.push(args),
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
        deleteAudioUnit: () => undefined,
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

    expect(projectCount).toBe(1);
    expect(playCount).toBe(1);
    expect(unitCount).toBe(2);
    expect(runtime.soundCount).toBe(2);
    expect(registered).toEqual(["1", "2", "2"]);
    expect(unregistered).toEqual(["2"]);
    expect(disconnected).toHaveLength(1);
    expect(voidTransactionUnwraps).toBe(0);

    runtime.cleanup();
    expect(terminated).toBe(true);
    expect(unregistered).toEqual(["2", "1", "2"]);
  });
});
