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
import { getMultipleChannelId } from "@/lib/collections/playback-sessions";
import {
  resetAllPlaybackRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage,
  navigator: dom.window.navigator,
  sessionStorage: dom.window.sessionStorage,
  window: dom.window,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
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
  resetAllPlaybackRuntime();
  localStorage.clear();
  sessionStorage.clear();
});

type Management = ReturnType<typeof useMultipleRadioManagement>;

function TestHarness({
  addRadio = () => undefined,
  hasMultipleSession,
  onRender,
  radios,
  syncRadios,
}: {
  addRadio?: (radio: Radio, persistSelection?: boolean) => void;
  hasMultipleSession: boolean;
  onRender?: (management: Management) => void;
  radios?: Radio[];
  syncRadios: (saved: Radio[], session: Radio[]) => void;
}) {
  const management = useMultipleRadioManagement({
    addRadio,
    hasMultipleSession,
    radios,
    removeRadio: () => undefined,
    syncRadios,
  });
  onRender?.(management);

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

  test("undoing Hide on a playing card brings it back playing", async () => {
    const playing = {
      enabled: true,
      id: "playing-radio",
      name: "Playing Radio",
      streamUrl: "https://radio.example/playing.mp3",
    } satisfies Radio;
    const paused = {
      enabled: true,
      id: "paused-radio",
      name: "Paused Radio",
      streamUrl: "https://radio.example/paused.mp3",
    } satisfies Radio;
    setPlaybackChannelRuntime(getMultipleChannelId(playing), () => ({
      isPlaying: true,
    }));
    const addRadio = mock(
      (_radio: Radio, _persistSelection?: boolean) => undefined
    );
    let management: Management | null = null;
    const captureManagement = (next: Management) => {
      management = next;
    };
    const syncRadios = mock((_saved: Radio[], _session: Radio[]) => undefined);
    render(
      <TestHarness
        addRadio={addRadio}
        hasMultipleSession={true}
        onRender={captureManagement}
        radios={[playing, paused]}
        syncRadios={syncRadios}
      />
    );
    const current = () => {
      if (!management) {
        throw new Error("hook did not render");
      }
      return management;
    };

    await act(async () => {
      await current().handleToggleRadio(playing, false);
      await current().handleToggleRadio(paused, false);
      await current().handleToggleRadio(playing, true);
      await current().handleToggleRadio(paused, true);
    });

    expect(addRadio).toHaveBeenCalledTimes(1);
    expect(addRadio).toHaveBeenCalledWith(playing, true);
  });
});
