import type {
  MidiMappingPersistence,
  PersistedMidiControl,
} from "./midi-control";
import {
  DEFAULT_TRANSFORM,
  type MidiMapping,
  type MidiTransform,
} from "./types";

export const MIDI_MAPPING_STORAGE_KEY = "radio-midi-mappings";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type StoredMidiMapping = Omit<MidiMapping, "transform"> & {
  transform?: Partial<MidiTransform>;
};

function isMidiTransform(value: unknown): value is Partial<MidiTransform> {
  return (
    isRecord(value) &&
    (value.invert === undefined || typeof value.invert === "boolean") &&
    (value.min === undefined || typeof value.min === "number") &&
    (value.max === undefined || typeof value.max === "number") &&
    (value.curve === undefined ||
      value.curve === "linear" ||
      value.curve === "log" ||
      value.curve === "exp")
  );
}

function isMidiMapping(value: unknown): value is StoredMidiMapping {
  return (
    isRecord(value) &&
    typeof value.channel === "number" &&
    typeof value.control === "number" &&
    typeof value.targetId === "string" &&
    (value.type === "cc" || value.type === "note") &&
    (value.transform === undefined || isMidiTransform(value.transform))
  );
}

function parsePersistedMidiControl(
  value: unknown
): PersistedMidiControl | null {
  if (!(isRecord(value) && isRecord(value.state))) {
    return null;
  }
  const { state } = value;
  if (
    !(
      typeof value.version === "number" &&
      (state.activePresetId === null ||
        typeof state.activePresetId === "string") &&
      typeof state.enabled === "boolean" &&
      Array.isArray(state.mappings) &&
      state.mappings.every(value.version < 2 ? isRecord : isMidiMapping)
    )
  ) {
    return null;
  }
  if (value.version < 2) {
    return value as unknown as PersistedMidiControl;
  }
  const mappings = state.mappings as StoredMidiMapping[];
  return {
    state: {
      activePresetId: state.activePresetId,
      enabled: state.enabled,
      mappings: mappings.map(({ transform, ...mapping }) => ({
        ...mapping,
        ...(transform
          ? { transform: { ...DEFAULT_TRANSFORM, ...transform } }
          : {}),
      })),
    },
    version: value.version,
  };
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
        return parsePersistedMidiControl(parsed);
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
