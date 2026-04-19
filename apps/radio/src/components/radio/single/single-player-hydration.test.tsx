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

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

const mockSettingsState = {
  data: undefined as
    | {
        player?: {
          restoreStateOnLoad?: boolean;
        };
      }
    | undefined,
};

const mockSingleStateValue = {
  current: undefined as
    | {
        radio?: Radio;
        volume?: number;
      }
    | undefined,
};

mock.module("@/lib/hooks/use-settings", () => ({
  useSettings: () => mockSettingsState,
}));

mock.module("@/lib/hooks/use-single-state", () => ({
  useSingleState: () => mockSingleStateValue.current,
}));

let useSingleStateHydration: typeof import("./single-player-hydration")["useSingleStateHydration"];

beforeAll(async () => {
  ({ useSingleStateHydration } = await import("./single-player-hydration"));
});

beforeEach(() => {
  mockSettingsState.data = undefined;
  mockSingleStateValue.current = undefined;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

function TestHarness({
  hasSingleSession,
  selectRadio,
  setVolume,
}: {
  hasSingleSession: boolean;
  selectRadio: (radio: Radio) => Promise<void>;
  setVolume: (volume: number) => void;
}) {
  const isHydrated = useSingleStateHydration(
    selectRadio,
    setVolume,
    hasSingleSession
  );

  return <div data-testid="hydrated">{String(isHydrated)}</div>;
}

describe("useSingleStateHydration", () => {
  test("waits for the single playback session and restores radio before saved volume", async () => {
    const savedRadio = {
      id: "saved-radio",
      name: "Saved Radio",
      streamUrl: "https://radio.example/saved.mp3",
    } satisfies Radio;
    const callOrder: string[] = [];
    const selectRadio = mock(async (_radio: Radio) => {
      callOrder.push("select:start");
      await Promise.resolve();
      callOrder.push("select:end");
    });
    const setVolume = mock((_volume: number) => {
      callOrder.push("volume");
    });

    mockSettingsState.data = {
      player: { restoreStateOnLoad: true },
    };
    mockSingleStateValue.current = {
      radio: savedRadio,
      volume: 0.42,
    };

    const view = render(
      <TestHarness
        hasSingleSession={false}
        selectRadio={selectRadio}
        setVolume={setVolume}
      />
    );

    await act(async () => Promise.resolve());

    expect(view.getByTestId("hydrated").textContent).toBe("false");
    expect(setVolume).not.toHaveBeenCalled();
    expect(selectRadio).not.toHaveBeenCalled();

    view.rerender(
      <TestHarness
        hasSingleSession={true}
        selectRadio={selectRadio}
        setVolume={setVolume}
      />
    );

    await act(async () => Promise.resolve());

    expect(view.getByTestId("hydrated").textContent).toBe("true");
    expect(selectRadio).toHaveBeenCalledTimes(1);
    expect(selectRadio).toHaveBeenCalledWith(savedRadio);
    expect(setVolume).toHaveBeenCalledTimes(1);
    expect(setVolume).toHaveBeenCalledWith(0.42);
    expect(callOrder).toEqual(["select:start", "select:end", "volume"]);
  });

  test("completes immediately without restoring when restore is disabled", async () => {
    const selectRadio = mock(async (_radio: Radio) => undefined);
    const setVolume = mock((_volume: number) => undefined);

    mockSettingsState.data = {
      player: { restoreStateOnLoad: false },
    };
    mockSingleStateValue.current = {
      radio: {
        id: "saved-radio",
        name: "Saved Radio",
        streamUrl: "https://radio.example/saved.mp3",
      },
      volume: 0.42,
    };

    const view = render(
      <TestHarness
        hasSingleSession={false}
        selectRadio={selectRadio}
        setVolume={setVolume}
      />
    );

    await act(async () => Promise.resolve());

    expect(view.getByTestId("hydrated").textContent).toBe("true");
    expect(setVolume).not.toHaveBeenCalled();
    expect(selectRadio).not.toHaveBeenCalled();
  });

  test("restores saved volume even when restoring the saved radio fails", async () => {
    const savedRadio = {
      id: "saved-radio",
      name: "Saved Radio",
      streamUrl: "https://radio.example/saved.mp3",
    } satisfies Radio;
    const originalConsoleError = console.error;
    console.error = mock(() => undefined) as typeof console.error;
    try {
      const selectRadio = mock((_radio: Radio) =>
        Promise.reject(new Error("station gone"))
      );
      const setVolume = mock((_volume: number) => undefined);

      mockSettingsState.data = {
        player: { restoreStateOnLoad: true },
      };
      mockSingleStateValue.current = {
        radio: savedRadio,
        volume: 0.42,
      };

      const view = render(
        <TestHarness
          hasSingleSession={true}
          selectRadio={selectRadio}
          setVolume={setVolume}
        />
      );

      await act(async () => Promise.resolve());

      expect(view.getByTestId("hydrated").textContent).toBe("true");
      expect(selectRadio).toHaveBeenCalledTimes(1);
      expect(selectRadio).toHaveBeenCalledWith(savedRadio);
      expect(setVolume).toHaveBeenCalledTimes(1);
      expect(setVolume).toHaveBeenCalledWith(0.42);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
