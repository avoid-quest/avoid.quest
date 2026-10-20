/** biome-ignore-all lint/performance/noJsxPropsBind: Test harnesses record component interactions. */
import { afterEach, expect, mock, test } from "bun:test";
import { installSettingsTestDom } from "./settings-test-dom";

const scenario = process.env.AVOID_QUEST_SETTINGS_BUTTON_REGRESSION;

function installTriggerTestDom() {
  installSettingsTestDom();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => undefined,
      matches: false,
      removeEventListener: () => undefined,
    }),
  });
}

if (scenario === "drawer-fails") {
  installTriggerTestDom();
  // Focus returns to the trigger, which opens its tooltip and measures it.
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
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
  // A throwing factory does not reject the import, so fail on first use.
  mock.module("./settings-drawer", () => ({
    get SettingsDrawer() {
      throw new TypeError("Failed to fetch dynamically imported module");
    },
  }));
  const { cleanup, fireEvent, render, waitFor } = await import(
    "@testing-library/react"
  );
  const { SettingsButton } = await import("./settings-button");

  afterEach(cleanup);

  test("closing a failed drawer load returns focus to the trigger", async () => {
    const view = render(<SettingsButton />);
    const trigger = view.getByRole("button", { name: "Open settings" });
    fireEvent.click(trigger, { detail: 0 });
    const close = await view.findByRole("button", { name: "Close" });
    expect(view.getByRole("alert").textContent).toBe("Couldn't load settings.");
    close.focus();
    fireEvent.click(close);
    await waitFor(() =>
      expect(view.queryByRole("button", { name: "Close" })).toBeNull()
    );
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
} else if (scenario === "drawer-pending") {
  installTriggerTestDom();
  // The drawer suspends until its chunk "arrives", so nothing else handles
  // Escape or clicks while the open request is pending.
  const chunk = Promise.withResolvers<undefined>();
  let arrived = false;
  chunk.promise.then(() => {
    arrived = true;
  });
  mock.module("./settings-drawer", () => ({
    SettingsDrawer: ({ open }: { open: boolean }) => {
      if (!arrived) {
        throw chunk.promise;
      }
      return open ? (
        <div aria-label="Settings" role="dialog">
          Settings
        </div>
      ) : null;
    },
  }));
  const { act, cleanup, fireEvent, render } = await import(
    "@testing-library/react"
  );
  const { SettingsButton } = await import("./settings-button");

  afterEach(cleanup);

  test("Escape or a second activation cancels a pending open", async () => {
    const view = render(<SettingsButton />);
    const trigger = view.getByRole("button", { name: "Open settings" });

    fireEvent.click(trigger, { detail: 0 });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger, { detail: 0 });
    fireEvent.click(trigger, { detail: 0 });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      chunk.resolve(undefined);
      await chunk.promise;
    });
    expect(view.queryByRole("dialog")).toBeNull();

    fireEvent.click(trigger, { detail: 0 });
    expect(await view.findByRole("dialog", { name: "Settings" })).toBeDefined();
  });
} else if (scenario) {
  installTriggerTestDom();
  mock.module("./settings-form", () => ({
    SettingsForm: ({ defaultTab }: { defaultTab?: string }) => (
      <label>
        Settings {defaultTab}
        <input />
      </label>
    ),
  }));
  const { act, cleanup, fireEvent, render, waitFor } = await import(
    "@testing-library/react"
  );
  const { SettingsButton } = await import("./settings-button");

  afterEach(cleanup);

  test("a cold click survives lazy loading, keeps the trigger stable and restores focus on Escape", async () => {
    const view = render(<SettingsButton />);
    const trigger = view.getByRole("button", { name: "Open settings" });
    expect(view.queryByRole("dialog")).toBeNull();
    // Click without focus/hover prefetch, as with programmatic activation.
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const drawer = await view.findByRole("dialog", { name: "Settings" });
    expect(
      view.getByRole("button", { hidden: true, name: "Open settings" })
    ).toBe(trigger);
    expect(trigger.getAttribute("aria-controls")).toBe(drawer.id);
    await waitFor(() =>
      expect(drawer.contains(document.activeElement)).toBe(true)
    );
    fireEvent.keyDown(document.activeElement ?? drawer, { key: "Escape" });
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // Native keyboard activation dispatches a click with detail 0. JSDOM does
    // not synthesize this default action from keydown/keyup.
    fireEvent.click(trigger, { detail: 0 });
    const reopened = await view.findByRole("dialog", { name: "Settings" });
    await waitFor(() =>
      expect(reopened.contains(document.activeElement)).toBe(true)
    );
  });

  test("pointer and focus intent do not open settings; custom triggers retain their default tab", async () => {
    const view = render(
      <SettingsButton
        defaultTab="audio"
        trigger={<button type="button">Change outputs</button>}
      />
    );
    const trigger = view.getByRole("button", { name: "Change outputs" });
    fireEvent.pointerEnter(trigger);
    await act(async () => {
      trigger.focus();
      await Promise.resolve();
    });
    expect(view.queryByRole("dialog")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger, { detail: 0 });
    const input = await view.findByRole("textbox", { name: "Settings audio" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
} else {
  test.each(["1", "drawer-fails", "drawer-pending"])(
    "settings trigger regressions (isolated module mocks: %s)",
    async (scenarioName) => {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        env: {
          ...process.env,
          AVOID_QUEST_SETTINGS_BUTTON_REGRESSION: scenarioName,
        },
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
    },
    25_000
  );
}
