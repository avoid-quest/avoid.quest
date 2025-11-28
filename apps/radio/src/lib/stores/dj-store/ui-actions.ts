import type { StateCreator } from "zustand";
import type { InternalDjState } from "./types";

export const createUiActions: StateCreator<
  InternalDjState,
  [],
  [],
  Pick<InternalDjState, "setActiveDragRadio" | "setPendingPlatformItem">
> = (set) => ({
  setActiveDragRadio: (radio) => {
    set((state) => ({
      ui: { ...state.ui, activeDragRadio: radio },
    }));
  },

  setPendingPlatformItem: (item) => {
    set((state) => ({
      ui: { ...state.ui, pendingPlatformItem: item },
    }));
  },
});
