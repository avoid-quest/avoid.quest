import { afterEach, describe, expect, test } from "bun:test";
import { modulationParameters } from "@/lib/node-graph/modulation-parameters";
import type { GraphNode } from "@/lib/node-graph/schema";
import { OPENDAW_FACTORY_KEYS } from "../dsp/effects/official-opendaw-mapping.js";
import { createDefaultEffectConfig } from "../dsp/effects/registry.js";
import {
  isCoupledParameter,
  officialModulationField,
} from "./official-modulation-target";
import {
  createMasterRack,
  createOfficialEffectGroup,
  updateOfficialEffectGroup,
  writeOfficialEffectFields,
} from "./official-opendaw-effect-adapter.js";

const originalAudioWorkletNode = globalThis.AudioWorkletNode;

afterEach(() => {
  Reflect.set(globalThis, "AudioWorkletNode", originalAudioWorkletNode);
});

describe("official openDAW BoxGraph adapter", () => {
  test("every slider is coupled or resolves to a field on the published boxes", async () => {
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

    const { groups, host } = project.editing
      .modify(() => {
        const unit = project.api.createAnyInstrument(
          adapters.InstrumentFactories.Tape
        );
        const rack = createMasterRack(
          { adapters, boxes, bpm: 120, core, project },
          unit.audioUnitBox.audioEffects
        );
        const createdGroups = Object.keys(OPENDAW_FACTORY_KEYS).map(
          (type, index) => {
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
              { adapters, boxes, bpm: 120, core, project },
              config,
              rack.wet.audioEffects,
              index * 3
            );
          }
        );
        return { groups: createdGroups, host: rack.wet.audioEffects };
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
      groups.find((group) => group.config.type === "autotune")?.wrapper
    ).toBeNull();
    expect(
      groups
        .filter((group) => group.config.type !== "autotune")
        .every((group) => group.wrapper !== null)
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
    project.editing.modify(() =>
      updateOfficialEffectGroup(
        { adapters, boxes, bpm: 120, core, project },
        autotune,
        updatedAutotune,
        host
      )
    );
    expect(value("autotune", "device", "key")).toBe(2);
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
    const sibling = groups.find((group) => group.config.type === "delay");
    if (!(sibling?.wrapper && sibling.device instanceof boxes.DelayDeviceBox)) {
      throw new Error("Delay sibling missing");
    }
    const { device: siblingDevice, wrapper: siblingWrapper } = sibling;
    const siblingDelay = siblingDevice.delayMillis.getValue();
    const { signalTrim, wrapper, inputTrim: wetTrim, outputTrim } = reverb;
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
    const { device } = reverb;
    project.editing.modify(() =>
      updateOfficialEffectGroup(
        { adapters, boxes, bpm: 120, core, project },
        reverb,
        { ...reverb.config, signalGain: 1 },
        host
      )
    );
    expect(signalTrim.volume.getValue()).toBe(0);
    project.editing.modify(() =>
      updateOfficialEffectGroup(
        { adapters, boxes, bpm: 120, core, project },
        reverb,
        { ...reverb.config, enabled: false, signalGain: 0.5 },
        host
      )
    );
    expect(signalTrim.enabled.getValue()).toBe(false);
    expect(wrapper.enabled.getValue()).toBe(false);
    expect(outputTrim.enabled.getValue()).toBe(false);
    project.editing.modify(() =>
      updateOfficialEffectGroup(
        { adapters, boxes, bpm: 120, core, project },
        reverb,
        { ...reverb.config, enabled: true },
        host
      )
    );
    expect(signalTrim.enabled.getValue()).toBe(true);
    expect(signalTrim.volume.getValue()).toBeCloseTo(20 * Math.log10(0.5));
    expect(reverb.device).toBe(device);
    expect(project.boxGraph.findBox(siblingDevice.address.uuid).unwrap()).toBe(
      siblingDevice
    );
    expect(siblingDevice.isAttached()).toBe(true);
    expect(siblingWrapper.host.targetVertex.unwrap()).toBe(host);
    expect(siblingDevice.delayMillis.getValue()).toBe(siblingDelay);
    const authored = reverb.config;
    project.editing.modify(() =>
      writeOfficialEffectFields(
        { adapters, boxes, bpm: 120, core, project },
        reverb,
        { ...authored, dryWet: 0.4, inputGain: 0.5, outputGain: 1.5 }
      )
    );
    expect(wetTrim.volume.getValue()).toBeCloseTo(20 * Math.log10(0.5));
    expect(wrapper.dry.getValue()).toBeCloseTo(20 * Math.log10(0.6));
    expect(wrapper.wet.getValue()).toBeCloseTo(20 * Math.log10(0.4));
    expect(outputTrim.volume.getValue()).toBeCloseTo(20 * Math.log10(1.5));
    expect(reverb.config).toBe(authored);
    if (!autotune) {
      throw new Error("Missing Autotune");
    }
    const nativeDevice = autotune.device;
    project.boxGraph.beginTransaction();
    updateOfficialEffectGroup(
      { adapters, boxes, bpm: 120, core, project },
      autotune,
      { ...autotune.config, keepWrapper: true, signalGain: 1 },
      host
    );
    project.boxGraph.endTransaction();
    const authoredTune = autotune.config;
    expect(autotune.wrapper).not.toBeNull();
    expect(autotune.signalTrim?.volume.getValue()).toBe(0);
    project.boxGraph.beginTransaction();
    writeOfficialEffectFields(
      { adapters, boxes, bpm: 120, core, project },
      autotune,
      { ...authoredTune, dryWet: 0.25, inputGain: 0.5 }
    );
    project.boxGraph.endTransaction();
    expect(autotune.config).toBe(authoredTune);
    expect(autotune.wrapper?.wet.getValue()).toBeCloseTo(20 * Math.log10(0.25));
    expect(autotune.wrapper?.dry.getValue()).toBeCloseTo(20 * Math.log10(0.75));
    project.boxGraph.beginTransaction();
    updateOfficialEffectGroup(
      { adapters, boxes, bpm: 120, core, project },
      autotune,
      { ...autotune.config, keepWrapper: false, signalGain: undefined },
      host
    );
    project.boxGraph.endTransaction();
    expect(autotune.wrapper).toBeNull();
    expect(autotune.signalTrim).toBeNull();
    expect(autotune.device).toBe(nativeDevice);
    for (const group of groups) {
      const node = {
        data: { effect: group.config },
        id: group.config.id,
        position: { x: 0, y: 0 },
        type: group.config.type,
      } as GraphNode;
      for (const parameter of modulationParameters(node)) {
        const target = {
          effectId: group.config.id,
          field: parameter.key,
          kind: "effect" as const,
          laneId: "a",
        };
        expect(
          isCoupledParameter(group, target) ||
            Boolean(officialModulationField(group, target))
        ).toBe(true);
      }
    }
    project.terminate();
  });
});
