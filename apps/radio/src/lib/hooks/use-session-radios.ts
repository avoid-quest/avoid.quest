import { useRef, useSyncExternalStore } from "react";
import type { Radio } from "@/lib/audio";
import {
  addSessionRadio,
  getSessionRadios,
  removeSessionRadio,
  sessionRadiosCollection,
} from "@/lib/collections/session-radios";

export {
  addSessionRadio,
  getSessionRadios,
  isSessionRadio,
  removeSessionRadio,
  sessionRadiosCollection,
} from "@/lib/collections/session-radios";

type SessionRadiosState = {
  radios: Radio[];
  addSessionRadio: (radio: Radio) => void;
  removeSessionRadio: (id: string | number) => void;
  getSessionRadios: () => Radio[];
};

function buildSessionRadiosState(radios: Radio[]): SessionRadiosState {
  return {
    addSessionRadio,
    getSessionRadios,
    radios,
    removeSessionRadio,
  };
}

let cachedState = buildSessionRadiosState([]);
function getSnapshot(): SessionRadiosState {
  const radios = getSessionRadios();
  if (
    radios.length !== cachedState.radios.length ||
    radios.some((radio, index) => radio !== cachedState.radios[index])
  ) {
    cachedState = buildSessionRadiosState(radios);
  }
  return cachedState;
}

function subscribe(onChange: () => void) {
  const subscription = sessionRadiosCollection.subscribeChanges(onChange);
  return () => subscription.unsubscribe();
}

type UseSessionRadios = {
  (): SessionRadiosState;
  <T>(
    selector: (state: SessionRadiosState) => T,
    equal?: (a: T, b: T) => boolean
  ): T;
  getState: () => SessionRadiosState;
};

function useSessionRadiosSelector<T = SessionRadiosState>(
  selector?: (state: SessionRadiosState) => T,
  equal: (
    a: T | SessionRadiosState,
    b: T | SessionRadiosState
  ) => boolean = Object.is
): SessionRadiosState | T {
  const cached = useRef<{ value: T | SessionRadiosState } | null>(null);
  const selectSnapshot = () => {
    const state = getSnapshot();
    const value = selector ? selector(state) : state;
    if (!(cached.current && equal(cached.current.value, value))) {
      cached.current = { value };
    }
    return cached.current.value;
  };
  return useSyncExternalStore(subscribe, selectSnapshot, selectSnapshot);
}

export function useSessionRadiosData() {
  return useSessionRadiosSelector((state) => state.radios) as Radio[];
}

export const useSessionRadios = Object.assign(
  useSessionRadiosSelector as UseSessionRadios,
  { getState: getSnapshot }
);
