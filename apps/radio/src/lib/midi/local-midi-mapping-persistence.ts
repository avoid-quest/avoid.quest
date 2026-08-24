import type {
  MidiMappingPersistence,
  PersistedMidiControl,
} from "./midi-control";
import type { MidiMapping, MidiTransform } from "./types";

export const MIDI_MAPPING_STORAGE_KEY = "radio-midi-mappings";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMidiTransform(value: unknown): value is MidiTransform {
  return (
    isRecord(value) &&
    typeof value.invert === "boolean" &&
    typeof value.min === "number" &&
    typeof value.max === "number" &&
    (value.curve === "linear" || value.curve === "log" || value.curve === "exp")
  );
}

function isMidiMapping(value: unknown): value is MidiMapping {
  return (
    isRecord(value) &&
    typeof value.channel === "number" &&
    typeof value.control === "number" &&
    typeof value.targetId === "string" &&
    (value.type === "cc" || value.type === "note") &&
    (value.transform === undefined || isMidiTransform(value.transform))
  );
}

function isPersistedMidiControl(value: unknown): value is PersistedMidiControl {
  if (!(isRecord(value) && isRecord(value.state))) {
    return false;
  }
  const { state } = value;
  return (
    typeof value.version === "number" &&
    (state.activePresetId === null ||
      typeof state.activePresetId === "string") &&
    typeof state.enabled === "boolean" &&
    Array.isArray(state.mappings) &&
    state.mappings.every(value.version < 2 ? isRecord : isMidiMapping)
  );
}

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
        const parsed: unknown = JSON.parse(value);
        return isPersistedMidiControl(parsed) ? parsed : null;
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
