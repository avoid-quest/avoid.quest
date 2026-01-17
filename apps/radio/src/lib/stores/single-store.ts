import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Radio } from "@/lib/audio";

type SingleState = {
  radio: Radio | null;
  volume: number;
  transitionDuration: number;
  setRadio: (radio: Radio | null) => void;
  setVolume: (volume: number) => void;
  setTransitionDuration: (ms: number) => void;
};

export const useSingleStore = create<SingleState>()(
  persist(
    (set) => ({
      radio: null,
      volume: 1,
      transitionDuration: 2000,
      setRadio: (radio) => set({ radio }),
      setVolume: (volume) => set({ volume }),
      setTransitionDuration: (ms) => set({ transitionDuration: ms }),
    }),
    {
      name: "radio-single-store",
      skipHydration: true,
    }
  )
);
