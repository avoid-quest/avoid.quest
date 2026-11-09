/** biome-ignore-all lint/performance/noJsxPropsBind: Test harnesses record component interactions. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { browserTestGlobals } from "@/test-utils/browser-globals";
import { installSettingsTestDom } from "./settings-test-dom";

const SAVED_STATION = /^My new station/;

if (process.env.RADIO_ADD_STATION_REGRESSION === "1") {
  const dom = installSettingsTestDom();
  Object.assign(globalThis, browserTestGlobals(dom.window), {
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
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => undefined,
      matches: false,
      removeEventListener: () => undefined,
    }),
  });
  const { cleanup, fireEvent, render, waitFor, within } = await import(
    "@testing-library/react"
  );
  const { Radios } = await import("../radio");
  const { NodeCanvasHint } = await import("../radio/node/canvas-hint");
  const { DjRadioList } = await import("../radio/dj/dj-radio-list");
  const { SettingsButton } = await import("./settings-button");
  const { radiosCollection } = await import("@/lib/collections/radios");
  const { initializeSettings, setPlayerMode } = await import(
    "@/lib/collections/settings"
  );
  const { buildNodeGraphFromTemplate } = await import(
    "@/lib/node-graph/templates"
  );
  const single = <Radios />;
  const entries = [
    { name: "Single header", player: single, triggerIndex: 0 },
    { name: "Single empty state", player: single, triggerIndex: 1 },
    {
      name: "Node empty state",
      player: <NodeCanvasHint graph={buildNodeGraphFromTemplate("starter")} />,
      triggerIndex: 0,
    },
    {
      name: "DJ empty state",
      player: <DjRadioList deckId="deck-a" radios={[]} />,
      triggerIndex: 0,
    },
  ];
  beforeEach(async () => {
    await initializeSettings();
    setPlayerMode("single");
    await radiosCollection.stateWhenReady();
  });
  afterEach(() => {
    cleanup();
    for (const id of radiosCollection.state.keys()) {
      radiosCollection.delete(id);
    }
  });

  for (const { name, player, triggerIndex } of entries) {
    test(`${name} opens Add station inside Settings and saves to My stations`, async () => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const view = render(
        <QueryClientProvider client={client}>
          <div data-testid="player">{player}</div>
        </QueryClientProvider>
      );
      const playerView = within(view.getByTestId("player"));
      let trigger = (
        await playerView.findAllByRole("button", { name: "Add station" })
      )[triggerIndex];
      expect(trigger).toBeDefined();
      if (name.startsWith("Single")) {
        expect(
          view.getByText(
            "Search or paste a link to play a station. Save it to keep it in My stations."
          )
        ).toBeTruthy();
      }
      // Cold keyboard activation must survive the lazy Settings load.
      fireEvent.click(trigger, { detail: 0 });
      await view.findByRole("heading", { name: "Add station" });
      expect(view.getAllByRole("dialog")).toHaveLength(1);
      expect(
        view
          .getByRole("tab", { name: "My stations" })
          .getAttribute("aria-selected")
      ).toBe("true");
      fireEvent.click(view.getByRole("tab", { name: "Manual" }));
      fireEvent.change(await view.findByLabelText("Name"), {
        target: { value: "My new station" },
      });
      fireEvent.change(view.getByLabelText("Stream URL"), {
        target: { value: "https://stream.example/live.mp3" },
      });
      fireEvent.click(view.getByRole("button", { name: "Add station" }));
      await waitFor(() =>
        expect([...radiosCollection.state.values()]).toEqual([
          expect.objectContaining({
            enabled: true,
            name: "My new station",
            streamUrl: "https://stream.example/live.mp3",
          }),
        ])
      );
      if (name === "Single empty state") {
        // The saved station replaces the empty state and its Settings trigger.
        await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
        trigger = playerView.getByRole("button", { name: "Add station" });
      } else {
        await view.findByRole("searchbox", { name: "Filter stations" });
        expect(view.getAllByRole("dialog")).toHaveLength(1);
        fireEvent.click(view.getByRole("button", { name: "Close" }));
        await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
        await waitFor(() => expect(document.activeElement).toBe(trigger));
      }
      if (name.startsWith("Single")) {
        expect(
          await playerView.findByRole("button", { name: SAVED_STATION })
        ).toBeTruthy();
      }
      // The shortcut starts a fresh Add page even after saving and closing.
      fireEvent.click(trigger, { detail: 0 });
      await view.findByRole("heading", { name: "Add station" });
      expect(view.getAllByRole("dialog")).toHaveLength(1);
      fireEvent.click(view.getByRole("button", { name: "My stations" }));
      await view.findByRole("searchbox", { name: "Filter stations" });
      expect(document.activeElement).toBe(
        view.getByRole("button", { name: "Add station" })
      );
    });
  }

  test("the existing Settings Add station button opens the same page without another dialog", async () => {
    const view = render(<SettingsButton />);
    fireEvent.click(view.getByRole("button", { name: "Open settings" }));
    fireEvent.click(await view.findByRole("button", { name: "Add station" }));
    const heading = await view.findByRole("heading", { name: "Add station" });
    expect(view.getAllByRole("dialog")).toHaveLength(1);
    expect(document.activeElement).toBe(heading);
    fireEvent.click(view.getByRole("button", { name: "My stations" }));
    await view.findByRole("searchbox", { name: "Filter stations" });
    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "Add station" })
    );
  });
} else {
  test("player add-station regressions (isolated browser environment)", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, RADIO_ADD_STATION_REGRESSION: "1" },
      stderr: "pipe",
      stdout: "pipe",
      timeout: 25_000,
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ errors: exitCode ? stderr : "", exitCode }).toEqual({
      errors: "",
      exitCode: 0,
    });
  }, 30_000);
}
