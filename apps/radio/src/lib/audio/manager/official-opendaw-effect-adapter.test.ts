import { afterEach, describe, expect, test } from "bun:test";
import type {
  AudioEffectCompositeBox,
  StereoToolDeviceBox,
} from "@opendaw/studio-boxes";
import { OPENDAW_FACTORY_KEYS } from "../dsp/effects/official-opendaw-mapping.js";
import { createDefaultEffectConfig } from "../dsp/effects/registry.js";
import {
  createMasterRack,
  createOfficialEffectGroup,
  updateOfficialEffectGroup,
  usesDirectOfficialEffectLayout,
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
          bpm: 120,
          core: { EffectFactories: { AudioNamed: factories } },
          project,
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
        invalidate: () => undefined,
        get peaks() {
          return Option.None;
        },
        get state() {
          return { type: "idle" as const };
        },
        subscribe: () => Terminable.Empty,
        get uuid() {
          return uuid;
        },
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
        createDefaultUser: false,
        createOutputMaximizer: false,
      }),
      false
    );

    const groups = project.editing
      .modify(() => {
        const unit = project.api.createAnyInstrument(
          adapters.InstrumentFactories.Tape
        );
        const rack = createMasterRack(
          { boxes, bpm: 120, core, project },
          unit.audioUnitBox.audioEffects
        );
        return Object.keys(OPENDAW_FACTORY_KEYS).map((type, index) => {
          const config = createDefaultEffectConfig(
            type as keyof typeof OPENDAW_FACTORY_KEYS,
            `effect-${index}`,
            index
          );
          if (config.type === "cheapReverb") {
            config.enabled = true;
            config.dryWet = 0.5;
            config.signalGain = 0.5;
          }
          if (config.type === "crusher") {
            config.autoGain = false;
            config.boost = 20;
          }
          if (config.type === "autotune") {
            config.enabled = true;
            config.scale = "majorPentatonic";
          }
          if (config.type === "fold") {
            config.amount = 20;
            config.volume = 3;
            config.autoGain = true;
          }
          return createOfficialEffectGroup(
            { boxes, bpm: 120, core, project },
            config,
            rack.wet.audioEffects,
            index * 3
          );
        });
      })
      .unwrap();

    const value = (
      type: keyof typeof OPENDAW_FACTORY_KEYS,
      target: "device" | "outputTrim",
      key: string
    ): number => {
      const group = groups.find((candidate) => candidate.config.type === type);
      const box = group?.[target];
      if (!box) {
        throw new Error(`Missing ${target} for ${type}`);
      }
      return (
        (box as unknown as Record<string, unknown>)[key] as {
          getValue: () => number;
        }
      ).getValue();
    };

    expect(groups).toHaveLength(19);
    expect(
      groups.find((group) => group.config.type === "autotune")?.created
    ).toHaveLength(1);
    expect(
      groups
        .filter((group) => group.config.type !== "autotune")
        .every((group) => group.created.length >= 4)
    ).toBe(true);
    expect(value("plateReverb", "device", "dry")).toBe(-72);
    expect(value("plateReverb", "device", "wet")).toBe(0);
    expect(value("delay", "device", "dry")).toBe(-72);
    expect(value("delay", "device", "wet")).toBe(0);
    expect(value("cheapReverb", "device", "dry")).toBe(-72);
    expect(value("cheapReverb", "device", "wet")).toBe(0);
    expect(value("crusher", "outputTrim", "volume")).toBeCloseTo(10);
    expect(value("fold", "device", "volume")).toBeCloseTo(-7);
    expect(value("autotune", "device", "scale")).toBe(3);
    const autotune = groups.find((group) => group.config.type === "autotune");
    if (autotune?.config.type !== "autotune") {
      throw new Error("Autotune group missing");
    }
    const updatedAutotune = { ...autotune.config, key: "D" as const };
    expect(usesDirectOfficialEffectLayout(updatedAutotune)).toBe(true);
    project.editing.modify(() =>
      updateOfficialEffectGroup(autotune, updatedAutotune, 120)
    );
    expect(value("autotune", "device", "key")).toBe(2);
    expect(
      usesDirectOfficialEffectLayout({
        ...updatedAutotune,
        inputGain: 0.5,
      })
    ).toBe(false);
    const reverb = groups.find((group) => group.config.type === "cheapReverb");
    if (
      !(
        reverb?.signalTrim &&
        reverb.wrapper &&
        reverb.inputTrim &&
        reverb.outputTrim
      )
    ) {
      throw new Error("Missing reverb signal trim");
    }
    const signalTrim = reverb.signalTrim as unknown as StereoToolDeviceBox;
    const wrapper = reverb.wrapper as unknown as AudioEffectCompositeBox;
    const wetTrim = reverb.inputTrim as unknown as StereoToolDeviceBox;
    const outputTrim = reverb.outputTrim as unknown as StereoToolDeviceBox;
    // The published BoxGraph places gain before the point where dry and wet split.
    expect(signalTrim.host.targetVertex.unwrap()).toBe(
      wrapper.host.targetVertex.unwrap()
    );
    expect(wetTrim.host.targetVertex.unwrap()).not.toBe(
      wrapper.host.targetVertex.unwrap()
    );
    expect(signalTrim.index.getValue()).toBeLessThan(wrapper.index.getValue());
    expect(wrapper.index.getValue()).toBeLessThan(outputTrim.index.getValue());
    expect(signalTrim.volume.getValue()).toBeCloseTo(20 * Math.log10(0.5));
    expect(signalTrim.panningMixing.getValue()).toBe(0);
    expect(wetTrim.volume.getValue()).toBe(0);
    const created = reverb.created.length;
    project.editing.modify(() =>
      updateOfficialEffectGroup(
        reverb,
        { ...reverb.config, signalGain: 1 },
        120
      )
    );
    expect(signalTrim.volume.getValue()).toBe(0);
    expect(reverb.created).toHaveLength(created);
    project.terminate();
  });
});
