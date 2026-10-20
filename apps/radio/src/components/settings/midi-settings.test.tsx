import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
// biome-ignore lint/performance/noNamespaceImport: restore the hook spy without replacing the shared module.
import * as settingsHooks from "@/lib/hooks/use-settings";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

Object.defineProperty(dom.window.navigator, "requestMIDIAccess", {
  configurable: true,
  value: mock(async () => ({ inputs: new Map() })),
});

const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
const testGlobals = {
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  navigator: dom.window.navigator,
  window: dom.window,
};
for (const key of Object.keys(testGlobals)) {
  previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
}

function installGlobals() {
  for (const [key, value] of Object.entries(testGlobals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
}
installGlobals();

// React DOM caches input-event support when it first loads.
const { act, cleanup, render } = await import("@testing-library/react");

let MidiSettings: typeof import("./midi-settings")["MidiSettings"];
let getMidiControl: typeof import("@/lib/midi")["getMidiControl"];

beforeAll(async () => {
  ({ MidiSettings } = await import("./midi-settings"));
  ({ getMidiControl } = await import("@/lib/midi"));
});

let playerMode: ReturnType<typeof spyOn<typeof settingsHooks, "usePlayerMode">>;

beforeEach(() => {
  installGlobals();
  playerMode = spyOn(settingsHooks, "usePlayerMode").mockReturnValue("single");
  // Another browser suite may have created the singleton without Web MIDI.
  // Recompute its status only after this test's navigator is installed.
  getMidiControl().cleanup();
});

afterEach(() => {
  cleanup();
  const control = getMidiControl();
  control.change({ type: "clear-mappings" });
  control.change({ enabled: false, type: "set-enabled" });
  control.cleanup();
  playerMode.mockRestore();
});

afterAll(async () => {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  // Leave the shared snapshot consistent with the restored environment.
  getMidiControl().cleanup();
  dom.window.close();
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

test("lists node params under the node's title", () => {
  const binding = getMidiControl().bindActions();
  binding.update([
    {
      dispatch: () => undefined,
      group: "Compressor 2",
      label: "Threshold",
      targetId: "node:comp-2:threshold",
      type: "continuous",
    },
  ]);

  const view = render(<MidiSettings />);

  expect(view.getByRole("heading", { name: "Compressor 2" })).toBeTruthy();
  expect(view.getByText("Threshold")).toBeTruthy();
  // The DJ groups keep their own titles.
  expect(view.queryByRole("heading", { name: "deck-a" })).toBeNull();
});
