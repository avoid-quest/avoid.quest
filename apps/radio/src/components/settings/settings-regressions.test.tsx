/** biome-ignore-all lint/performance/noJsxPropsBind: Test harnesses record component interactions. */
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { installSettingsTestDom } from "./settings-test-dom";

if (process.env.AVOID_QUEST_SETTINGS_REGRESSION) {
  const dom = installSettingsTestDom();
  class ResizeObserverStub {
    observe = mock(() => undefined);
    unobserve = mock(() => undefined);
    disconnect = mock(() => undefined);
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverStub,
  });
  const { act, cleanup, fireEvent, render, waitFor } = await import(
    "@testing-library/react"
  );
  const { useState } = await import("react");
  const { Knob } = await import("@avoid.quest/ui/components/knob");
  const { Drawer } = await import("@avoid.quest/ui/components/drawer");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => undefined,
      matches: false,
      removeEventListener: () => undefined,
    }),
  });
  Object.defineProperty(globalThis, "__APP_VERSION__", {
    configurable: true,
    value: "test",
  });
  let storedMode = "node";
  let resolvedTheme = "dark";
  const setTheme = mock(() => undefined);
  mock.module("next-themes", () => ({
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => ({ resolvedTheme, setTheme, theme: resolvedTheme }),
  }));
  mock.module("@/lib/hooks/use-settings", () => ({
    useSettings: () => ({
      data: { player: { mode: storedMode, restoreStateOnLoad: true } },
      isReady: true,
    }),
  }));
  mock.module("@/lib/use-mode-transition-snapshot", () => ({
    useModeTransitionSnapshot: () => ({ phase: "idle", requestedMode: null }),
  }));
  let finishMode: () => void = () => undefined;
  let failMode: () => void = () => undefined;
  mock.module("@/lib/mode-lifecycle-requests", () => ({
    modeLifecycleRequests: {
      requestMode: () =>
        new Promise<void>((resolve, reject) => {
          finishMode = resolve;
          failMode = () => reject(new Error("Failed"));
        }),
    },
  }));
  mock.module("./radio-management", () => ({
    LoadingFallback: () => <div>Loading</div>,
    RadioManagement: () => <div>Radios</div>,
  }));
  mock.module("./audio-settings", () => ({
    AudioSettings: () => <div>Audio</div>,
  }));
  mock.module("./midi-settings", () => ({
    MidiSettings: () => <div>MIDI</div>,
  }));
  mock.module("@/lib/collections", () => ({
    setRestoreStateOnLoad: () => undefined,
  }));
  mock.module("@/lib/settings", () => ({
    resetAllSettings: () => Promise.resolve(),
  }));
  // This remains one instance across the Data subtabs, as the real import draft does.
  mock.module("./import-export", () => ({
    ImportExport: ({ activePanel }: { activePanel: string }) => {
      const [count, setCount] = useState(0);
      return (
        <button onClick={() => setCount(count + 1)} type="button">
          {activePanel} draft {count}
        </button>
      );
    },
  }));
  const save = mock((_input: unknown) =>
    Promise.resolve({ data: {}, ok: true })
  );
  mock.module("@/lib/stations/external-station-workflow", () => ({
    stationIntake: { save },
  }));
  mock.module("@/lib/stations/station-save-notification", () => ({
    notifyStationSave: () => undefined,
  }));
  mock.module("./radio-field-preview", () => ({
    RadioFieldPreview: () => null,
  }));
  mock.module("@/lib/stations/manual-website-import-workflow", () => ({
    createBrowserManualWebsiteImportWorkflow: () => ({
      fetchDefaults: (url: string) =>
        Promise.resolve({
          data: {
            fields: {
              description: "",
              logoUrl: "",
              name: url,
              streamUrl: `${url}/live.mp3`,
            },
            metadata: {
              missingFields: [],
              name: [{ value: url }],
              streamUrl: [{ value: `${url}/live.mp3` }],
            },
          },
          ok: true,
        }),
      validateWebsiteUrl: (url: string) => ({ data: url, ok: true }),
    }),
  }));
  const { RadioFromUrlTab } = await import("./radio-from-url-tab");
  const { SettingsForm } = await import("./settings-form");
  const { ModeSelect } = await import("./mode-select");
  const { ThemeProvider } = await import("../theme/theme-provider");

  afterEach(() => {
    cleanup();
    save.mockClear();
    storedMode = "node";
  });

  test("changing the website requires a refetch; manual field edits still save", async () => {
    const view = render(<RadioFromUrlTab onSuccess={() => undefined} />);
    const source = view.getByPlaceholderText("https://example-radio.com");
    fireEvent.change(source, { target: { value: "https://a.test" } });
    fireEvent.click(view.getByRole("button", { name: "Fetch" }));
    await view.findByRole("button", { name: "Add station" });
    fireEvent.change(source, { target: { value: "https://b.test" } });
    expect(view.queryByRole("button", { name: "Add station" })).toBeNull();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Fetch" }));
    await view.findByRole("button", { name: "Add station" });
    fireEvent.change(view.getByLabelText("Name", { exact: false }), {
      target: { value: "My station" },
    });
    fireEvent.click(view.getByRole("button", { name: "Add station" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        fields: {
          description: "",
          logoUrl: "",
          name: "My station",
          streamUrl: "https://b.test/live.mp3",
          websiteUrl: "https://b.test",
        },
        origin: "website",
      })
    );
  });

  test("every settings tab controls a labelled panel and Data retains its draft", async () => {
    const view = render(
      <Drawer>
        <SettingsForm defaultTab="import" />
      </Drawer>
    );
    const draft = await view.findByRole("button", { name: "import draft 0" });
    for (const tab of view.getAllByRole("tab")) {
      const panel = document.getElementById(
        tab.getAttribute("aria-controls") ?? ""
      );
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
    }
    fireEvent.click(draft);
    fireEvent.click(view.getByRole("tab", { name: "Export" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(
      await view.findByRole("button", { name: "export draft 1" })
    ).toBeTruthy();
    fireEvent.click(view.getByRole("tab", { name: "Import" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(
      await view.findByRole("button", { name: "import draft 1" })
    ).toBeTruthy();
    fireEvent.keyDown(view.getByRole("tab", { name: "Import" }), {
      key: "ArrowRight",
    });
    // Panels remain addressable after a selection change as well.
    for (const tab of view.getAllByRole("tab")) {
      expect(
        document.getElementById(tab.getAttribute("aria-controls") ?? "")
      ).toBeTruthy();
    }
  });

  for (const result of ["commit", "rollback"]) {
    test(`mode request is busy immediately, delays its spinner, and ${result}s selection`, async () => {
      const view = render(<ModeSelect />);
      const dj = view.getByRole("button", { name: "DJ" });
      fireEvent.click(dj);
      expect(dj.getAttribute("aria-busy")).toBe("true");
      expect(
        view.getByRole("button", { name: "Node" }).getAttribute("aria-pressed")
      ).toBe("true");
      expect(view.queryByRole("status")).toBeNull();
      await view.findByRole("status", { name: "Loading" });
      await act(async () => {
        await Promise.resolve();
        if (result === "commit") {
          storedMode = "dj";
          finishMode();
        } else {
          failMode();
        }
      });
      expect(view.queryByRole("status")).toBeNull();
      expect(dj.hasAttribute("aria-busy")).toBe(false);
      expect(
        view
          .getByRole("button", { name: result === "commit" ? "DJ" : "Node" })
          .getAttribute("aria-pressed")
      ).toBe("true");
    });
  }

  for (const scale of ["linear", "log"] as const) {
    test(`${scale} knob does not jump when Shift changes during a drag`, () => {
      function Harness() {
        const [value, setValue] = useState(1);
        return (
          <Knob
            label="Gain"
            max={2}
            min={0.5}
            onChange={setValue}
            scale={scale}
            step={0.001}
            value={value}
          />
        );
      }
      const view = render(<Harness />);
      const knob = view.getByRole("slider", { name: "Gain" });
      Object.defineProperty(knob, "setPointerCapture", {
        value: () => undefined,
      });
      const pointer = (type: string, clientY: number, shiftKey = false) =>
        fireEvent(
          knob,
          new dom.window.PointerEvent(type, {
            bubbles: true,
            button: 0,
            clientY,
            pointerId: 1,
            shiftKey,
          })
        );
      pointer("pointerdown", 100);
      pointer("pointermove", 82);
      const normal = Number(knob.getAttribute("aria-valuenow"));
      pointer("pointermove", 82, true);
      expect(Number(knob.getAttribute("aria-valuenow"))).toBe(normal);
      pointer("pointermove", 64, true);
      const fine = Number(knob.getAttribute("aria-valuenow"));
      expect(fine).toBeGreaterThan(normal);
      pointer("pointermove", 64, false);
      expect(Number(knob.getAttribute("aria-valuenow"))).toBe(fine);
      pointer("pointermove", 46, false);
      expect(Number(knob.getAttribute("aria-valuenow")) - fine).toBeGreaterThan(
        fine - normal
      );
      pointer("pointerup", 46);
    });
  }

  test("tooltips delay hover, share the skip delay, and show keyboard descriptions promptly", async () => {
    const { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } =
      await import("@avoid.quest/ui/components/tooltip");
    const view = render(
      <TooltipProvider>
        <Tooltip disableHoverablePopup>
          <TooltipTrigger>First</TooltipTrigger>
          <TooltipContent>First description</TooltipContent>
        </Tooltip>
        <Tooltip disableHoverablePopup>
          <TooltipTrigger>Second</TooltipTrigger>
          <TooltipContent>Second description</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const first = view.getByRole("button", { name: "First" });
    const second = view.getByRole("button", { name: "Second" });
    fireEvent.pointerEnter(first, { pointerType: "mouse" });
    fireEvent.mouseEnter(first);
    fireEvent.mouseMove(first);
    expect(view.queryByRole("tooltip")).toBeNull();
    const firstDescription = await view.findByRole("tooltip");
    expect(first.getAttribute("aria-describedby")).toBe(firstDescription.id);
    fireEvent.mouseLeave(first);
    fireEvent.pointerLeave(first, { pointerType: "mouse" });
    fireEvent.mouseMove(document.body, {
      clientX: 100,
      clientY: 100,
      pointerType: "mouse",
    });
    fireEvent.pointerEnter(second, { pointerType: "mouse" });
    fireEvent.mouseEnter(second);
    fireEvent.mouseMove(second);
    await waitFor(
      () =>
        expect(view.getByRole("tooltip").textContent).toBe(
          "Second description"
        ),
      { timeout: 150 }
    );
    view.unmount();
    const fallback = render(
      <Tooltip>
        <TooltipTrigger>Outside provider</TooltipTrigger>
        <TooltipContent>Keyboard description</TooltipContent>
      </Tooltip>
    );
    const trigger = fallback.getByRole("button", { name: "Outside provider" });
    // JSDOM does not track input modality; simulate pointer focus before keyboard focus.
    const matches = spyOn(trigger, "matches").mockReturnValue(false);
    await act(async () => {
      trigger.focus();
      await Promise.resolve();
    });
    expect(fallback.queryByRole("tooltip")).toBeNull();
    await act(async () => trigger.blur());
    matches.mockReturnValue(true);
    await act(async () => {
      trigger.focus();
      await Promise.resolve();
    });
    matches.mockRestore();
    const keyboardDescription = fallback.getByRole("tooltip");
    expect(keyboardDescription.textContent).toBe("Keyboard description");
    expect(trigger.getAttribute("aria-describedby")).toBe(
      keyboardDescription.id
    );
  });

  test("browser chrome follows resolved light/dark/system theme changes", async () => {
    const style = spyOn(globalThis, "getComputedStyle").mockImplementation(
      () =>
        ({
          backgroundColor: document.documentElement.classList.contains("dark")
            ? "rgb(7, 7, 9)"
            : "rgb(251, 251, 252)",
        }) as CSSStyleDeclaration
    );
    try {
      resolvedTheme = "dark";
      document.documentElement.classList.add("dark");
      const view = render(
        <ThemeProvider>
          <div />
        </ThemeProvider>
      );
      const meta = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]'
      );
      expect(meta?.content).toBe("rgb(7, 7, 9)");
      resolvedTheme = "light";
      view.rerender(
        <ThemeProvider>
          <div />
        </ThemeProvider>
      );
      await act(async () => {
        document.documentElement.classList.remove("dark");
        await Promise.resolve();
      });
      expect(meta?.content).toBe("rgb(251, 251, 252)");
      resolvedTheme = "dark";
      view.rerender(
        <ThemeProvider>
          <div />
        </ThemeProvider>
      );
      await act(async () => {
        document.documentElement.classList.add("dark");
        await Promise.resolve();
      });
      expect(meta?.content).toBe("rgb(7, 7, 9)");
      expect(
        document.querySelectorAll('meta[name="theme-color"]')
      ).toHaveLength(1);
    } finally {
      style.mockRestore();
    }
  });
} else {
  test("settings and control regressions (isolated module mocks)", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, AVOID_QUEST_SETTINGS_REGRESSION: "1" },
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
