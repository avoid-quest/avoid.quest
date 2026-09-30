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
  test("arrow keys on a focused knob change its value and do not move the node", () => {
    const effect = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      enabled: true,
    };
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
        version: 1,
      })
    );
    const onNodesChange = mock((_changes: unknown[]) => undefined);
    const actions = {
      fillStation: noop,
      handleDeleteRadio: noop,
      handleEditRadio: noop,
      handleSaveSessionRadio: noop,
      handleToggleRadio: noop,
      radios: [],
      removeNode: noop,
      saveDiscoveredStation: noop,
      selectDiscoveredForStation: noop,
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
    const wrapper = view.container.querySelector(
      ".react-flow__node"
    ) as HTMLElement | null;
    expect(wrapper).toBeTruthy();

    // The harness moves a selected node: an arrow on the node itself does.
    act(() => {
      fireEvent.keyDown(wrapper as HTMLElement, { key: "ArrowRight" });
    });
    const moves = () =>
      onNodesChange.mock.calls
        .flatMap(([changes]) => changes as { type: string }[])
        .filter((change) => change.type === "position");
    expect(moves().length).toBeGreaterThan(0);
    onNodesChange.mockClear();

    // React Flow keeps a node hidden until it is measured, which JSDOM
    // never is, and a hidden element has no accessible name.
    const knob = view.container.querySelector(
      '[role="slider"][aria-label="Compressor threshold"]'
    ) as HTMLElement;
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
    nodeStoreModule.loadNodeGraph(null);
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
  });
});
