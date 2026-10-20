import { expect, mock, spyOn, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const NOTIFICATIONS = /Notifications/;

const scenario = process.env.AVOID_QUEST_DJ_RECOVERY_TEST;
if (scenario) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://radio.test",
  });
  for (const [key, value] of Object.entries({
    document: dom.window.document,
    Element: dom.window.Element,
    getComputedStyle: dom.window.getComputedStyle,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    MutationObserver: dom.window.MutationObserver,
    matchMedia: () => ({
      addListener: () => undefined,
      matches: false,
      removeListener: () => undefined,
    }),
    Node: dom.window.Node,
    navigator: dom.window.navigator,
    window: dom.window,
  })) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
  dom.window.matchMedia = globalThis.matchMedia;
  dom.window.scrollTo = () => undefined;

  const { act, cleanup, fireEvent, render, waitFor } = await import(
    "@testing-library/react"
  );
  const { toast, Toaster } = await import("sonner");
  const { createModeLifecycleRegistry, createModeManager } = await import(
    "@/lib/mode-lifecycle-manager"
  );
  const { createModeLifecycleRequests } = await import(
    "@/lib/mode-lifecycle-requests"
  );
  const { playbackSessionsCollection } = await import(
    "@/lib/collections/playback-sessions"
  );
  const loadDjWorkflow = mock(() =>
    Promise.reject(new TypeError("Failed to fetch dynamically imported module"))
  );
  const lifecycles = createModeLifecycleRegistry({ loadDjWorkflow });
  const single = {
    activate: mock(async () => undefined),
    deactivate: mock(async () => undefined),
    getPhase: () => "active" as const,
  };
  lifecycles.single = single;
  const manager = createModeManager({
    initialMode: scenario === "startup" ? null : "single",
    lifecycles,
  });
  const requests = createModeLifecycleRequests({ manager });
  mock.module("@/lib/mode-lifecycle-requests", () => ({
    modeLifecycleRequests: requests,
  }));
  let storedMode = scenario === "startup" ? "dj" : "single";
  mock.module("@/lib/hooks/use-settings", () => ({
    usePlayerModeState: () => ({
      hasSettings: true,
      isReady: true,
      mode: storedMode,
    }),
    useSettings: () => ({
      data: { player: { mode: storedMode } },
      isReady: true,
    }),
  }));
  mock.module("@/lib/hooks/use-radios", () => ({
    useEnabledRadios: () => ({ data: [], isReady: true }),
  }));
  const loadDjPlayer = mock(async () => ({ default: () => <p>DJ player</p> }));
  mock.module("../radio/radio-mode-loader", () => ({
    loadDjPlayer,
    loadNodeRadios: async () => ({ default: () => <p>Node player</p> }),
    loadSingleRadio: async () => ({ default: () => <p>Single player</p> }),
  }));
  const { ModeSelect } = await import("./mode-select");
  const { Radios } = await import("../radio");

  test("failed DJ entry keeps the selected mode and player, announces once, and only reloads on request", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "dj",
      masterVolume: 1,
    });
    const notices = spyOn(toast, "error");
    const consoleError = spyOn(console, "error").mockImplementation(
      () => undefined
    );
    const reload = mock(() => undefined);
    const view = render(
      <>
        <ModeSelect />
        <Radios />
        <Toaster />
      </>
    );
    try {
      if (scenario === "startup") {
        await view.findByText("Couldn't load DJ mode");
        expect(
          await view.findByText(
            "Choose another playback mode to keep listening."
          )
        ).toBeDefined();
        expect(
          view
            .getAllByRole("radio")
            .every((radio) => radio.getAttribute("aria-checked") === "false")
        ).toBe(true);
        expect(view.queryByText("DJ player")).toBeNull();
        expect(manager.getSnapshot()).toMatchObject({
          currentMode: null,
          phase: "inactive",
        });
        expect(loadDjWorkflow).toHaveBeenCalledTimes(1);
        expect(notices).toHaveBeenCalledTimes(1);
        return;
      }
      const player = await view.findByText("Single player");
      const dj = view.getByRole("radio", { name: "DJ" });
      fireEvent.click(dj);
      await view.findByText("Couldn't load DJ mode");
      await waitFor(() => expect(dj.hasAttribute("disabled")).toBe(false));
      expect(
        view.getByRole("radio", { name: "Single" }).getAttribute("aria-checked")
      ).toBe("true");
      expect(view.getByText("Single player")).toBe(player);
      expect(
        view.getByText("Reload to try DJ mode again. Reloading stops playback.")
      ).toBeDefined();
      expect(view.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(
        view
          .getByRole("region", { name: NOTIFICATIONS })
          .getAttribute("aria-live")
      ).toBe("polite");
      expect(single.deactivate).not.toHaveBeenCalled();
      expect(notices).toHaveBeenCalledTimes(1);
      expect(loadDjPlayer).not.toHaveBeenCalled();

      fireEvent.click(dj);
      await waitFor(() => expect(dj.hasAttribute("disabled")).toBe(false));
      expect(loadDjWorkflow).toHaveBeenCalledTimes(1);
      expect(notices).toHaveBeenCalledTimes(1);
      expect(reload).not.toHaveBeenCalled();

      // A settings write from another tab must not replace the running player
      // when this tab cannot load DJ, or select DJ in the toggle after failure.
      storedMode = "dj";
      view.rerender(
        <>
          <ModeSelect />
          <Radios />
          <Toaster />
        </>
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        view.getByRole("radio", { name: "Single" }).getAttribute("aria-checked")
      ).toBe("true");
      expect(view.getByText("Single player")).toBe(player);
      expect(notices).toHaveBeenCalledTimes(1);
      expect(loadDjPlayer).not.toHaveBeenCalled();

      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: new Proxy(dom.window, {
          get(target, key) {
            if (key === "location") {
              return { reload };
            }
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
        writable: true,
      });
      fireEvent.click(view.getByRole("button", { name: "Reload" }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: dom.window,
        writable: true,
      });
      notices.mockRestore();
      consoleError.mockRestore();
      cleanup();
      dom.window.close();
    }
  });
} else {
  test.each(["switch", "startup"])(
    "DJ lifecycle recovery UI uses a listener-controlled reload on %s",
    async (entry) => {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        env: { ...process.env, AVOID_QUEST_DJ_RECOVERY_TEST: entry },
        stderr: "pipe",
        stdout: "pipe",
        timeout: 10_000,
      });
      const [stderr, exitCode] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ errors: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
        errors: "",
        exitCode: 0,
      });
    }
  );
}
