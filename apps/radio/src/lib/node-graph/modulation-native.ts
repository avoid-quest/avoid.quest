import type { Subscription } from "@opendaw/lib-std";
import type { ModulatorBox } from "@opendaw/studio-adapters";
import type { Project } from "@opendaw/studio-core";
import { type ModulationProgram, modulationFrequency } from "./modulation-dsp";
import type { ModulationSpec } from "./modulation-schema";

export type NativeModulationSpec = Extract<
  ModulationSpec,
  { type: "lfo" | "steps" | "randomiser" | "macro" }
>;

/** Reset inputs and delayed fades are Radio extensions to the native globals. */
export function nativeModulationNodes(
  program: ModulationProgram,
  resetSources: ReadonlySet<string>
): NativeModulationSpec[] {
  const gated = new Set(program.links.map((link) => link.target));
  return program.nodes.filter((spec): spec is NativeModulationSpec => {
    if (gated.has(spec.id) || resetSources.has(spec.id)) {
      return false;
    }
    switch (spec.type) {
      case "lfo":
        return spec.data.delay === 0 && spec.data.fade === 0;
      case "steps":
        // Native Steps random order has no editable seed.
        return spec.data.direction !== "random" || spec.data.seed === 1;
      case "macro":
      case "randomiser":
        return true;
      default:
        return false;
    }
  });
}

export type NativeModulationSession = {
  sync: (nodes: readonly NativeModulationSpec[]) => void;
  dispatch: () => void;
  dispose: () => void;
};

type Entry = {
  box: ModulatorBox;
  type: NativeModulationSpec["type"];
  settings: string;
  subscription: Subscription;
};

/** Owns only its source boxes; the AudioManager continues to own the shared Project. */
export function createNativeModulationSession(
  project: Project,
  onValue: (id: string, value: number) => void
): NativeModulationSession {
  const entries = new Map<string, Entry>();
  let disposed = false;
  const transaction = (update: () => void) => {
    project.boxGraph.beginTransaction();
    try {
      update();
      project.boxGraph.endTransaction();
    } catch (error) {
      if (project.boxGraph.inTransaction()) {
        project.boxGraph.abortTransaction();
      }
      throw error;
    }
  };
  const remove = (id: string, entry: Entry) => {
    entry.subscription.terminate();
    project.api.modulation.delete(entry.box);
    entries.delete(id);
  };
  const syncSource = (spec: NativeModulationSpec, index: number) => {
    let existing = entries.get(spec.id);
    if (existing && existing.type !== spec.type) {
      remove(spec.id, existing);
      existing = undefined;
    }
    const settings = JSON.stringify(spec.data);
    if (existing) {
      existing.box.index.setValue(index);
      if (existing.settings !== settings) {
        updateSource(existing.box, spec);
        existing.settings = settings;
      }
      return;
    }
    const box = createSource(project, spec);
    box.index.setValue(index);
    updateSource(box, spec);
    const subscription = project.liveStreamReceiver.subscribeFloats(
      box.address,
      ([, value]) => {
        // Native telemetry publishes [playhead, emitted output].
        if (!disposed && value !== undefined && Number.isFinite(value)) {
          onValue(spec.id, value);
        }
      }
    );
    entries.set(spec.id, { box, settings, subscription, type: spec.type });
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
      transaction(() => {
        for (const [id, entry] of entries) {
          remove(id, entry);
        }
      });
    },
    sync(nodes) {
      if (disposed) {
        return;
      }
      const ids = new Set(nodes.map((spec) => spec.id));
      transaction(() => {
        for (const [id, entry] of entries) {
          if (!ids.has(id)) {
            remove(id, entry);
          }
        }
        nodes.forEach(syncSource);
      });
    },
  };
}

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
    default:
      throw new Error("Unknown native modulator");
  }
}

function updateSource(box: ModulatorBox, spec: NativeModulationSpec): void {
  box.enabled.setValue(spec.data.enabled);
  box.bipolar.setValue(spec.data.bipolar);
  box.amount.setValue(spec.data.amount);
  if (spec.type === "macro") {
    box.accept({
      visitMacroModulatorBox: (macro) => macro.value.setValue(spec.data.value),
    });
    return;
  }
  // Each Node has its own BPM. Feed the integrated native free clock its total
  // frequency instead of changing the shared Project/FX tempo for every source.
  const frequency = modulationFrequency(spec.data);
  switch (spec.type) {
    case "lfo":
      box.accept({
        visitLfoModulatorBox: (lfo) => {
          lfo.rateSync.setValue(0);
          lfo.rateAbsolute.setValue(frequency);
          lfo.phase.setValue(spec.data.phase);
          lfo.exponent.setValue(spec.data.bend);
          lfo.shape.setValue(
            ["sine", "triangle", "sawUp", "sawDown", "square"].indexOf(
              spec.data.shape
            )
          );
        },
      });
      break;
    case "steps":
      box.accept({
        visitStepsModulatorBox: (steps) => {
          steps.rateSync.setValue(0);
          steps.rateAbsolute.setValue(frequency);
          steps.phase.setValue(spec.data.phase);
          steps.smooth.setValue(spec.data.smooth);
          steps.count.setValue(spec.data.values.length);
          steps.direction.setValue(
            ["forward", "backward", "pingPong", "alternate", "random"].indexOf(
              spec.data.direction
            )
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
          random.rateAbsolute.setValue(frequency);
          random.phase.setValue(spec.data.phase);
          random.smooth.setValue(spec.data.smooth);
          random.seed.setValue(spec.data.seed);
          random.loop.setValue(spec.data.loop);
          random.levels.setValue(spec.data.levels);
        },
      });
      break;
    default:
      break;
  }
}
