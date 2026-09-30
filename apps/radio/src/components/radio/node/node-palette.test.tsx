/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { useState } from "react";
import type { Radio } from "@/lib/audio";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://radio.test",
});

class ObserverStub {
  disconnect() {
    // JSDOM does not perform layout.
  }

  observe() {
    // JSDOM does not perform layout.
  }

  unobserve() {
    // JSDOM does not perform layout.
  }
}

for (const [key, value] of Object.entries({
  CustomEvent: dom.window.CustomEvent,
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  IntersectionObserver: ObserverStub,
  KeyboardEvent: dom.window.KeyboardEvent,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  navigator: dom.window.navigator,
  ResizeObserver: ObserverStub,
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

// React DOM checks for input events when it loads, so it loads after the DOM.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);

afterEach(cleanup);

let NodePalette: typeof import("./node-palette")["NodePalette"];
let usePaletteShortcut: typeof import("./node-palette")["usePaletteShortcut"];
let isCanvasKey: typeof import("./node-palette")["isCanvasKey"];
let createNodeStore: typeof import("@/lib/node-graph/node-store")["createNodeStore"];
let undoNodeGraph: typeof import("@/lib/node-graph/node-store")["undoNodeGraph"];
let buildNodeGraphFromTemplate: typeof import("@/lib/node-graph/templates")["buildNodeGraphFromTemplate"];
let createNodeEffectConfig: typeof import("@/lib/node-graph/catalogue")["createNodeEffectConfig"];
let nativeNodeWidth: typeof import("./native-strip-nodes")["nativeNodeWidth"];

beforeAll(async () => {
  ({ NodePalette, isCanvasKey, usePaletteShortcut } = await import(
    "./node-palette"
  ));
  ({ createNodeStore, undoNodeGraph } = await import(
    "@/lib/node-graph/node-store"
  ));
  ({ buildNodeGraphFromTemplate } = await import("@/lib/node-graph/templates"));
  ({ createNodeEffectConfig } = await import("@/lib/node-graph/catalogue"));
  ({ nativeNodeWidth } = await import("./native-strip-nodes"));
});

type Request = import("./node-palette").PaletteRequest;
type Store = import("@/lib/node-graph/node-store").NodeStore;

function radio(id: string, name: string): Radio {
  return {
    enabled: true,
    id,
    name,
    streamUrl: `https://radio.example/${id}.mp3`,
  };
}

const kexp = radio("kexp", "KEXP");
const nts = radio("nts", "NTS 1");

function seededStore(): Store {
  return createNodeStore(
    buildNodeGraphFromTemplate("start-from-multiple", { saved: [kexp] })
  );
}

/** The palette as the mode mounts it: `/` opens it, a pick closes it. */
function PaletteHarness({
  store,
  initial = null,
  onLoadTemplate = () => undefined,
}: {
  store: Store;
  initial?: Request | null;
  onLoadTemplate?: (template: string) => void;
}) {
  const [request, setRequest] = useState<Request | null>(initial);
  usePaletteShortcut(() => setRequest({}));
  return (
    <>
      <input aria-label="Elsewhere" />
      <NodePalette
        onClose={() => setRequest(null)}
        onLoadTemplate={onLoadTemplate}
        radios={[kexp, nts]}
        request={request}
        store={store}
      />
    </>
  );
}

function pressSlash(target: EventTarget) {
  act(() => {
    target.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "/",
      })
    );
  });
}

describe("NodePalette", () => {
  test("/ opens the palette, but not while typing", () => {
    const view = render(<PaletteHarness store={seededStore()} />);

    pressSlash(view.getByRole("textbox", { name: "Elsewhere" }));
    expect(view.queryByRole("dialog")).toBeNull();

    pressSlash(document.body);
    const dialog = view.getByRole("dialog", { name: "Add node" });
    expect(dialog).toBeTruthy();
    expect(view.getByRole("region", { name: "Sources" })).toBeTruthy();
    expect(view.getByRole("region", { name: "Templates" })).toBeTruthy();
  });

  test("Enter adds the first match, wired to Speakers, as one undo step", () => {
    const store = seededStore();
    const view = render(<PaletteHarness initial={{}} store={store} />);

    const search = view.getByRole("searchbox", {
      name: "Search nodes and stations",
    });
    fireEvent.change(search, { target: { value: "nts" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(view.queryByRole("dialog")).toBeNull();
    const { graph } = store.state;
    const added = graph?.nodes.find(
      (node) => node.type === "station" && node.data.radio?.id === nts.id
    );
    expect(added).toMatchObject({
      data: { radio: nts },
      type: "station",
    });
    expect(graph?.edges.at(-1)).toMatchObject({
      source: added?.id,
      target: "speakers",
    });

    act(() => {
      undoNodeGraph(store);
    });
    expect(store.state.graph?.nodes.some((node) => node.id === added?.id)).toBe(
      false
    );
  });

  test("a template entry loads the template", () => {
    const onLoadTemplate = mock((_template: string) => undefined);
    const view = render(
      <PaletteHarness
        initial={{}}
        onLoadTemplate={onLoadTemplate}
        store={seededStore()}
      />
    );

    const search = view.getByRole("searchbox", {
      name: "Search nodes and stations",
    });
    fireEvent.change(search, { target: { value: "blank" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onLoadTemplate).toHaveBeenCalledWith("blank");
  });

  test("a cable dropped from an input offers only what feeds it, and wires it", () => {
    const store = seededStore();
    const view = render(
      <PaletteHarness
        initial={{
          from: { handle: "in:audio:main", node: "speakers", type: "target" },
          position: { x: -400, y: 320 },
        }}
        store={store}
      />
    );

    expect(
      view.getByRole("dialog", { name: "Add a node to this cable" })
    ).toBeTruthy();
    expect(view.queryByRole("region", { name: "Templates" })).toBeNull();
    const sources = view.getByRole("region", { name: "Sources" });
    const names = [...sources.querySelectorAll("[role=button] h3")].map(
      (heading) => heading.textContent
    );
    expect(names).toEqual([
      "Station",
      "Track",
      "YouTube",
      "SoundCloud",
      "Bandcamp",
      "File",
      "Audio input",
      "Browser / computer audio",
      "Spotify",
      "Mixcloud",
      "Radio episodes / shows",
      "KEXP",
      "NTS 1",
    ]);
    // An effect can feed Speakers too, so the FX section is on offer.
    expect(view.getByRole("region", { name: "FX" })).toBeTruthy();

    fireEvent.keyDown(
      view.getByRole("searchbox", { name: "Search nodes and stations" }),
      { key: "Enter" }
    );

    const slot = store.state.graph?.nodes.find(
      (node) => node.type === "station" && node.data.radio === null
    );
    expect(slot?.position).toEqual({ x: -400, y: 320 });
    expect(
      store.state.graph?.edges.filter((edge) => edge.source === slot?.id)
    ).toEqual([
      expect.objectContaining({
        target: "speakers",
        targetHandle: "in:audio:main",
      }),
    ]);
  });

  test("I on a cable offers what goes into it, and inserts the pick", () => {
    const store = seededStore();
    const view = render(
      <PaletteHarness
        initial={{ into: "src-kexp->speakers", position: { x: 200, y: 0 } }}
        store={store}
      />
    );

    expect(
      view.getByRole("dialog", { name: "Insert into this cable" })
    ).toBeTruthy();
    expect(view.queryByRole("region", { name: "Sources" })).toBeNull();
    expect(view.queryByRole("region", { name: "Outputs" })).toBeNull();
    expect(view.queryByRole("region", { name: "Templates" })).toBeNull();

    const search = view.getByRole("searchbox", { name: "Search nodes" });
    fireEvent.change(search, { target: { value: "delay" } });
    fireEvent.keyDown(search, { key: "Enter" });

    const delay = store.state.graph?.nodes.find(
      (node) => node.type === "delay"
    );
    expect(delay?.id).toStartWith("delay-");
    expect(
      store.state.graph?.edges.map(
        (edge) => `${edge.id}: ${edge.source} -> ${edge.target}`
      )
    ).toEqual([
      `src-kexp->speakers: src-kexp -> ${delay?.id}`,
      `${delay?.id}->speakers: ${delay?.id} -> speakers`,
    ]);
    act(() => {
      undoNodeGraph(store);
    });
    expect(store.state.graph?.nodes.some((node) => node.id === delay?.id)).toBe(
      false
    );
  });

  test("Swap effect… lists the other effects and swaps in place", () => {
    const store = seededStore();
    act(() => {
      store.setState((state) => ({
        ...state,
        graph: state.graph && {
          ...state.graph,
          nodes: [
            ...state.graph.nodes,
            {
              data: {
                effect: {
                  ...createNodeEffectConfig("delay", "delay"),
                  enabled: true,
                },
              },
              id: "delay",
              position: { x: 0, y: 0 },
              type: "delay",
            },
          ],
        },
      }));
    });
    const view = render(
      <PaletteHarness initial={{ swap: "delay" }} store={store} />
    );

    expect(view.getByRole("dialog", { name: "Swap effect" })).toBeTruthy();
    const fx = view.getByRole("region", { name: "FX" });
    const names = [...fx.querySelectorAll("[role=button] h3")].map(
      (heading) => heading.textContent
    );
    expect(names).toContain("Compressor");
    expect(names).not.toContain("Delay");
    expect(view.queryByRole("region", { name: "Routing" })).toBeNull();

    const search = view.getByRole("searchbox", { name: "Search effects" });
    fireEvent.change(search, { target: { value: "crusher" } });
    fireEvent.keyDown(search, { key: "Enter" });

    const swapped = store.state.graph?.nodes.find(
      (node) => node.id === "delay"
    );
    expect(swapped?.type).toBe("crusher");
    expect(swapped?.data).toMatchObject({
      effect: { enabled: true, id: "delay", type: "crusher" },
    });
  });
});

describe("NodePalette devices", () => {
  const devices = [
    { deviceId: "default", kind: "audioinput", label: "Default - Desk mic" },
    { deviceId: "mic", kind: "audioinput", label: "Desk mic" },
    { deviceId: "default", kind: "audiooutput", label: "Default - Speakers" },
    { deviceId: "usb", kind: "audiooutput", label: "USB interface" },
    { deviceId: "hdmi", kind: "audiooutput", label: "Monitor" },
  ];
  const enumerateDevices = mock(async () => devices);

  // An Output device plays through an <audio> element's setSinkId.
  class FakeMediaElement {
    setSinkId() {
      return Promise.resolve();
    }
  }

  beforeAll(() => {
    Object.defineProperty(dom.window.navigator, "mediaDevices", {
      configurable: true,
      value: {
        addEventListener: () => undefined,
        enumerateDevices,
        getUserMedia: mock(async () => ({ getTracks: () => [] })),
        removeEventListener: () => undefined,
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "AudioContext");
    Reflect.deleteProperty(globalThis, "HTMLMediaElement");
  });

  function sectionNames(
    view: ReturnType<typeof render>,
    name: string
  ): string[] {
    const section = view.getByRole("region", { name });
    return [...section.querySelectorAll("[role=button] h3")].map(
      (heading) => heading.textContent ?? ""
    );
  }

  async function openPalette() {
    const store = createNodeStore(
      buildNodeGraphFromTemplate("starter", { saved: [] })
    );
    const view = render(<PaletteHarness initial={{}} store={store} />);
    // The device list loads after the palette opens.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { store, view };
  }

  test("Sources list Audio input and each input the browser lists", async () => {
    const { store, view } = await openPalette();

    expect(sectionNames(view, "Sources")).toEqual([
      "Station",
      "Track",
      "YouTube",
      "SoundCloud",
      "Bandcamp",
      "File",
      "Audio input",
      "Default - Desk mic",
      "Desk mic",
      "Browser / computer audio",
      "Spotify",
      "Mixcloud",
      "Radio episodes / shows",
      "KEXP",
      "NTS 1",
    ]);

    const search = view.getByRole("searchbox", {
      name: "Search nodes and stations",
    });
    fireEvent.change(search, { target: { value: "desk mic" } });
    fireEvent.keyDown(search, { key: "Enter" });

    const input = store.state.graph?.nodes.find(
      (node) => node.type === "deviceIn"
    );
    expect(input?.data).toMatchObject({
      deviceId: "default",
      deviceLabel: "Default - Desk mic",
    });
  });

  test("a platform's name adds the Track locked to it, not the plain Track", async () => {
    const { store, view } = await openPalette();

    const search = view.getByRole("searchbox", {
      name: "Search nodes and stations",
    });
    fireEvent.change(search, { target: { value: "youtube" } });
    fireEvent.keyDown(search, { key: "Enter" });

    const track = store.state.graph?.nodes.find(
      (node) => node.type === "platform"
    );
    expect(track?.data).toMatchObject({
      radio: null,
      searchPlatform: "youtube",
    });
  });

  test("Outputs list one Output device per output, beside Speakers", async () => {
    Object.defineProperty(globalThis, "HTMLMediaElement", {
      configurable: true,
      value: FakeMediaElement,
      writable: true,
    });
    const { view } = await openPalette();

    expect(sectionNames(view, "Outputs")).toEqual(["USB interface", "Monitor"]);
  });

  test("without setSinkId the palette offers no Output device", async () => {
    Object.defineProperty(globalThis, "HTMLMediaElement", {
      configurable: true,
      value: class {},
      writable: true,
    });
    // AudioContext.setSinkId alone can't point an <audio> at a device.
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: class {
        setSinkId() {
          return Promise.resolve();
        }
      },
      writable: true,
    });
    const { view } = await openPalette();

    expect(view.queryByRole("region", { name: "Outputs" })).toBeNull();
  });
});

describe("isCanvasKey", () => {
  test("canvas keys act from the canvas or nothing focused, not elsewhere", () => {
    const canvas = document.createElement("div");
    const node = document.createElement("div");
    const slot = document.createElement("input");
    const playButton = document.createElement("button");
    const volume = document.createElement("span");
    volume.setAttribute("role", "slider");
    node.appendChild(playButton);
    node.appendChild(volume);
    canvas.appendChild(node);
    canvas.appendChild(slot);
    const stageButton = document.createElement("button");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const dialogButton = document.createElement("button");
    dialog.appendChild(dialogButton);
    for (const element of [canvas, stageButton, dialog]) {
      document.body.appendChild(element);
    }

    expect(isCanvasKey(node, canvas)).toBe(true);
    expect(isCanvasKey(document.body, canvas)).toBe(true);
    expect(isCanvasKey(slot, canvas)).toBe(false);
    expect(isCanvasKey(playButton, canvas)).toBe(false);
    expect(isCanvasKey(volume, canvas)).toBe(false);
    expect(isCanvasKey(stageButton, canvas)).toBe(false);
    expect(isCanvasKey(dialogButton, canvas)).toBe(false);
    expect(isCanvasKey(node, null)).toBe(false);

    canvas.remove();
    stageButton.remove();
    dialog.remove();
  });

  test("a right-edge drop lands the picked node's output port at the cursor", () => {
    const store = seededStore();
    const view = render(
      <PaletteHarness
        initial={{
          edge: "right",
          from: { handle: "in:audio:main", node: "speakers", type: "target" },
          position: { x: -400, y: 320 },
        }}
        store={store}
      />
    );

    const search = view.getByRole("searchbox", {
      name: "Search nodes and stations",
    });
    fireEvent.change(search, { target: { value: "pan" } });
    fireEvent.keyDown(search, { key: "Enter" });

    const pan = store.state.graph?.nodes.find((node) => node.type === "pan");
    expect(pan?.position).toEqual({ x: -400 - nativeNodeWidth("pan"), y: 320 });
  });
});
