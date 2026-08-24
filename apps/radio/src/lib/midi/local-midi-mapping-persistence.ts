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
      const value = localStorage.getItem(MIDI_MAPPING_STORAGE_KEY);
      if (!value) {
        return null;
      }
      try {
        return JSON.parse(value) as PersistedMidiControl;
      } catch {
        return null;
      }
    },
    write(value) {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(MIDI_MAPPING_STORAGE_KEY, JSON.stringify(value));
      }
    },
  };
}
