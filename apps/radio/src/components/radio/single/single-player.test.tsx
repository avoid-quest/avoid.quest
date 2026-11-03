import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { Radio } from "@/lib/audio";
import { browserTestGlobals } from "@/test-utils/browser-globals";

if (process.env.RADIO_SINGLE_LINK_REGRESSION === "1") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "https://radio.test",
  });
  for (const key of [
    "document",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLFormElement",
    "CustomEvent",
    "DocumentFragment",
    "MutationObserver",
    "Node",
    "NodeFilter",
    "navigator",
    "window",
    "getComputedStyle",
  ]) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: dom.window[key],
      writable: true,
    });
  }
  Object.assign(globalThis, browserTestGlobals(dom.window), {
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      disconnect() {
        // JSDOM does not perform layout.
      }
      observe() {
        // JSDOM does not perform layout.
      }
      unobserve() {
        // JSDOM does not perform layout.
      }
    },
  });
  Object.assign(CSS, { supports: () => false });
  const noop = () => undefined;
  const playRadio = mock(async (_radio: Radio) => undefined);
  mock.module("@/lib/hooks/use-single-session", () => ({
    useSingleSession: () => ({
      currentRadio: null,
      playRadio,
      selectRadio: noop,
      setVolume: noop,
      toggleMute: noop,
      togglePlayPause: noop,
      volume: 1,
    }),
  }));
  mock.module("@/lib/hooks/use-media-session", () => ({
    useMediaSession: noop,
  }));
  mock.module("@/lib/hooks/use-radio-metadata", () => ({
    useRadioMetadata: () => ({ metadata: null }),
  }));
  mock.module("@/components/settings/radio-dialog", () => ({
    prefetchStationDialogOnIntent: noop,
    RadioDialog: () => null,
  }));
  const { act, cleanup, fireEvent, render, waitFor } = await import(
    "@testing-library/react"
  );
  const { radiosCollection } = await import("@/lib/collections/radios");
  const { getSessionRadios, isSessionRadio, sessionRadiosCollection } =
    await import("@/lib/collections/session-radios");
  const { stationIntake } = await import(
    "@/lib/stations/external-station-workflow"
  );
  const { SinglePlayer } = await import("./single-player");
  beforeEach(async () => {
    await sessionRadiosCollection.stateWhenReady();
    playRadio.mockClear();
  });
  afterEach(() => {
    cleanup();
    mock.restore();
    for (const id of sessionRadiosCollection.state.keys()) {
      sessionRadiosCollection.delete(id);
    }
  });
  function renderPlayer() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <SinglePlayer radios={[]} />
      </QueryClientProvider>
    );
    const search = view.getByRole("combobox", {
      name: "Search stations",
    }) as HTMLInputElement;
    const type = (value: string) => {
      fireEvent.focusIn(search);
      fireEvent.change(search, { target: { value } });
    };
    return { search, type, view };
  }

  test.each(["https://stream.example/live", "https://stream.example/live.mp3"])(
    "Single plays %s as a temporary station without saving it",
    async (url) => {
      const savedIds = [...radiosCollection.state.keys()];
      const { search, type, view } = renderPlayer();
      expect(search.placeholder).toBe("Search stations or paste a link");
      type(` ${url} `);
      fireEvent.keyDown(search, { key: "Enter" });
      await waitFor(() => expect(playRadio).toHaveBeenCalledTimes(1));
      const [station] = getSessionRadios();
      expect(station).toMatchObject({
        id: "stream.example",
        name: "stream.example",
        streamUrl: url,
      });
      expect(playRadio).toHaveBeenCalledWith(station);
      expect(isSessionRadio(station)).toBe(true);
      expect([...radiosCollection.state.keys()]).toEqual(savedIds);
      await waitFor(() => expect(search.value).toBe(""));
      fireEvent.click(
        view.getByRole("button", { name: "Options for stream.example" })
      );
      expect(view.getByRole("menuitem", { name: "Save" })).toBeTruthy();
      fireEvent.click(view.getByRole("menuitem", { name: "Remove" }));
      await waitFor(() => expect(getSessionRadios()).toEqual([]));
    }
  );

  test.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://soundcloud.com/artist/track",
    "https://artist.bandcamp.com/track/song",
  ])("Single explains where platform links play: %s", async (url) => {
    const createSession = spyOn(stationIntake, "createSession");
    const { search, type, view } = renderPlayer();
    type(url);
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe(
        "Platform links play in Node or DJ"
      )
    );
    expect(createSession).not.toHaveBeenCalled();
    expect(playRadio).not.toHaveBeenCalled();
    expect(search.value).toBe(url);
    type("another search");
    expect(view.queryByRole("alert")).toBeNull();
  });

  test("changing the query cancels a stream before it is registered or played", async () => {
    const { createSession } = stationIntake;
    const pending = Promise.withResolvers<void>();
    spyOn(stationIntake, "createSession").mockImplementation(
      async (candidate, options) => {
        await pending.promise;
        return createSession(candidate, options);
      }
    );
    const { search, type } = renderPlayer();
    type("https://stream.example/live");
    fireEvent.keyDown(search, { key: "Enter" });
    type("changed");
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(playRadio).not.toHaveBeenCalled();
    expect(getSessionRadios()).toEqual([]);
    expect(search.value).toBe("changed");
  });
} else {
  test("Single pasted-link regressions (isolated playback mocks)", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, RADIO_SINGLE_LINK_REGRESSION: "1" },
      stderr: "pipe",
      stdout: "pipe",
      timeout: 20_000,
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ errors: exitCode ? stderr : "", exitCode }).toEqual({
      errors: "",
      exitCode: 0,
    });
  }, 25_000);
}
