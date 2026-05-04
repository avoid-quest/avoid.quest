import { useLiveQuery } from "@tanstack/react-db";
import type { Radio } from "@/lib/audio";
import {
  addSessionRadio,
  getSessionRadios,
  removeSessionRadio,
  type SessionRadioRecord,
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
  <T>(selector: (state: SessionRadiosState) => T): T;
  getState: () => SessionRadiosState;
};

export const useSessionRadios: UseSessionRadios = Object.assign(
  <T>(selector: (state: SessionRadiosState) => T): T => {
    const result = useLiveQuery((q) =>
      q
        .from({ radio: sessionRadiosCollection })
        .orderBy(({ radio }) => radio.addedAt, "desc")
    );
    return selector(
      buildSessionRadiosState(
        (result.data as SessionRadioRecord[]).map(toSessionRadio)
      )
    );
  },
  {
    getState: () => buildSessionRadiosState(getSessionRadios()),
  }
);
