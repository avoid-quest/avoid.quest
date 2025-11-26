import type { StateCreator } from "zustand";
import type { DjState } from "./types";

export const createUiActions: StateCreator<
  DjState,
  [],
  [],
  Pick<DjState, "setActiveDragRadio" | "setPendingPlatformItem">
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
