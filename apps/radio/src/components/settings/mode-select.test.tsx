import { afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  MutationObserver: dom.window.MutationObserver,
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

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

let storedMode = "node";

// Module mocks are process-wide in bun, so this keeps the shape the MIDI
// settings test mocks, plus the settings the toggle reads.
mock.module("@/lib/hooks/use-settings", () => ({
  usePlayerMode: () => "single",
  useSettings: () => ({
    data: {
      id: "app-settings",
      player: { mode: storedMode, restoreStateOnLoad: true },
    },
    isReady: true,
    status: "ready",
  }),
}));

let ModeSelect: typeof import("./mode-select")["ModeSelect"];

beforeAll(async () => {
  ({ ModeSelect } = await import("./mode-select"));
});

afterEach(() => {
  cleanup();
  storedMode = "node";
});

test("offers Single, Node and DJ, in that order", () => {
  const view = render(<ModeSelect />);

  const modes = view.getAllByRole("radio");
  expect(modes.map((mode) => mode.getAttribute("aria-label"))).toEqual([
    "Single",
    "Node",
    "DJ",
  ]);
  expect(view.queryByRole("radio", { name: "Multiple" })).toBeNull();
  expect(
    view.getByRole("radio", { name: "Node" }).getAttribute("aria-checked")
  ).toBe("true");
});

test("shows a legacy multiple mode as Node", () => {
  storedMode = "multiple";
  const view = render(<ModeSelect />);

  expect(
    view.getByRole("radio", { name: "Node" }).getAttribute("aria-checked")
  ).toBe("true");
});
