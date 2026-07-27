import { afterEach, describe, expect, test } from "bun:test";
import { OPENDAW_FACTORY_KEYS } from "../dsp/effects/official-opendaw-mapping.js";
import { createDefaultEffectConfig } from "../dsp/effects/registry.js";
import {
  createMasterRack,
  createOfficialEffectGroup,
} from "./official-opendaw-effect-adapter.js";

const originalAudioWorkletNode = globalThis.AudioWorkletNode;

afterEach(() => {
  Reflect.set(globalThis, "AudioWorkletNode", originalAudioWorkletNode);
});

describe("official openDAW BoxGraph adapter", () => {
  test("fails visibly when a required device field is missing", () => {
    const primitive = () => ({
      getValue: () => 0,
      setValue: () => undefined,
    });
    const makeBox = (missing?: string) =>
      new Proxy(
        {
          audioEffects: {},
          delete: () => undefined,
          entries: {},
        } as Record<string, unknown>,
        {
          get(target, key) {
            if (key === missing) {
              return;
            }
            if (key in target) {
              return target[key as string];
            }
            return primitive();
          },
        }
      );
    const factories = {
      AudioEffectComposite: "composite",
      Compressor: "compressor",
      StereoTool: "stereo-tool",
    };
    const project = {
      api: {
        insertEffect: (_host: unknown, factory: string) =>
          makeBox(factory === factories.Compressor ? "threshold" : undefined),
      },
      boxGraph: {},
    };
    const boxes = {
      AudioEffectCompositeCellBox: {
        create: (
          _graph: unknown,
          _uuid: unknown,
          configure: (box: Record<string, ReturnType<typeof primitive>>) => void
        ) => {
          const cell = makeBox();
          Reflect.set(cell, "composite", { refer: () => undefined });
          configure(cell as never);
          return cell;
        },
      },
    };
    const compressor = createDefaultEffectConfig("compressor", "compressor", 0);

    expect(() =>
      createOfficialEffectGroup(
        {
          boxes,
          core: { EffectFactories: { AudioNamed: factories } },
          project,
          bpm: 120,
        } as never,
        compressor,
        {},
        0
      )
    ).toThrow('openDAW box is missing required field "threshold"');
  });

  test("constructs every catalog effect with the published boxes", async () => {
    Reflect.set(globalThis, "AudioWorkletNode", class {});
    const [adapters, boxes, core, { Option, Terminable }] = await Promise.all([
      import("@opendaw/studio-adapters"),
      import("@opendaw/studio-boxes"),
      import("@opendaw/studio-core"),
      import("@opendaw/lib-std"),
    ]);
    const sampleManager = {
      getOrCreate: (uuid: Uint8Array) => ({
        get data() {
          return Option.None;
        },
        get peaks() {
          return Option.None;
        },
        get state() {
          return { type: "idle" as const };
        },
        get uuid() {
          return uuid;
        },
        invalidate: () => undefined,
        subscribe: () => Terminable.Empty,
      }),
      invalidate: () => undefined,
      record: () => undefined,
      register: () => Terminable.Empty,
      remove: () => undefined,
    };
    const createAudioNode = () => ({
      connect: () => undefined,
      disconnect: () => undefined,
      gain: { value: 0 },
      pan: { value: 0 },
    });
    const project = core.Project.fromSkeleton(
      {
        audioContext: {
          createGain: createAudioNode,
          createStereoPanner: createAudioNode,
        },
        audioWorklets: undefined,
        sampleManager,
        sampleService: undefined,
        soundfontManager: undefined,
        soundfontService: undefined,
      } as never,
      adapters.ProjectSkeleton.empty({
        createDefaultUser: true,
        createOutputMaximizer: false,
      })
    );

    const groups = project.editing
      .modify(() => {
        const unit = project.api.createAnyInstrument(
          adapters.InstrumentFactories.Tape
        );
        const rack = createMasterRack(
          { boxes, core, project, bpm: 120 },
          unit.audioUnitBox.audioEffects
        );
        return Object.keys(OPENDAW_FACTORY_KEYS).map((type, index) => {
          const config = createDefaultEffectConfig(
            type as keyof typeof OPENDAW_FACTORY_KEYS,
            `effect-${index}`,
            index
          );
          if (config.type === "crusher") {
            config.autoGain = false;
            config.boost = 20;
          }
          if (config.type === "autotune") {
            config.scale = "majorPentatonic";
          }
          if (config.type === "fold") {
            config.amount = 20;
            config.volume = 3;
            config.autoGain = true;
          }
          return createOfficialEffectGroup(
            { boxes, core, project, bpm: 120 },
            config,
            rack.wet.audioEffects,
            index * 2
          );
        });
      })
      .unwrap();

    const value = (
      type: keyof typeof OPENDAW_FACTORY_KEYS,
      target: "device" | "outputTrim",
      key: string
    ) =>
      (
        (
          groups.find((group) => group.config.type === type)?.[
            target
          ] as unknown as Record<string, unknown>
        )[key] as {
          getValue(): number;
        }
      ).getValue();

    expect(groups).toHaveLength(19);
    expect(groups.every((group) => group.created.length >= 4)).toBe(true);
    expect(value("plateReverb", "device", "dry")).toBe(-72);
    expect(value("plateReverb", "device", "wet")).toBe(0);
    expect(value("delay", "device", "dry")).toBe(-72);
    expect(value("delay", "device", "wet")).toBe(0);
    expect(value("cheapReverb", "device", "dry")).toBe(-72);
    expect(value("cheapReverb", "device", "wet")).toBe(0);
    expect(value("crusher", "outputTrim", "volume")).toBeCloseTo(10);
    expect(value("fold", "device", "volume")).toBeCloseTo(-7);
    expect(value("autotune", "device", "scale")).toBe(3);
    project.terminate();
  });
});
