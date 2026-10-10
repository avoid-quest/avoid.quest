import { type Subscription, ValueMapping } from "@opendaw/lib-std";
import {
  LfoShape,
  type ModulatorBox,
  StepsDirection,
} from "@opendaw/studio-adapters";
import type { ModulationBox } from "@opendaw/studio-boxes";
import type { Project } from "@opendaw/studio-core";
import type {
  EffectParamTarget,
  ModulationHost,
  NativeField,
} from "@/lib/audio/manager/official-modulation-target";
import { modulationFrequency, NATIVE_TYPES } from "./modulation-frequency";
import type { ModulationSpec } from "./modulation-schema";

export type NativeModulationSpec = Extract<
  ModulationSpec,
  { type: "lfo" | "steps" | "randomiser" | "macro" }
>;
export function isNativeModulation(
  spec: ModulationSpec
): spec is NativeModulationSpec {
  return NATIVE_TYPES.has(spec.type);
}
export type NativeDestination = {
  id: string;
  source: string;
  soundId: string;
  target: EffectParamTarget;
  depth: number;
  enabled: boolean;
  native?: boolean;
};
type Entry = {
  box: ModulatorBox;
  spec: NativeModulationSpec;
  subscription: Subscription;
  amount?: number;
};
type Assignment = { box: ModulationBox; field: NativeField; source: string };

/** Sources belong to the patch; assignments belong to their live effect endpoints. */
export function createNativeModulationSession(
  host: ModulationHost,
  onValue: (id: string, value: number, position: number) => void
) {
  const { project, transaction } = host;
  const releaseOutput = host.retainOutput();
  const sources = new Map<string, Entry>();
  const assignments = new Map<string, Assignment>();
  let destinations: readonly NativeDestination[] = [];
  let disposed = false;
  const observe = (id: string, box: ModulatorBox) =>
    project.liveStreamReceiver.subscribeFloats(
      box.address,
      ([position, value]) => {
        if (!disposed && value !== undefined && Number.isFinite(value)) {
          onValue(id, value, position ?? 0);
        }
      }
    );
  const removeSource = (id: string, entry: Entry) => {
    try {
      entry.subscription.terminate();
    } finally {
      if (entry.box.isAttached()) {
        project.api.modulation.delete(entry.box);
      }
      sources.delete(id);
    }
  };
  const detach = (id: string) => {
    const assignment = assignments.get(id);
    if (assignment?.box.isAttached()) {
      assignment.box.delete();
    }
    assignments.delete(id);
  };
  const bindDestination = (destination: NativeDestination) => {
    const source = sources.get(destination.source);
    const field = host.field(destination.soundId, destination.target);
    if (
      !(
        source &&
        field &&
        destination.native !== false &&
        destination.enabled &&
        source.spec.data.enabled &&
        destination.depth !== 0
      )
    ) {
      detach(destination.id);
      return;
    }
    let assignment = assignments.get(destination.id);
    // Deleting an endpoint can cascade-delete its assignment before a rebind.
    if (assignment && !assignment.box.isAttached()) {
      assignments.delete(destination.id);
      assignment = undefined;
    }
    if (assignment) {
      if (assignment.field !== field) {
        assignment.box.target.refer(field);
      }
      assignment.box.source.refer(source.box.assignments);
      assignment.box.depth.setValue(destination.depth);
      assignment.field = field;
      assignment.source = destination.source;
    } else {
      assignments.set(destination.id, {
        box: project.api.modulation.assign(
          source.box,
          field,
          destination.depth
        ),
        field,
        source: destination.source,
      });
    }
  };
  const bind = () => {
    const wanted = new Set(destinations.map((destination) => destination.id));
    for (const id of assignments.keys()) {
      if (!wanted.has(id)) {
        detach(id);
      }
    }
    for (const destination of destinations) {
      bindDestination(destination);
    }
  };
  const unsubscribe = host.onEndpointsChanged(() => {
    if (!disposed) {
      transaction(bind);
    }
  });
  const syncSource = (spec: NativeModulationSpec) => {
    let entry = sources.get(spec.id);
    if (entry && entry.spec.type !== spec.type) {
      removeSource(spec.id, entry);
      entry = undefined;
    }
    if (!entry) {
      const box = createSource(project, spec);
      entry = { box, spec, subscription: observe(spec.id, box) };
      sources.set(spec.id, entry);
    }
    if (!hasAmountEnvelope(spec)) {
      entry.amount = undefined;
    }
    updateSource(entry.box, spec, entry.amount);
    entry.spec = spec;
  };
  return {
    dispatch() {
      if (!disposed) {
        project.liveStreamReceiver.dispatch();
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      const errors: unknown[] = [];
      const release = (cleanup: () => void) => {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      };
      release(unsubscribe);
      release(releaseOutput);
      transaction(() => {
        for (const id of assignments.keys()) {
          release(() => detach(id));
        }
        for (const [id, entry] of sources) {
          release(() => removeSource(id, entry));
        }
      });
      if (errors.length > 0) {
        throw new AggregateError(errors, "Native modulation cleanup failed");
      }
    },
    frame(
      values: Readonly<Record<string, number>>,
      amounts: Readonly<Record<string, number>> = {},
      coupled: readonly (() => void)[] = []
    ) {
      if (disposed) {
        return;
      }
      const updates: (() => void)[] = [...coupled];
      for (const [id, value] of Object.entries(values)) {
        const entry = sources.get(id);
        if (entry?.spec.type === "macro") {
          entry.box.accept({
            visitMacroModulatorBox: (macro) => {
              const encoded = ValueMapping.bipolar().x(value);
              if (macro.value.getValue() !== encoded) {
                updates.push(() => {
                  macro.value.setValue(encoded);
                });
              }
            },
          });
        }
      }
      for (const [id, amount] of Object.entries(amounts)) {
        const entry = sources.get(id);
        if (entry?.spec.type !== "lfo" || !hasAmountEnvelope(entry.spec)) {
          continue;
        }
        entry.amount = amount;
        const { box, spec } = entry;
        if (
          box.amount.getValue() !== amount ||
          box.enabled.getValue() !== spec.data.enabled
        ) {
          updates.push(() => {
            box.amount.setValue(amount);
            box.enabled.setValue(spec.data.enabled);
          });
        }
      }
      if (updates.length === 0) {
        return;
      }
      transaction(() => {
        for (const update of updates) {
          update();
        }
      });
    },
    reset(id: string) {
      const entry = sources.get(id);
      if (!(entry && !disposed) || entry.spec.type === "macro") {
        return;
      }
      transaction(() => {
        const replacement = createSource(project, entry.spec);
        entry.amount = undefined;
        updateSource(replacement, entry.spec);
        replacement.index.setValue(entry.box.index.getValue());
        for (const assignment of assignments.values()) {
          if (assignment.source === id && assignment.box.isAttached()) {
            assignment.box.source.refer(replacement.assignments);
          }
        }
        entry.subscription.terminate();
        project.api.modulation.delete(entry.box);
        entry.box = replacement;
        entry.subscription = observe(id, replacement);
      });
    },
    sync(
      nodes: readonly NativeModulationSpec[],
      next: readonly NativeDestination[] = destinations
    ) {
      if (disposed) {
        return;
      }
      destinations = next;
      transaction(() => {
        const wanted = new Set(nodes.map((spec) => spec.id));
        for (const [id, entry] of sources) {
          if (!wanted.has(id)) {
            removeSource(id, entry);
          }
        }
        for (const spec of nodes) {
          syncSource(spec);
        }
        bind();
      });
      project.engine.wake();
    },
  };
}
export type NativeModulationSession = ReturnType<
  typeof createNativeModulationSession
>;
function createSource(
  project: Project,
  spec: NativeModulationSpec
): ModulatorBox {
  switch (spec.type) {
    case "lfo":
      return project.api.modulation.createLfo(spec.id);
    case "steps":
      return project.api.modulation.createSteps(spec.id);
    case "randomiser":
      return project.api.modulation.createRandom(spec.id);
    case "macro":
      return project.api.modulation.createMacro(spec.id);
    default: {
      const exhaustive: never = spec;
      throw new Error(`Unknown modulator ${String(exhaustive)}`);
    }
  }
}
function enumName(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function hasAmountEnvelope(spec: NativeModulationSpec): boolean {
  return spec.type === "lfo" && (spec.data.delay > 0 || spec.data.fade > 0);
}

function updateSource(
  box: ModulatorBox,
  spec: NativeModulationSpec,
  amount?: number
): void {
  // An extended LFO stays silent until the worklet supplies its effective amount.
  box.enabled.setValue(
    spec.data.enabled && (!hasAmountEnvelope(spec) || amount !== undefined)
  );
  box.bipolar.setValue(spec.data.bipolar);
  if (spec.type !== "lfo" || (spec.data.delay === 0 && spec.data.fade === 0)) {
    box.amount.setValue(spec.data.amount);
  }
  switch (spec.type) {
    case "macro":
      box.accept({
        visitMacroModulatorBox: (macro) =>
          macro.value.setValue(spec.data.value),
      });
      break;
    case "lfo":
      box.accept({
        visitLfoModulatorBox: (lfo) => {
          lfo.rateSync.setValue(0);
          lfo.rateAbsolute.setValue(modulationFrequency(spec.data));
          lfo.phase.setValue(spec.data.phase);
          lfo.exponent.setValue(spec.data.bend);
          lfo.shape.setValue(
            LfoShape[enumName(spec.data.shape) as keyof typeof LfoShape]
          );
        },
      });
      break;
    case "steps":
      box.accept({
        visitStepsModulatorBox: (steps) => {
          steps.rateSync.setValue(0);
          steps.rateAbsolute.setValue(modulationFrequency(spec.data));
          steps.phase.setValue(spec.data.phase);
          steps.smooth.setValue(spec.data.smooth);
          steps.count.setValue(spec.data.values.length);
          steps.direction.setValue(
            StepsDirection[
              enumName(spec.data.direction) as keyof typeof StepsDirection
            ]
          );
          steps.steps.fields().forEach((field, index) => {
            field.setValue(spec.data.values[index] ?? 0);
          });
        },
      });
      break;
    case "randomiser":
      box.accept({
        visitRandomModulatorBox: (random) => {
          random.rateSync.setValue(0);
          random.rateAbsolute.setValue(modulationFrequency(spec.data));
          random.phase.setValue(spec.data.phase);
          random.smooth.setValue(spec.data.smooth);
          random.seed.setValue(spec.data.seed);
          random.loop.setValue(spec.data.loop);
          random.levels.setValue(spec.data.levels);
        },
      });
      break;
    default: {
      const exhaustive: never = spec;
      throw new Error(`Unknown modulator ${String(exhaustive)}`);
    }
  }
}
