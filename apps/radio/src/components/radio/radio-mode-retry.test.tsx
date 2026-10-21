import { expect, mock, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: a restored spy keeps the shared reporting module real for other tests
import * as errorSdk from "@avoid.quest/error";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const mode = process.env.AVOID_QUEST_RENDER_RETRY_MODE;

if (mode) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://radio.test",
  });
  for (const [key, value] of Object.entries({
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    navigator: dom.window.navigator,
    window: dom.window,
  })) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  mock.module("@/lib/hooks/use-radios", () => ({
    useEnabledRadios: () => ({ data: [], isReady: true }),
  }));
  mock.module("@/lib/hooks/use-settings", () => ({
    usePlayerModeState: () => ({ hasSettings: true, isReady: true, mode }),
  }));
  mock.module("@/lib/mode-lifecycle-requests", () => ({
    modeLifecycleRequests: {
      getTransitionSnapshot: () => ({
        currentMode: null,
        error: null,
        phase: "inactive",
        requestedMode: null,
      }),
      subscribeTransitionSnapshot: () => () => undefined,
      synchronizeMode: () => Promise.resolve(),
    },
  }));
  let canLoad = false;
  const load = mock(() =>
    canLoad
      ? Promise.resolve({ default: () => <div>Mode ready</div> })
      : Promise.reject(new Error("Temporary preparation failure"))
  );
  mock.module("./radio-mode-loader", () => ({
    loadDjPlayer: load,
    loadNodeRadios: load,
    loadSingleRadio: load,
  }));

  const { act, cleanup, fireEvent, render, waitFor } = await import(
    "@testing-library/react"
  );
  const { Radios } = await import("./index");
  const labels: Record<string, string> = {
    dj: "DJ mode",
    node: "Node mode",
    single: "Single mode",
  };
  const label = labels[mode];
  // Lets any import React would start on its own reach the loader.
  const settle = () =>
    act(() => new Promise((resolve) => setTimeout(resolve, 50)));

  test(`${mode} waits for Retry after its chunk fails to load`, async () => {
    const errors = spyOn(console, "error").mockImplementation(() => undefined);
    const captureError = spyOn(errorSdk, "captureError").mockImplementation(
      () => undefined
    );
    try {
      const view = render(<Radios />);
      const retry = await view.findByRole("button", { name: "Retry" });
      expect(view.getByRole("alert").textContent).toBe(
        `Couldn't load ${label}.`
      );
      expect(view.getByRole("button", { name: "Reload" })).toBeDefined();
      await settle();
      expect(load).toHaveBeenCalledTimes(1);
      expect(captureError).toHaveBeenCalledTimes(1);

      // Each press imports once, even while the chunk keeps failing.
      fireEvent.click(retry);
      await waitFor(() =>
        expect(view.getByRole("alert").textContent).toBe(
          `Couldn't load ${label}, even after retrying.`
        )
      );
      await settle();
      expect(load).toHaveBeenCalledTimes(2);
      expect(captureError).toHaveBeenCalledTimes(2);

      canLoad = true;
      fireEvent.click(view.getByRole("button", { name: "Retry" }));
      expect(await view.findByText("Mode ready")).toBeDefined();
      expect(view.queryByRole("alert")).toBeNull();
      expect(load).toHaveBeenCalledTimes(3);
    } finally {
      cleanup();
      captureError.mockRestore();
      errors.mockRestore();
    }
  });
} else {
  for (const playerMode of ["single", "node", "dj"]) {
    test(`${playerMode} retries a failed chunk only when asked`, async () => {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        env: { ...process.env, AVOID_QUEST_RENDER_RETRY_MODE: playerMode },
        stderr: "pipe",
        stdout: "pipe",
        timeout: 5000,
      });
      const [stderr, exitCode] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ errors: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
        errors: "",
        exitCode: 0,
      });
    });
  }
}
