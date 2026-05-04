import { useLiveQuery } from "@tanstack/react-db";
import type { Radio } from "@/lib/audio";
import {
  addSessionRadio,
  getSessionRadios,
  removeSessionRadio,
  sessionRadiosCollection,
  toSessionRadio,
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
    radios,
    addSessionRadio,
    removeSessionRadio,
    getSessionRadios,
  };
}

type UseSessionRadios = {
  (): SessionRadiosState;
  <T>(selector: (state: SessionRadiosState) => T): T;
  getState: () => SessionRadiosState;
};

const useSessionRadiosSelector = <T>(
  selector?: (state: SessionRadiosState) => T
): SessionRadiosState | T => {
  const result = useLiveQuery((q) =>
    q
      .from({ radio: sessionRadiosCollection })
      .orderBy(({ radio }) => radio.addedAt, "desc")
  );
  const state = buildSessionRadiosState(result.data.map(toSessionRadio));
  return selector ? selector(state) : state;
};

export const useSessionRadios = Object.assign(
  useSessionRadiosSelector as UseSessionRadios,
  {
    getState: () => buildSessionRadiosState(getSessionRadios()),
  }
);
