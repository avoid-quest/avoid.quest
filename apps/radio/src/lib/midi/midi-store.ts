/**
 * MIDI Store
 *
 * Zustand store with localStorage persistence for MIDI mappings and preferences.
 * Single source of truth for learn state, device info, and derived lookup indices.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getMidiPresetById } from "./presets";
import type {
  MidiDeviceInfo,
  MidiMapping,
  MidiMessageType,
  MidiTargetId,
  MidiTransform,
} from "./types";

/** Build key for O(1) controller dispatch lookup */
function mappingKey(
  channel: number,
  control: number,
  type: MidiMessageType
): string {
  return `${channel}:${control}:${type}`;
}

/** Rebuild both derived indices from a mappings array */
function rebuildIndices(mappings: MidiMapping[]): {
  mappingsByTarget: Map<MidiTargetId, MidiMapping>;
  mappingsByKey: Map<string, MidiMapping>;
} {
  const mappingsByTarget = new Map<MidiTargetId, MidiMapping>();
  const mappingsByKey = new Map<string, MidiMapping>();
  for (const m of mappings) {
    mappingsByTarget.set(m.targetId, m);
    mappingsByKey.set(mappingKey(m.channel, m.control, m.type), m);
  }
  return { mappingsByTarget, mappingsByKey };
}

type MidiState = {
  // Persisted
  mappings: MidiMapping[];
  activePresetId: string | null;
  enabled: boolean;
  // Transient — derived indices (rebuilt from mappings)
  mappingsByTarget: Map<MidiTargetId, MidiMapping>;
  mappingsByKey: Map<string, MidiMapping>;
  // Transient — learn mode
  learningTarget: MidiTargetId | null;
  // Transient — device info
  devices: MidiDeviceInfo[];
  isSupported: boolean;
  isConnected: boolean;
};

type MidiActions = {
  setMappings: (mappings: MidiMapping[]) => void;
  addMapping: (mapping: MidiMapping) => void;
  removeMapping: (targetId: MidiTargetId) => void;
  removeEffectMappings: (effectId: string) => void;
  updateMappingTransform: (
    targetId: MidiTargetId,
    transform: Partial<MidiTransform>
  ) => void;
  setActivePreset: (presetId: string | null) => void;
  setEnabled: (enabled: boolean) => void;
  startLearn: (targetId: MidiTargetId) => void;
  stopLearn: () => void;
  loadPreset: (presetId: string) => void;
  clearMappings: () => void;
  setDevices: (devices: MidiDeviceInfo[]) => void;
  setIsSupported: (isSupported: boolean) => void;
  reset: () => void;
};

const EMPTY_TARGET_MAP = new Map<MidiTargetId, MidiMapping>();
const EMPTY_KEY_MAP = new Map<string, MidiMapping>();

const initialState: MidiState = {
  mappings: [],
  activePresetId: null,
  enabled: true,
  mappingsByTarget: EMPTY_TARGET_MAP,
  mappingsByKey: EMPTY_KEY_MAP,
  learningTarget: null,
  devices: [],
  isSupported: false,
  isConnected: false,
};

/** Migrate v1 (actionId) -> v2 (targetId) */
function migrateV1ToV2(
  persisted: Record<string, unknown>
): Record<string, unknown> {
  const mappings = persisted.mappings;
  if (!Array.isArray(mappings)) {
    return persisted;
  }

  const ID_MAP: Record<string, string> = {
    "deck-a:play": "deck-a:play-pause",
    "deck-a:pause": "",
    "deck-b:play": "deck-b:play-pause",
    "deck-b:pause": "",
    "deck-a:pitch": "deck-a:speed",
    "deck-b:pitch": "deck-b:speed",
    "deck-a:effect-drywet": "deck-a:effects-drywet",
    "deck-b:effect-drywet": "deck-b:effects-drywet",
    crossfader: "mixer:crossfader",
    "master-volume": "mixer:master-volume",
    "headphone-volume": "mixer:headphone-volume",
  };

  const migrated = mappings
    .map((m: Record<string, unknown>) => {
      const oldId = (m.actionId ?? m.targetId) as string;
      const newId = ID_MAP[oldId] ?? oldId;
      // Drop entries mapped to empty string (removed actions like pause)
      if (!newId) {
        return null;
      }
      return {
        channel: m.channel,
        control: m.control,
        type: m.type,
        targetId: newId,
        ...(m.transform ? { transform: m.transform } : {}),
      };
    })
    .filter(Boolean);

  return { ...persisted, mappings: migrated };
}

/** Helper: set mappings + rebuild indices */
function setMappingsWithIndices(mappings: MidiMapping[]) {
  return { mappings, ...rebuildIndices(mappings) };
}

export const useMidiStore = create<MidiState & MidiActions>()(
  persist(
    (set) => ({
      ...initialState,

      setMappings: (mappings) =>
        set({ ...setMappingsWithIndices(mappings), activePresetId: null }),

      addMapping: (mapping) =>
        set((state) => {
          const next = [
            ...state.mappings.filter((m) => m.targetId !== mapping.targetId),
            mapping,
          ];
          return { ...setMappingsWithIndices(next), activePresetId: null };
        }),

      removeMapping: (targetId) =>
        set((state) => {
          const next = state.mappings.filter((m) => m.targetId !== targetId);
          return { ...setMappingsWithIndices(next), activePresetId: null };
        }),

      removeEffectMappings: (effectId) =>
        set((state) => {
          const next = state.mappings.filter(
            (m) => !m.targetId.includes(`:effect:${effectId}:`)
          );
          return setMappingsWithIndices(next);
        }),

      updateMappingTransform: (targetId, transform) =>
        set((state) => {
          const next = state.mappings.map((m) => {
            if (m.targetId !== targetId) {
              return m;
            }
            return {
              ...m,
              transform: {
                ...(m.transform ?? {}),
                ...transform,
              } as MidiTransform,
            };
          });
          return setMappingsWithIndices(next);
        }),

      setActivePreset: (presetId) => set({ activePresetId: presetId }),

      setEnabled: (enabled) => set({ enabled }),

      startLearn: (targetId) => set({ learningTarget: targetId }),

      stopLearn: () => set({ learningTarget: null }),

      loadPreset: (presetId) => {
        const preset = getMidiPresetById(presetId);
        if (preset) {
          set({
            ...setMappingsWithIndices(preset.mappings),
            activePresetId: presetId,
          });
        }
      },

      clearMappings: () =>
        set({
          ...setMappingsWithIndices([]),
          activePresetId: null,
        }),

      setDevices: (devices) =>
        set({
          devices,
          isConnected: devices.some((d) => d.state === "connected"),
        }),

      setIsSupported: (isSupported) => set({ isSupported }),

      reset: () => set(initialState),
    }),
    {
      name: "radio-midi-mappings",
      version: 2,
      migrate: (persisted, version) => {
        if (version < 2) {
          return migrateV1ToV2(
            persisted as Record<string, unknown>
          ) as MidiState & MidiActions;
        }
        return persisted as MidiState & MidiActions;
      },
      partialize: (state) => ({
        mappings: state.mappings,
        activePresetId: state.activePresetId,
        enabled: state.enabled,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const indices = rebuildIndices(state.mappings);
          state.mappingsByTarget = indices.mappingsByTarget;
          state.mappingsByKey = indices.mappingsByKey;
        }
      },
    }
  )
);

export { mappingKey };
