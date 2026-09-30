/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { EffectConfig } from "@/lib/audio";

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
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  IntersectionObserver: ObserverStub,
  KeyboardEvent: dom.window.KeyboardEvent,
  MouseEvent: dom.window.MouseEvent,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  navigator: dom.window.navigator,
  ResizeObserver: ObserverStub,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  SVGElement: dom.window.SVGElement,
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

// Radix Select measures and scrolls, which JSDOM does not do.
for (const [key, value] of Object.entries({
  hasPointerCapture: (): boolean => false,
  releasePointerCapture: (): void => undefined,
  scrollIntoView: (): void => undefined,
})) {
  Object.defineProperty(dom.window.HTMLElement.prototype, key, {
    configurable: true,
    value,
    writable: true,
  });
}

type EffectNodeModule = typeof import("./effect-node");
let EffectNode: EffectNodeModule["EffectNode"];
let EffectNodeBody: EffectNodeModule["EffectNodeBody"];
let firstLayoutRow: EffectNodeModule["firstLayoutRow"];
let BackendBadge: typeof import("./backend-badge")["BackendBadge"];
let NativeNodeBody: typeof import("./native-strip-nodes")["NativeNodeBody"];
let createDefaultEffectConfig: typeof import("@/lib/audio/dsp/effects/registry")["createDefaultEffectConfig"];
let EFFECT_TYPES: typeof import("@/lib/audio/dsp/effects/types")["EFFECT_TYPES"];
let EFFECT_LAYOUTS: typeof import("@/components/audio/effect-params/effect-layouts")["EFFECT_LAYOUTS"];
let nodeStoreModule: typeof import("@/lib/node-graph/node-store");
let nodeGraphSchema: typeof import("@/lib/node-graph/schema")["nodeGraphSchema"];
let Store: typeof import("@tanstack/react-store")["Store"];
let flow: typeof import("./flow-adapter");
let NodeActionsProvider: typeof import("./node-actions")["NodeActionsProvider"];
let moduleFrame: typeof import("./module-frame");
let catalogue: typeof import("@/lib/node-graph/catalogue");
let nodePort: typeof import("./node-port");

beforeAll(async () => {
  ({ EffectNode, EffectNodeBody, firstLayoutRow } = await import(
    "./effect-node"
  ));
  ({ BackendBadge } = await import("./backend-badge"));
  ({ NativeNodeBody } = await import("./native-strip-nodes"));
  ({ createDefaultEffectConfig } = await import(
    "@/lib/audio/dsp/effects/registry"
  ));
  ({ EFFECT_TYPES } = await import("@/lib/audio/dsp/effects/types"));
  ({ EFFECT_LAYOUTS } = await import(
    "@/components/audio/effect-params/effect-layouts"
  ));
  nodeStoreModule = await import("@/lib/node-graph/node-store");
  ({ nodeGraphSchema } = await import("@/lib/node-graph/schema"));
  ({ Store } = await import("@tanstack/react-store"));
  flow = await import("./flow-adapter");
  ({ NodeActionsProvider } = await import("./node-actions"));
  moduleFrame = await import("./module-frame");
  catalogue = await import("@/lib/node-graph/catalogue");
  nodePort = await import("./node-port");
});

const noop = () => undefined;
const OPTIONS_BUTTON = /^Options for /;

/** The controls' names end in their label: "Compressor threshold". */
function endsWith(label: string): RegExp {
  return new RegExp(` ${label}$`, "i");
}

function renderBody(
  effect: EffectConfig,
  props: Partial<Parameters<typeof EffectNodeBody>[0]> = {}
) {
  return render(
    <EffectNodeBody
      effect={effect}
      onChange={noop}
      onRelease={noop}
      onRemove={noop}
      onStep={noop}
      {...props}
    />
  );
}

/** The accessible role each kind of body control has. */
const CONTROL_ROLES = {
  checkbox: "switch",
  select: "combobox",
  slider: "slider",
} as const;

describe("EffectNodeBody", () => {
  test("renders every shipped FX type with its first layout row", () => {
    const shipped = EFFECT_TYPES.filter((type) => type !== "werkstatt");
    expect(shipped).toHaveLength(21);

    for (const type of shipped) {
      const effect = createDefaultEffectConfig(type, `fx-${type}`, 0);
      const view = renderBody(effect);
      const controls = firstLayoutRow(type);

      expect(controls.length).toBeGreaterThan(0);
      expect(controls.length).toBeLessThanOrEqual(4);
      const layoutRow = EFFECT_LAYOUTS[type]?.rows[0]?.keys;
      if (layoutRow) {
        expect(controls.map((control) => control.param.key)).toEqual(
          layoutRow.slice(0, 4)
        );
      }
      for (const { param, label } of controls) {
        const role =
          CONTROL_ROLES[param.type as keyof typeof CONTROL_ROLES] ?? "slider";
        const control = view.getByRole(role, {
          name: endsWith(label),
        });
        expect(control).toBeTruthy();
        // The label is a sans row beside the control, not a knob caption.
        expect(view.getAllByText(label).length).toBeGreaterThan(0);
      }
      expect(view.getByRole("button", { name: OPTIONS_BUTTON })).toBeTruthy();
      cleanup();
    }
  });

  test("the enable switch and a select each take an undo step", () => {
    const onStep = mock((_patch: Partial<EffectConfig>) => undefined);
    const view = renderBody(createDefaultEffectConfig("compressor", "c1", 0), {
      onStep,
    });

    fireEvent.click(view.getByRole("switch", { name: "Compressor on" }));

    expect(onStep).toHaveBeenCalledWith({ enabled: true });
  });

  test("a numeric select commits a number, as the effect rack does", async () => {
    const onStep = mock((_patch: Partial<EffectConfig>) => undefined);
    const view = renderBody(createDefaultEffectConfig("fold", "f1", 0), {
      onStep,
    });

    fireEvent.keyDown(
      view.getByRole("combobox", { name: endsWith("Oversample") }),
      { key: "Enter" }
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    fireEvent.click(view.getByRole("option", { name: "8x" }));

    expect(onStep).toHaveBeenCalledWith({ oversample: 8 });
  });

  test("its menu offers Swap effect… when the node can swap", () => {
    const onSwap = mock(() => undefined);
    const view = renderBody(createDefaultEffectConfig("delay", "d1", 0), {
      onSwap,
    });

    act(() => {
      fireEvent.keyDown(view.getByRole("button", { name: OPTIONS_BUTTON }), {
        key: "Enter",
      });
    });
    act(() => {
      fireEvent.click(view.getByRole("menuitem", { name: "Swap effect…" }));
    });

    expect(onSwap).toHaveBeenCalledTimes(1);
    cleanup();

    const plain = renderBody(createDefaultEffectConfig("delay", "d1", 0));
    act(() => {
      fireEvent.keyDown(plain.getByRole("button", { name: OPTIONS_BUTTON }), {
        key: "Enter",
      });
    });
    expect(plain.queryByRole("menuitem", { name: "Swap effect…" })).toBeNull();
  });

  test("shows a backend badge in its header", () => {
    const view = renderBody(createDefaultEffectConfig("limiter", "l1", 0), {
      badge: "compat",
    });

    expect(view.getByText("compat")).toBeTruthy();
  });

  test("arrow keys on a focused knob turn it", () => {
    const onChange = mock((_patch: Partial<EffectConfig>) => undefined);
    const outside = mock(() => undefined);
    const effect = createDefaultEffectConfig("compressor", "c1", 0);
    const view = render(
      // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the canvas node wrapper
      // biome-ignore lint/a11y/noNoninteractiveElementInteractions: stands in for the canvas node wrapper
      <div onKeyDown={outside}>
        <EffectNodeBody
          effect={effect}
          onChange={onChange}
          onRelease={noop}
          onRemove={noop}
          onStep={noop}
        />
      </div>
    );

    const knob = view.getByRole("slider", { name: "Compressor threshold" });
    knob.focus();
    fireEvent.keyDown(knob, { key: "ArrowUp" });

    expect(onChange).toHaveBeenCalledTimes(1);
    const [patch] = onChange.mock.calls[0] ?? [];
    expect((patch as { threshold: number }).threshold).toBeGreaterThan(
      (effect as { threshold: number }).threshold
    );
    expect(outside).not.toHaveBeenCalled();
  });
});

describe("EffectNode on the canvas", () => {
  const compressorEffect = () => ({
    ...createDefaultEffectConfig("compressor", "comp", 0),
    enabled: true,
  });

  /** A selected Compressor on a real React Flow, and its position moves. */
  function mountCompressor(effect: EffectConfig) {
    nodeStoreModule.loadNodeGraph(
      nodeGraphSchema.parse({
        edges: [],
        nodes: [
          {
            data: { effect },
            id: "comp",
            position: { x: 0, y: 0 },
            type: "compressor",
          },
        ],
        version: 2,
      })
    );
    const onNodesChange = mock((_changes: unknown[]) => undefined);
    const actions = {
      fillSource: noop,
      fillStation: noop,
      fillStationFromUrl: async () => null,
      handleDeleteRadio: noop,
      handleEditRadio: noop,
      handleSaveSessionRadio: noop,
      handleToggleRadio: noop,
      radios: [],
      removeNode: noop,
      saveDiscoveredStation: noop,
      selectDiscoveredForStation: noop,
      swapEffect: noop,
    } as unknown as Parameters<typeof NodeActionsProvider>[0]["value"];

    function Canvas() {
      const graph = nodeStoreModule.useNodeGraph();
      const node = graph?.nodes[0];
      return (
        <div style={{ height: 600, width: 800 }}>
          <flow.ReactFlow
            nodes={
              node
                ? [
                    {
                      data: node.data,
                      id: node.id,
                      position: node.position,
                      selected: true,
                      type: node.type,
                    },
                  ]
                : []
            }
            nodeTypes={{ compressor: EffectNode }}
            onNodesChange={onNodesChange}
          />
        </div>
      );
    }

    const view = render(
      <NodeActionsProvider value={actions}>
        <flow.ReactFlowProvider>
          <Canvas />
        </flow.ReactFlowProvider>
      </NodeActionsProvider>
    );
    const moves = () =>
      onNodesChange.mock.calls
        .flatMap(([changes]) => changes as { type: string }[])
        .filter((change) => change.type === "position");
    // React Flow keeps a node hidden until it is measured, which JSDOM
    // never is, and a hidden element has no accessible name.
    const byLabel = (selector: string) =>
      view.container.querySelector(selector) as HTMLElement;
    return { byLabel, moves, onNodesChange, view };
  }

  afterEach(() => {
    nodeStoreModule.loadNodeGraph(null);
  });

  test("arrow keys on a focused knob change its value and do not move the node", () => {
    const effect = compressorEffect();
    const { byLabel, moves, onNodesChange, view } = mountCompressor(effect);
    const wrapper = view.container.querySelector(
      ".react-flow__node"
    ) as HTMLElement | null;
    expect(wrapper).toBeTruthy();

    // The harness moves a selected node: an arrow on the node itself does.
    act(() => {
      fireEvent.keyDown(wrapper as HTMLElement, { key: "ArrowRight" });
    });
    expect(moves().length).toBeGreaterThan(0);
    onNodesChange.mockClear();

    const knob = byLabel('[role="slider"][aria-label="Compressor threshold"]');
    knob.focus();
    act(() => {
      fireEvent.keyDown(knob, { key: "ArrowUp" });
    });

    const stored = nodeStoreModule.nodeStore.state.graph?.nodes[0]?.data as
      | { effect: { threshold: number } }
      | undefined;
    expect(stored?.effect.threshold).toBeGreaterThan(
      (effect as { threshold: number }).threshold
    );
    expect(knob.getAttribute("aria-valuenow")).toBe(
      String(stored?.effect.threshold)
    );
    expect(moves()).toEqual([]);
  });

  test("keys in the header's switch and menu do not move the node", () => {
    const { byLabel, moves } = mountCompressor(compressorEffect());

    const toggle = byLabel('[role="switch"][aria-label="Compressor on"]');
    toggle.focus();
    act(() => {
      fireEvent.keyDown(toggle, { key: "ArrowRight" });
    });
    expect(moves()).toEqual([]);

    // The menu portals out of the node, but its keys bubble through React.
    const trigger = byLabel('[aria-label="Options for Compressor"]');
    act(() => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    const menu = document.querySelector('[role="menu"]') as HTMLElement | null;
    expect(menu).toBeTruthy();
    act(() => {
      fireEvent.keyDown(menu as HTMLElement, { key: "ArrowDown" });
    });
    expect(moves()).toEqual([]);
  });

  test("Cmd+Z from a focused knob still reaches the app's shortcuts", () => {
    const { byLabel } = mountCompressor(compressorEffect());
    const seen: string[] = [];
    const listener = (event: KeyboardEvent) => {
      seen.push(`${event.metaKey ? "Meta+" : ""}${event.key}`);
    };
    window.addEventListener("keydown", listener);
    try {
      const knob = byLabel(
        '[role="slider"][aria-label="Compressor threshold"]'
      );
      knob.focus();
      act(() => {
        fireEvent.keyDown(knob, { key: "z", metaKey: true });
        fireEvent.keyDown(knob, { key: "Backspace" });
        fireEvent.keyDown(knob, { key: "ArrowUp" });
      });
    } finally {
      window.removeEventListener("keydown", listener);
    }

    // Undo goes on; Delete and the arrows stay on the knob.
    expect(seen).toEqual(["Meta+z"]);
  });
});

describe("BackendBadge", () => {
  test("shows what node playback published for the node, and nothing else", () => {
    const store = new Store<Record<string, "compat" | "bypassed">>({
      comp: "compat",
    });
    const view = render(
      <>
        <BackendBadge nodeId="comp" store={store} />
        <BackendBadge nodeId="other" store={store} />
      </>
    );

    expect(view.getByText("compat")).toBeTruthy();

    act(() => {
      store.setState(() => ({ comp: "bypassed" }));
    });

    expect(view.queryByText("compat")).toBeNull();
    expect(view.getByText("bypassed").getAttribute("title")).toContain(
      "plays dry"
    );
  });
});

describe("NativeNodeBody", () => {
  test("Filter, Pan and Gain render their controls", () => {
    const filter = render(
      <NativeNodeBody
        node={{
          data: { frequency: 1000, Q: 1, type: "lowpass" },
          id: "f",
          position: { x: 0, y: 0 },
          type: "filter",
        }}
        onChange={noop}
        onRelease={noop}
        onRemove={noop}
        onStep={noop}
      />
    );
    expect(filter.getByRole("combobox", { name: "Filter type" })).toBeTruthy();
    expect(filter.getByRole("slider", { name: "Filter cutoff" })).toBeTruthy();
    expect(filter.getByRole("slider", { name: "Filter Q" })).toBeTruthy();
    expect(filter.queryByRole("switch")).toBeNull();
    cleanup();

    const onChange = mock((_patch: unknown) => undefined);
    const pan = render(
      <NativeNodeBody
        node={{
          data: { pan: 0 },
          id: "p",
          position: { x: 0, y: 0 },
          type: "pan",
        }}
        onChange={onChange}
        onRelease={noop}
        onRemove={noop}
        onStep={noop}
      />
    );
    fireEvent.keyDown(pan.getByRole("slider", { name: "Pan" }), {
      key: "ArrowLeft",
    });
    expect(onChange).toHaveBeenCalledWith({ pan: -0.01 });
    cleanup();

    // A stored trim anywhere in the schema's range stays within the knob's.
    const gain = render(
      <NativeNodeBody
        node={{
          data: { gainDb: 18 },
          id: "g",
          position: { x: 0, y: 0 },
          type: "gain",
        }}
        onChange={onChange}
        onRelease={noop}
        onRemove={noop}
        onStep={noop}
      />
    );
    const knob = gain.getByRole("slider", { name: "Gain" });
    expect(Number(knob.getAttribute("aria-valuemax"))).toBeGreaterThanOrEqual(
      Number(knob.getAttribute("aria-valuenow"))
    );
  });
});

describe("NodePort", () => {
  /**
   * A patch on a real canvas whose nodes draw only their ports, so each
   * port counts its cables with React Flow's `useNodeConnections`.
   */
  function renderPorts(
    nodes: import("./flow-adapter").FlowNode[],
    edges: import("./flow-adapter").FlowEdge[]
  ) {
    const PortsOnly = ({
      type,
    }: {
      type: "merge" | "compressor" | "station";
    }) => <moduleFrame.ModulePorts title={type} type={type} />;
    const view = render(
      <flow.ReactFlowProvider>
        <nodePort.FlowPortsRoot>
          <div style={{ height: 600, width: 800 }}>
            <flow.ReactFlow
              edges={edges}
              nodes={nodes}
              nodeTypes={{
                compressor: () => <PortsOnly type="compressor" />,
                merge: () => <PortsOnly type="merge" />,
                station: () => <PortsOnly type="station" />,
              }}
            />
          </div>
        </nodePort.FlowPortsRoot>
      </flow.ReactFlowProvider>
    );
    const port = (node: string, handle: string) =>
      view.container.querySelector(
        `.react-flow__handle[data-nodeid="${node}"][data-handleid="${handle}"]`
      ) as HTMLElement;
    return { port, view };
  }

  const at = { x: 0, y: 0 };
  const stations = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      data: {},
      id: `s${index}`,
      position: at,
      type: "station",
    }));
  const cablesInto = (
    target: string,
    handle: string,
    count: number,
    first = 0
  ) =>
    Array.from({ length: count }, (_, index) => ({
      id: `s${first + index}->${target}`,
      source: `s${first + index}`,
      sourceHandle: "out:audio:main",
      target,
      targetHandle: handle,
    }));
  const takes = (element: HTMLElement) => ({
    end: element.classList.contains("connectableend"),
    start: element.classList.contains("connectablestart"),
  });

  test("a Merge input holding eight cables takes no ninth", () => {
    const merge = { data: {}, id: "mix", position: at, type: "merge" };
    const seven = renderPorts(
      [...stations(8), merge],
      cablesInto("mix", "in:audio:main", 7)
    );
    expect(takes(seven.port("mix", "in:audio:main"))).toEqual({
      end: true,
      start: true,
    });
    seven.view.unmount();

    const eight = renderPorts(
      [...stations(8), merge],
      cablesInto("mix", "in:audio:main", 8)
    );
    expect(takes(eight.port("mix", "in:audio:main"))).toEqual({
      end: false,
      start: false,
    });
    // An output takes any number.
    expect(takes(eight.port("mix", "out:audio:main")).start).toBe(true);
  });

  test("a Compressor key with one cable is locked for a second", () => {
    const { port } = renderPorts(
      [
        ...stations(1),
        { data: {}, id: "comp", position: at, type: "compressor" },
      ],
      cablesInto("comp", "in:sidechain:key", 1)
    );
    const key = port("comp", "in:sidechain:key");
    expect(key.dataset.kind).toBe("sidechain");
    expect(takes(key)).toEqual({ end: false, start: false });
    expect(takes(port("comp", "in:audio:main")).end).toBe(true);
  });

  test("while a cable is dragged, a port lights up or locks by the drag's verdict", () => {
    const input = catalogue.findPort("compressor", "in", "audio", "main");
    if (!input) {
      throw new Error("Expected a Compressor input");
    }
    const props = { label: "Input", port: input, type: "compressor" } as const;
    expect(
      moduleFrame.nodePortState({ ...props, cables: 0, hint: undefined })
    ).toEqual({
      className: "",
      isConnectableEnd: true,
      isConnectableStart: true,
      title: "Input",
    });
    expect(
      moduleFrame.nodePortState({ ...props, cables: 0, hint: { ok: true } })
    ).toMatchObject({ className: "node-port-accept", isConnectableEnd: true });
    // A verdict beats the count both ways: a drag may be refused by a
    // free port, and the count is what it was when the drag started.
    expect(
      moduleFrame.nodePortState({
        ...props,
        cables: 0,
        hint: {
          code: "self-loop",
          message: "A module can't feed itself",
          ok: false,
        },
      })
    ).toEqual({
      className: "node-port-locked",
      isConnectableEnd: false,
      isConnectableStart: true,
      title: "A module can't feed itself",
    });
  });
});
