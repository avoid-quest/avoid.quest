import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { act } from "react";
import type { Radio } from "@/lib/audio";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
}

const sessionRadiosState = {
  radios: [] as Radio[],
  removeSessionRadio: mock((_id: string | number) => undefined),
};

mock.module("@/lib/hooks/use-session-radios", () => ({
  isSessionRadio: (radio: Radio) => String(radio.id ?? "").startsWith("rg_"),
  useSessionRadios: <T,>(selector: (state: typeof sessionRadiosState) => T) =>
    selector(sessionRadiosState),
}));

mock.module("@/lib/hooks/use-discovered-station-actions", () => ({
  useDiscoveredStationActions: () => ({
    saveDiscoveredStation: mock((_radio: Radio) => undefined),
    selectDiscoveredStation: mock((_radio: Radio) => undefined),
  }),
}));

let useMultipleRadioManagement: typeof import("./use-multiple-radio-management")["useMultipleRadioManagement"];

beforeAll(async () => {
  ({ useMultipleRadioManagement } = await import(
    "./use-multiple-radio-management"
  ));
});

beforeEach(() => {
  sessionRadiosState.radios = [];
  sessionRadiosState.removeSessionRadio.mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

function TestHarness({
  hasMultipleSession,
  radios,
  syncRadios,
}: {
  hasMultipleSession: boolean;
  radios?: Radio[];
  syncRadios: (saved: Radio[], session: Radio[]) => void;
}) {
  useMultipleRadioManagement({
    radios,
    hasMultipleSession,
    syncRadios,
    addRadio: () => undefined,
    removeRadio: () => undefined,
  });

  return null;
}

describe("useMultipleRadioManagement", () => {
  test("waits for readiness before passing Saved and Session Stations", async () => {
    const savedRadio = {
      id: "saved-radio",
      name: "Saved Radio",
      streamUrl: "https://radio.example/saved.mp3",
    } satisfies Radio;
    const sessionRadio = {
      id: "rg_session-radio",
      name: "Session Radio",
      streamUrl: "https://radio.example/session.mp3",
    } satisfies Radio;
    const syncRadios = mock((_saved: Radio[], _session: Radio[]) => undefined);

    sessionRadiosState.radios = [sessionRadio];

    const view = render(
      <TestHarness
        hasMultipleSession={false}
        radios={[savedRadio]}
        syncRadios={syncRadios}
      />
    );

    await act(async () => Promise.resolve());

    expect(syncRadios).not.toHaveBeenCalled();

    view.rerender(
      <TestHarness
        hasMultipleSession={true}
        radios={[savedRadio]}
        syncRadios={syncRadios}
      />
    );

    await act(async () => Promise.resolve());

    expect(syncRadios).toHaveBeenCalledTimes(1);
    expect(syncRadios).toHaveBeenCalledWith([savedRadio], [sessionRadio]);
  });
});
