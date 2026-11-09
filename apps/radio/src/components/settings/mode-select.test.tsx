import { afterEach, beforeAll, expect, mock, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { browserTestGlobals } from "@/test-utils/browser-globals";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  ...browserTestGlobals(dom.window),
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

const { cleanup, render } = await import("@testing-library/react");

let storedMode = "node";

// Module mocks are process-wide in bun, so this keeps the shape the MIDI
// settings test mocks, plus the settings the toggle reads.
mock.module("@/lib/hooks/use-settings", () => ({
  // Node mode's Output device reads the main output from here.
  useAudioSettings: () => ({
    cueOutputId: null,
    delay: { cueDelayMs: 0, mainDelayMs: 0 },
    mainOutputId: "default",
  }),
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

  const modes = view.getAllByRole("button");
  expect(modes.map((mode) => mode.getAttribute("aria-label"))).toEqual([
    "Single",
    "Node",
    "DJ",
  ]);
  expect(view.queryByRole("button", { name: "Multiple" })).toBeNull();
  expect(
    view.getByRole("button", { name: "Node" }).getAttribute("aria-pressed")
  ).toBe("true");
});

test("shows a legacy multiple mode as Node", () => {
  storedMode = "multiple";
  const view = render(<ModeSelect />);

  expect(
    view.getByRole("button", { name: "Node" }).getAttribute("aria-pressed")
  ).toBe("true");
});
