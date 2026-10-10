import { afterEach, expect, test } from "bun:test";
import { Option, Terminable, ValueMapping } from "@opendaw/lib-std";
import type { ModulationBox } from "@opendaw/studio-boxes";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { createDefaultEffectConfig } from "@/lib/audio/dsp/effects/registry";
import { officialModulationField } from "@/lib/audio/manager/official-modulation-target";
import {
  createMasterRack,
  createOfficialEffectGroup,
  deleteOfficialEffectGroups,
} from "@/lib/audio/manager/official-opendaw-effect-adapter";
import { modulationFrequency } from "./modulation-frequency";
import {
  createNativeModulationSession,
  type NativeModulationSpec,
} from "./modulation-native";
import { MODULATION_DATA_SCHEMAS } from "./modulation-schema";

const originalWorklet = globalThis.AudioWorkletNode;
const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage"
);
const storage = new JSDOM("", { url: "https://modulation.test" }).window
  .localStorage;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
  globalThis.AudioWorkletNode = originalWorklet;
  if (originalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});
async function harness() {
  Reflect.set(globalThis, "AudioWorkletNode", class {});
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  const [adapters, boxes, core] = await Promise.all([
    import("@opendaw/studio-adapters"),
    import("@opendaw/studio-boxes"),
    import("@opendaw/studio-core"),
  ]);
  const node = () => ({
    connect: () => undefined,
    disconnect: () => undefined,
    gain: { value: 0 },
    pan: { value: 0 },
  });
  const project = core.Project.fromSkeleton(
    {
      audioContext: { createGain: node, createStereoPanner: node },
      sampleManager: {
        getOrCreate: (uuid: Uint8Array) => ({
          data: Option.None,
          peaks: Option.None,
          state: { type: "idle" },
          subscribe: () => Terminable.Empty,
          uuid,
        }),
      },
    } as never,
    adapters.ProjectSkeleton.empty({
      createDefaultUser: false,
      createOutputMaximizer: false,
    }),
    false
  );
  cleanups.push(() => project.terminate());
  const transaction = <T>(write: () => T): T => {
    if (project.boxGraph.inTransaction()) {
      return write();
    }
    project.boxGraph.beginTransaction();
    const result = write();
    project.boxGraph.endTransaction();
    return result;
  };
  const context = { adapters, boxes, bpm: 120, core, project };
  const { host, group } = transaction(() => {
    const unit = project.api.createAnyInstrument(
      adapters.InstrumentFactories.Tape
    );
    const rack = createMasterRack(context, unit.audioUnitBox.audioEffects);
    return {
      group: createOfficialEffectGroup(
        context,
        createDefaultEffectConfig("compressor", "comp", 0),
        rack.wet.audioEffects,
        0
      ),
      host: rack.wet.audioEffects,
    };
  });
  let current = group;
  let endpoints: () => void = () => undefined;
  const initialBoxes = project.boxGraph.boxes().length;
  const native = createNativeModulationSession(
    {
      field: (_sound, target) => officialModulationField(current, target),
      onEndpointsChanged: (listener) => {
        endpoints = listener;
        return () => {
          endpoints = () => undefined;
        };
      },
      project,
      retainOutput: () => () => undefined,
      transaction,
    },
    () => undefined
  );
  cleanups.push(() => native.dispose());
  const destination = (source: string) => ({
    depth: -0.25,
    enabled: true,
    id: source,
    soundId: "sound",
    source,
    target: {
      effectId: "comp",
      field: "threshold",
      kind: "effect" as const,
      laneId: "lane",
    },
  });
  const assignments = () =>
    project.boxGraph
      .boxes()
      .filter(
        (box): box is ModulationBox => box instanceof boxes.ModulationBox
      );
  return {
    assignments,
    boxes,
    destination,
    initialBoxes,
    native,
    project,
    replace: (deleteFirst = false) =>
      transaction(() => {
        const previous = current;
        if (deleteFirst) {
          deleteOfficialEffectGroups([previous]);
        }
        current = createOfficialEffectGroup(context, previous.config, host, 0);
        endpoints();
        if (!deleteFirst) {
          deleteOfficialEffectGroups([previous]);
        }
        const field = officialModulationField(
          current,
          destination("macro").target
        );
        if (!field) {
          throw new Error("Missing replacement field");
        }
        return field;
      }),
  };
}
function spec(
  type: NativeModulationSpec["type"],
  data: Record<string, unknown> = {}
): NativeModulationSpec {
  return {
    data: MODULATION_DATA_SCHEMAS[type].parse(data),
    id: type,
    type,
  } as NativeModulationSpec;
}

test("Steps and Random write their native pattern, repetition and timing fields", async () => {
  const h = await harness();
  const steps = spec("steps", {
    direction: "random",
    phase: 0.25,
    rate: 2,
    seed: 555,
    smooth: 0.2,
    sync: "1/4",
    tempo: 120,
    values: [0, 1, 0.5],
  });
  const random = spec("randomiser", {
    levels: 5,
    loop: 4,
    phase: 0.5,
    seed: 123,
    smooth: 0.4,
  });
  h.native.sync([steps, random]);
  const stepBox = h.project.boxGraph
    .boxes()
    .find(
      (box) => box instanceof h.boxes.StepsModulatorBox
    ) as import("@opendaw/studio-boxes").StepsModulatorBox;
  const randomBox = h.project.boxGraph
    .boxes()
    .find(
      (box) => box instanceof h.boxes.RandomModulatorBox
    ) as import("@opendaw/studio-boxes").RandomModulatorBox;
  expect("seed" in steps.data).toBe(false);
  expect(
    stepBox.steps
      .fields()
      .slice(0, 3)
      .map((field) => field.getValue())
  ).toEqual([0, 1, 0.5]);
  expect(stepBox.count.getValue()).toBe(3);
  expect(stepBox.direction.getValue()).toBe(4);
  expect(stepBox.smooth.getValue()).toBeCloseTo(0.2);
  expect(stepBox.phase.getValue()).toBe(0.25);
  expect(stepBox.rateSync.getValue()).toBe(0);
  expect(stepBox.rateAbsolute.getValue()).toBe(4);
  expect(randomBox.seed.getValue()).toBe(123);
  expect(randomBox.loop.getValue()).toBe(4);
  expect(randomBox.levels.getValue()).toBe(5);
  expect(randomBox.smooth.getValue()).toBeCloseTo(0.4);
  expect(randomBox.phase.getValue()).toBe(0.5);
  h.native.sync([
    spec("steps", { values: [0.7] }),
    spec("randomiser", { levels: 0, loop: 0, seed: 99 }),
  ]);
  expect(stepBox.count.getValue()).toBe(1);
  expect(stepBox.steps.fields()[0]?.getValue()).toBeCloseTo(0.7);
  expect(stepBox.steps.fields()[1]?.getValue()).toBe(0);
  expect(randomBox.seed.getValue()).toBe(99);
  expect(randomBox.loop.getValue()).toBe(0);
  expect(randomBox.levels.getValue()).toBe(0);
});

test("delay/fade LFO amount is written only by worklet packets, including edits and reset", async () => {
  const h = await harness();
  const lfo = spec("lfo", {
    delay: 1,
    fade: 2,
    rate: 10,
    sync: "1/32",
    tempo: 300,
  });
  h.native.sync([lfo], [h.destination("lfo")]);
  const box = h.project.boxGraph
    .boxes()
    .find(
      (candidate) => candidate instanceof h.boxes.LfoModulatorBox
    ) as import("@opendaw/studio-boxes").LfoModulatorBox;
  expect(modulationFrequency({ rate: 10, sync: "1/32", tempo: 300 })).toBe(50);
  expect(box.rateAbsolute.getValue()).toBe(50);
  expect(box.enabled.getValue()).toBe(false);
  h.native.frame({}, { lfo: 0.3 });
  h.native.sync([spec("lfo", { ...lfo.data, amount: 0.5 })]);
  expect(box.amount.getValue()).toBeCloseTo(0.3);
  h.native.frame({}, { lfo: 0.15 });
  expect(box.amount.getValue()).toBeCloseTo(0.15);
  const [assignment] = h.assignments();
  h.native.reset("lfo");
  expect(box.isAttached()).toBe(false);
  expect(assignment?.isAttached()).toBe(true);
  const replacement = assignment?.source.targetVertex.unwrap()
    .box as import("@opendaw/studio-boxes").LfoModulatorBox;
  h.native.frame({}, { lfo: 0 });
  expect(replacement.amount.getValue()).toBe(0);
  h.native.sync([spec("lfo", { amount: 0.7 })]);
  h.native.frame({}, { lfo: 0.1 });
  expect(replacement.amount.getValue()).toBeCloseTo(0.7);
  h.native.sync([spec("lfo", { delay: 1, fade: 2 })]);
  expect(replacement.enabled.getValue()).toBe(false);
  h.native.frame({}, { lfo: 0 });
  expect(replacement.enabled.getValue()).toBe(true);
  expect(replacement.amount.getValue()).toBe(0);
});

test.each([false, true])(
  "live assignments follow replacement fields when deletion happens first=%s",
  async (deleteFirst) => {
    const h = await harness();
    h.native.sync([spec("macro")], [h.destination("macro")]);
    const [before] = h.assignments();
    const source = before?.source.targetVertex.unwrap().box;
    const field = h.replace(deleteFirst);
    const [after] = h.assignments();
    expect(after?.isAttached()).toBe(true);
    expect(after?.source.targetVertex.unwrap().box).toBe(source);
    expect(after?.target.targetVertex.unwrap().address.toString()).toBe(
      field.address.toString()
    );
    if (!deleteFirst) {
      expect(after).toBe(before);
    }
    h.native.sync(
      [spec("macro")],
      [{ ...h.destination("macro"), enabled: false }]
    );
    expect(h.assignments()).toHaveLength(0);
    h.native.sync([spec("macro")], [{ ...h.destination("macro"), depth: 0 }]);
    expect(h.assignments()).toHaveLength(0);
  }
);

test("bridge frames preserve final emitted values, leave undo empty and release owned boxes", async () => {
  const h = await harness();
  h.native.sync([spec("macro", { bipolar: true })], [h.destination("macro")]);
  const macro = h.project.boxGraph
    .boxes()
    .find(
      (box) => box instanceof h.boxes.MacroModulatorBox
    ) as import("@opendaw/studio-boxes").MacroModulatorBox;
  (
    h.project.editing as typeof h.project.editing & { clear: () => void }
  ).clear();
  for (let frame = 0; frame < 1000; frame += 1) {
    h.native.frame({ macro: (frame % 100) / 100 });
  }
  expect(h.project.editing.canUndo()).toBe(false);
  for (const emitted of [-1, -0.375, 0, 0.25, 1]) {
    h.native.frame({ macro: emitted });
    expect(ValueMapping.bipolar().y(macro.value.getValue())).toBeCloseTo(
      emitted
    );
  }
  h.native.dispose();
  expect(h.project.boxGraph.boxes()).toHaveLength(h.initialBoxes);
});
