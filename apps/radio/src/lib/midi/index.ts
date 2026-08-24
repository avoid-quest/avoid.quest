import { channelEffects } from "@/lib/channel-effects";
import { setCrossfadePosition, setMasterVolume } from "@/lib/dj-actions";
import { getDjDeckModule } from "@/lib/dj-deck";
import { getOutputRouting } from "@/lib/output-routing";
import { createBrowserMidiAdapter } from "./browser-midi-adapter";
import { createLocalMidiMappingPersistence } from "./local-midi-mapping-persistence";
import { createMidiControl, type MidiControl } from "./midi-control";
import { createStaticMidiActions } from "./static-actions";

let defaultMidiControl: MidiControl | null = null;

export function getMidiControl(): MidiControl {
  if (!defaultMidiControl) {
    const output = getOutputRouting();
    defaultMidiControl = createMidiControl({
      browser: createBrowserMidiAdapter(),
      effects: channelEffects,
      persistence: createLocalMidiMappingPersistence(),
      staticActions: createStaticMidiActions({
        decks: { deck: (deckId) => getDjDeckModule().deck(deckId) },
        output,
        setCrossfadePosition,
        setMasterVolume,
      }),
    });
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
