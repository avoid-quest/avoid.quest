import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Radio } from "@/lib/audio";

export function isSessionRadio(radio: Radio): boolean {
  if (!radio.id) {
    return false;
  }
  return String(radio.id).startsWith("rg_");
}

const MAX_SESSION_RADIOS = 20;

type SessionRadiosState = {
  radios: Radio[];
  addSessionRadio: (radio: Radio) => void;
  removeSessionRadio: (id: string | number) => void;
  getSessionRadios: () => Radio[];
};

export const useSessionRadios = create<SessionRadiosState>()(
  persist(
    (set, get) => ({
      radios: [],
      addSessionRadio: (radio) =>
        set((state) => {
          // Don't add duplicates
          if (state.radios.some((r) => r.id === radio.id)) {
            return state;
          }
          const updated = [radio, ...state.radios];
          // FIFO eviction
          if (updated.length > MAX_SESSION_RADIOS) {
            updated.pop();
          }
          return { radios: updated };
        }),
      removeSessionRadio: (id) =>
        set((state) => ({
          radios: state.radios.filter((r) => r.id !== id),
        })),
      getSessionRadios: () => get().radios,
    }),
    {
      name: "radio-session-radios",
      storage: {
        getItem: (name) => {
          const value = sessionStorage.getItem(name);
          return value ? JSON.parse(value) : null;
        },
        setItem: (name, value) => {
          sessionStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          sessionStorage.removeItem(name);
        },
      },
    }
  )
);
