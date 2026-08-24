import type {
  MidiMappingPersistence,
  PersistedMidiControl,
} from "./midi-control";

export const MIDI_MAPPING_STORAGE_KEY = "radio-midi-mappings";

export function createLocalMidiMappingPersistence(): MidiMappingPersistence {
  return {
    read() {
      if (typeof localStorage === "undefined") {
        return null;
      }
      try {
        const value = localStorage.getItem(MIDI_MAPPING_STORAGE_KEY);
        if (!value) {
          return null;
        }
        return JSON.parse(value) as PersistedMidiControl;
      } catch {
        return null;
      }
    },
    write(value) {
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(MIDI_MAPPING_STORAGE_KEY, JSON.stringify(value));
        }
      } catch {
        // Mapping updates remain usable when browser storage is unavailable.
      }
    },
  };
}
