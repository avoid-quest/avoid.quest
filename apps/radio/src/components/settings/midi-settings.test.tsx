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
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  DocumentFragment: dom.window.DocumentFragment,
  Element: dom.window.Element,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
}

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

mock.module("@/lib/hooks/use-settings", () => ({
  usePlayerMode: () => "single",
}));

let MidiSettings: typeof import("./midi-settings")["MidiSettings"];
let useMidiStore: typeof import("@/lib/midi")["useMidiStore"];

beforeAll(async () => {
  ({ MidiSettings } = await import("./midi-settings"));
  ({ useMidiStore } = await import("@/lib/midi"));
});

afterEach(() => {
  cleanup();
  useMidiStore.getState().reset();
});

test("keeps MIDI settings available outside DJ mode in Chromium", () => {
  const view = render(<MidiSettings />);

  expect(view.queryByText("Web MIDI not supported")).toBeNull();
  expect(view.getByText("MIDI mappings are applied in DJ mode.")).toBeTruthy();
  expect(view.getByText("Grant MIDI Permission")).toBeTruthy();
  expect(view.getAllByText("Play/Pause")).toHaveLength(2);
  expect(view.getByText("Crossfader")).toBeTruthy();
});
