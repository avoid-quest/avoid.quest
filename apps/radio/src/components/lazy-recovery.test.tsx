import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: a restored spy keeps the shared reporting module real for other tests
import * as errorSdk from "@avoid.quest/error";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { Component, type ReactNode, Suspense } from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  navigator: dom.window.navigator,
  window: dom.window,
})) {
  previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

const { cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { LazyBoundary, lazyWithRetry } = await import("./lazy-recovery");

let captureError: ReturnType<typeof spyOn<typeof errorSdk, "captureError">>;
let consoleError: ReturnType<typeof spyOn<typeof console, "error">>;

beforeEach(() => {
  captureError = spyOn(errorSdk, "captureError").mockImplementation(
    () => undefined
  );
  // React logs every error a boundary catches.
  consoleError = spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  captureError.mockRestore();
  consoleError.mockRestore();
});
afterAll(() => {
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  dom.window.close();
});

/** A chunk that fails until `recover()` is called, like a dropped network. */
function flakyChunk() {
  let online = false;
  const load = mock(() =>
    online
      ? Promise.resolve({
          default: ({ name }: { name: string }) => <p>{name} ready</p>,
        })
      : Promise.reject(new TypeError("Failed to fetch dynamically imported"))
  );
  return {
    Feature: lazyWithRetry(load),
    load,
    recover: () => {
      online = true;
    },
  };
}

// biome-ignore lint/style/useReactFunctionComponents: React error boundaries need class lifecycle methods.
class OuterBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    return this.state.error ? (
      <p>Outer caught {this.state.error.message}</p>
    ) : (
      this.props.children
    );
  }
}

describe("LazyBoundary", () => {
  test("contains a rejected import to its feature and keeps siblings mounted", async () => {
    const { Feature } = flakyChunk();
    const view = render(
      <OuterBoundary>
        <p>Now playing</p>
        <LazyBoundary label="feedback">
          <Suspense fallback={<p>Loading…</p>}>
            <Feature name="Feedback" />
          </Suspense>
        </LazyBoundary>
      </OuterBoundary>
    );
    const sibling = view.getByText("Now playing");

    const alert = await view.findByRole("alert");
    expect(alert.textContent).toBe("Couldn't load feedback.");
    expect(view.getByText("Now playing")).toBe(sibling);
    expect(view.queryByText("Outer caught", { exact: false })).toBeNull();
    expect(view.getByRole("button", { name: "Reload" })).toBeDefined();
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0]?.[1]).toMatchObject({
      operation: "lazy-load",
      tags: { feature: "feedback" },
    });
  });

  test("Retry imports again with a fresh lazy component", async () => {
    const { Feature, load, recover } = flakyChunk();
    const view = render(
      <LazyBoundary label="the station form">
        <Suspense fallback={<p>Loading…</p>}>
          <Feature name="Station form" />
        </Suspense>
      </LazyBoundary>
    );
    const retry = await view.findByRole("button", { name: "Retry" });
    expect(view.getByRole("alert").textContent).toBe(
      "Couldn't load the station form."
    );
    // React renders again after the error; only Retry imports again.
    expect(load).toHaveBeenCalledTimes(1);

    // React caches the rejection; a second failure stays contained too, and
    // points to Reload since the browser may keep the failed fetch.
    fireEvent.click(retry);
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe(
        "Couldn't load the station form, even after retrying."
      )
    );
    expect(
      view.getByText("Reload to try again. Reloading stops playback.")
    ).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await view.findByRole("alert");
    expect(load).toHaveBeenCalledTimes(3);

    recover();
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    expect(await view.findByText("Station form ready")).toBeDefined();
    expect(view.queryByRole("alert")).toBeNull();
    expect(load).toHaveBeenCalledTimes(4);
  });

  test("reports a failed import once across remounts, and again after Retry", async () => {
    const { Feature } = flakyChunk();
    const renderFeature = (key: string) => (
      <LazyBoundary key={key} label="Node mode">
        <Suspense fallback={<p>Loading…</p>}>
          <Feature name="Node" />
        </Suspense>
      </LazyBoundary>
    );
    const view = render(renderFeature("node"));
    await view.findByRole("alert");
    expect(captureError).toHaveBeenCalledTimes(1);

    // Switching modes away and back remounts the boundary on the same failure.
    view.rerender(<p>DJ</p>);
    view.rerender(renderFeature("node-again"));
    await view.findByRole("alert");
    expect(captureError).toHaveBeenCalledTimes(1);

    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe(
        "Couldn't load Node mode, even after retrying."
      )
    );
    expect(captureError).toHaveBeenCalledTimes(2);
  });

  test("the icon fallback names the failure and retries from its popover", async () => {
    const { Feature, recover } = flakyChunk();
    const view = render(
      <LazyBoundary label="settings" variant="icon">
        <Suspense fallback={null}>
          <Feature name="Settings" />
        </Suspense>
      </LazyBoundary>
    );

    const trigger = await view.findByRole("button", {
      name: "Couldn't load settings. Show options",
    });
    const popover = document.getElementById(
      trigger.getAttribute("popovertarget") ?? ""
    );
    expect(popover?.getAttribute("popover")).toBe("auto");

    recover();
    // jsdom keeps a closed popover out of the accessibility tree.
    fireEvent.click(view.getByRole("button", { hidden: true, name: "Retry" }));
    expect(await view.findByText("Settings ready")).toBeDefined();
    expect(document.getElementById(popover?.id ?? "")).toBeNull();
  });

  test("errors other than a failed import reach the outer boundary", async () => {
    function Broken(): ReactNode {
      throw new Error("render bug");
    }
    const view = render(
      <OuterBoundary>
        <LazyBoundary label="feedback">
          <Broken />
        </LazyBoundary>
      </OuterBoundary>
    );

    expect(await view.findByText("Outer caught render bug")).toBeDefined();
    expect(captureError).not.toHaveBeenCalled();
  });
});
