/** biome-ignore-all lint/performance/noJsxPropsBind: Test harnesses record component interactions. */
import { afterEach, expect, mock, test } from "bun:test";
import { installSettingsTestDom } from "./settings-test-dom";

if (process.env.AVOID_QUEST_SETTINGS_BUTTON_REGRESSION) {
  installSettingsTestDom();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => undefined,
      matches: false,
      removeEventListener: () => undefined,
    }),
  });
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
  test("settings trigger regressions (isolated module mocks)", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, AVOID_QUEST_SETTINGS_BUTTON_REGRESSION: "1" },
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
