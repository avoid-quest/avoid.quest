import { afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

Object.defineProperty(dom.window.navigator, "requestMIDIAccess", {
  configurable: true,
  value: mock(async () => ({ inputs: new Map() })),
});

for (const [key, value] of Object.entries({
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
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

mock.module("@/lib/hooks/use-settings", () => ({
  usePlayerMode: () => "single",
}));

let MidiSettings: typeof import("./midi-settings")["MidiSettings"];
let getMidiControl: typeof import("@/lib/midi")["getMidiControl"];

beforeAll(async () => {
  ({ MidiSettings } = await import("./midi-settings"));
  ({ getMidiControl } = await import("@/lib/midi"));
});

afterEach(() => {
  cleanup();
  const control = getMidiControl();
  control.change({ type: "clear-mappings" });
  control.change({ enabled: false, type: "set-enabled" });
  control.cleanup();
});

test("keeps MIDI settings available outside DJ mode in Chromium", () => {
  const view = render(<MidiSettings />);

  expect(view.queryByText("Web MIDI not supported")).toBeNull();
  expect(
    view.getByText("MIDI mappings are applied in DJ and Node modes.")
  ).toBeTruthy();
  expect(view.getByText("Grant MIDI permission")).toBeTruthy();
  expect(view.getAllByText("Play/Pause")).toHaveLength(2);
  expect(view.getByText("Crossfader")).toBeTruthy();
});
