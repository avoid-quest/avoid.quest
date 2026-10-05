import { expect, mock, spyOn, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { Component, type ReactNode } from "react";

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
    useSettings: () => ({ data: { player: { mode } }, isReady: true }),
  }));
  mock.module("@/lib/mode-lifecycle-requests", () => ({
    modeLifecycleRequests: { synchronizeMode: () => Promise.resolve() },
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

  // biome-ignore lint/style/useReactFunctionComponents: React error boundaries need class lifecycle methods.
  class RetryBoundary extends Component<
    { children: ReactNode },
    { error: Error | null }
  > {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
      return { error };
    }

    reset = () => this.setState({ error: null });

    render() {
      return this.state.error ? (
        <button onClick={this.reset} type="button">
          Try again
        </button>
      ) : (
        this.props.children
      );
    }
  }

  const { cleanup, fireEvent, render } = await import("@testing-library/react");
  const { Radios } = await import("./index");

  test(`${mode} recovers after the error boundary is reset`, async () => {
    const errors = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const view = render(
        <RetryBoundary>
          <Radios />
        </RetryBoundary>
      );
      const retry = await view.findByRole("button", { name: "Try again" });
      const previousAttempts = load.mock.calls.length;
      canLoad = true;
      fireEvent.click(retry);
      expect(await view.findByText("Mode ready")).toBeDefined();
      expect(load).toHaveBeenCalledTimes(previousAttempts + 1);
    } finally {
      cleanup();
      errors.mockRestore();
    }
  });
} else {
  for (const playerMode of ["single", "node", "dj"]) {
    test(`${playerMode} can retry a rejected lazy component`, async () => {
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
