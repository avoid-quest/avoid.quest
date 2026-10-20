import { createBrowserMidiAdapter } from "./browser-midi-adapter";
import { createLocalMidiMappingPersistence } from "./local-midi-mapping-persistence";
import { createMidiControl, type MidiControl } from "./midi-control";
import { createStaticMidiActions } from "./static-actions";

let defaultMidiControl: MidiControl | null = null;
let dispatchEpoch = 0;

type MidiRuntime = {
  actions: typeof import("@/lib/dj-actions");
  decks: typeof import("@/lib/dj-deck");
};
let runtime: MidiRuntime | undefined;
let runtimePromise: Promise<MidiRuntime> | undefined;

/** Permission/device observation must not import the DJ/audio runtime. */
export function preloadMidiRuntime(): Promise<MidiRuntime> {
  runtimePromise ??= Promise.all([
    import("@/lib/dj-actions"),
    import("@/lib/dj-deck"),
  ])
    .then(([actions, decks]) => {
      runtime = { actions, decks };
      return runtime;
    })
    .catch((error: unknown) => {
      runtimePromise = undefined;
      throw error;
    });
  return runtimePromise;
}

function requireRuntime(): MidiRuntime {
  if (!runtime) {
    throw new Error("MIDI runtime is not ready");
  }
  return runtime;
}

export function getMidiControl(): MidiControl {
  if (!defaultMidiControl) {
    const control = createMidiControl({
      browser: createBrowserMidiAdapter(),
      effects: {
        change: (...args) => {
          const epoch = dispatchEpoch;
          return import("@/lib/channel-effects").then(({ channelEffects }) => {
            const snapshot = defaultMidiControl?.getSnapshot();
            if (
              !(snapshot?.djActive && snapshot.enabled) ||
              epoch !== dispatchEpoch
            ) {
              throw new Error("MIDI DJ controls are no longer active");
            }
            return channelEffects.change(...args);
          });
        },
      },
      persistence: createLocalMidiMappingPersistence(),
      staticActions: createStaticMidiActions({
        decks: {
          deck: (deckId) =>
            requireRuntime().decks.getDjDeckModule().deck(deckId),
        },
        setCrossfadePosition: (value) =>
          requireRuntime().actions.setCrossfadePosition(value),
        setHeadphoneVolume: (value) =>
          requireRuntime().actions.setHeadphoneVolume(value),
        setMasterVolume: (value) =>
          requireRuntime().actions.setMasterVolume(value),
      }).map((action) => ({
        ...action,
        dispatch(value) {
          if (runtime) {
            action.dispatch(value);
            return;
          }
          const epoch = dispatchEpoch;
          preloadMidiRuntime()
            .then(() => {
              const snapshot = defaultMidiControl?.getSnapshot();
              if (
                snapshot?.djActive &&
                snapshot.enabled &&
                epoch === dispatchEpoch
              ) {
                action.dispatch(value);
              }
            })
            .catch((error: unknown) => {
              console.error("[midi] Failed to load MIDI action:", error);
            });
        },
      })),
    });
    defaultMidiControl = {
      ...control,
      activateDj() {
        dispatchEpoch += 1;
        const deactivate = control.activateDj();
        return () => {
          dispatchEpoch += 1;
          deactivate();
        };
      },
      cleanup() {
        dispatchEpoch += 1;
        control.cleanup();
      },
    };
  }
  return defaultMidiControl;
}

export type {
  MidiActionDescriptor,
  MidiControl,
  MidiControlChange,
  MidiControlSnapshot,
} from "./midi-control";
export {
  getMidiPresetById,
  MIDI_PRESETS,
  type MidiPreset,
} from "./presets";
export {
  DEFAULT_TRANSFORM,
  type MidiDeviceInfo,
  type MidiMapping,
  type MidiMessageType,
  type MidiTargetId,
  type MidiTransform,
} from "./types";
