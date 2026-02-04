/**
 * MIDI Store
 *
 * Zustand store with localStorage persistence for MIDI mappings and preferences.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MidiMapping } from "./midi-controller";

type MidiState = {
  mappings: MidiMapping[];
  activePresetId: string | null;
  enabled: boolean;
};

type MidiActions = {
  setMappings: (mappings: MidiMapping[]) => void;
  addMapping: (mapping: MidiMapping) => void;
  removeMapping: (actionId: string) => void;
  setActivePreset: (presetId: string | null) => void;
  setEnabled: (enabled: boolean) => void;
  reset: () => void;
};

const initialState: MidiState = {
  mappings: [],
  activePresetId: null,
  enabled: true,
};

export const useMidiStore = create<MidiState & MidiActions>()(
  persist(
    (set) => ({
      ...initialState,

      setMappings: (mappings) => set({ mappings, activePresetId: null }),

      addMapping: (mapping) =>
        set((state) => ({
          // Replace existing mapping for the same action
          mappings: [
            ...state.mappings.filter((m) => m.actionId !== mapping.actionId),
            mapping,
          ],
          activePresetId: null,
        })),

      removeMapping: (actionId) =>
        set((state) => ({
          mappings: state.mappings.filter((m) => m.actionId !== actionId),
          activePresetId: null,
        })),

      setActivePreset: (presetId) => set({ activePresetId: presetId }),

      setEnabled: (enabled) => set({ enabled }),

      reset: () => set(initialState),
    }),
    {
      name: "radio-midi-mappings",
    }
  )
);
