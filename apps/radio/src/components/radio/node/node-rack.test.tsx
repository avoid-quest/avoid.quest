/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import { type CompileEnv, compile } from "@/lib/node-graph/compile";
import {
  type NodeGraph,
  type NodeGraphInput,
  nodeGraphSchema,
} from "@/lib/node-graph/schema";
import {
  AUDIO_IN_HANDLE,
  AUDIO_OUT_HANDLE,
  buildNodeGraphFromTemplate,
  SPEAKERS_NODE_ID,
} from "@/lib/node-graph/templates";
import {
  resetAllPlaybackRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import type { NodeActions } from "./node-actions";

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
  document: dom.window.document,
  Element: dom.window.Element,
  fetch: () => Promise.reject(new Error("offline")),
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  IntersectionObserver: ObserverStub,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
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
const { cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);

let NodeRack: typeof import("./node-rack")["NodeRack"];
let NodeActionsProvider: typeof import("./node-actions")["NodeActionsProvider"];

beforeAll(async () => {
  ({ NodeRack } = await import("./node-rack"));
  ({ NodeActionsProvider } = await import("./node-actions"));
});

afterEach(() => {
  cleanup();
  resetAllPlaybackRuntime();
  inspectNode.mockClear();
});

const ENV: CompileEnv = { crossOriginIsolated: false, profile: "desktop" };
const position = { x: 0, y: 0 };
const noop = () => undefined;
const asyncNoop = async () => undefined;

type NodeInput = NodeGraphInput["nodes"][number];

function station(id: string, name: string, enabled = true): NodeInput {
  return {
    data: {
      radio: {
        enabled,
        id,
        name,
        streamUrl: `https://radio.example/${id}.mp3`,
      },
    },
    id,
    position,
    type: "station",
  };
}

function cable(source: string, target: string) {
  return {
    id: `${source}->${target}`,
    source,
    sourceHandle: AUDIO_OUT_HANDLE,
    target,
    targetHandle: AUDIO_IN_HANDLE,
  };
}

/**
 * KEXP straight to Speakers, NTS through a Delay, FIP with no cable out and
 * a hidden station still wired in.
 */
function buildGraph(): NodeGraph {
  return nodeGraphSchema.parse({
    edges: [
      cable("kexp", SPEAKERS_NODE_ID),
      cable("nts", "nts-delay"),
      cable("nts-delay", SPEAKERS_NODE_ID),
      cable("hidden", SPEAKERS_NODE_ID),
    ],
    nodes: [
      station("kexp", "KEXP"),
      station("nts", "NTS 1"),
      {
        data: { effect: createNodeEffectConfig("delay", "nts-delay") },
        id: "nts-delay",
        position,
        type: "delay",
      },
      station("fip", "FIP"),
      station("hidden", "Hidden FM", false),
      { data: {}, id: SPEAKERS_NODE_ID, position, type: "speakers" },
    ],
    version: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
  } satisfies NodeGraphInput);
}

const inspectNode = mock((_nodeId: string) => undefined);

/** A saved station's menu button, "Options for KEXP". */
const STATION_MENU = /^Options for/;

const actions: NodeActions = {
  fillSource: asyncNoop,
  fillStation: asyncNoop,
  fillStationFromUrl: async () => null,
  handleDeleteRadio: noop,
  handleEditRadio: noop,
  handleSaveSessionRadio: noop,
  handleToggleRadio: asyncNoop,
  inspectNode,
  radios: [],
  removeNode: noop,
  saveDiscoveredStation: noop,
  selectDiscoveredForStation: noop,
  swapEffect: noop,
};

function renderRack(graph: NodeGraph) {
  const controls = {
    setPlaying: mock(async (_nodeId: string, _playing: boolean) => undefined),
    setVolume: mock((_nodeId: string, _volume: number) => undefined),
    toggleMute: mock((_nodeId: string) => undefined),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <NodeActionsProvider value={actions}>
        <NodeRack controls={controls} env={ENV} graph={graph} />
      </NodeActionsProvider>
    </QueryClientProvider>
  );
  return { controls, view };
}

describe("NodeRack", () => {
  test("lists one row per lane from the compiled plan, grouped by output", () => {
    const graph = buildGraph();
    const plan = compile(graph, ENV);
    const { view } = renderRack(graph);

    const direct = view.getByRole("list", { name: "Direct to Speakers" });
    const unwired = view.getByRole("list", { name: "Not connected" });
    const laneRows = [
      ...within(direct).getAllByRole("listitem"),
      ...within(unwired).getAllByRole("listitem"),
    ];

    expect(plan.lanes.size).toBe(3);
    expect(
      laneRows.map((row) =>
        row.querySelector("[data-node-id]")?.getAttribute("data-node-id")
      )
    ).toEqual(
      [...plan.lanes.keys()].filter((id) => id !== "fip").concat("fip")
    );
    expect(within(direct).getByText("KEXP")).toBeTruthy();
    expect(within(direct).getByText("NTS 1")).toBeTruthy();
    expect(within(unwired).getByText("FIP")).toBeTruthy();
    // The Delay lowered into NTS's lane shows as a chip on its row.
    expect(within(direct).getByText("Delay")).toBeTruthy();
    // A hidden station has no lane: it is listed apart, with no controls.
    const hidden = view.getByRole("list", { name: "Hidden" });
    expect(within(hidden).getByText("Hidden FM")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Play Hidden FM" })).toBeNull();
  });

  test("lists an Audio input lane next to the Stations, grouped by its outputs", () => {
    const graph = nodeGraphSchema.parse({
      edges: [
        cable("kexp", SPEAKERS_NODE_ID),
        cable("mic", SPEAKERS_NODE_ID),
        cable("mic", "desk"),
      ],
      nodes: [
        station("kexp", "KEXP"),
        {
          data: { deviceId: "mic", deviceLabel: "Desk mic" },
          id: "mic",
          position,
          type: "deviceIn",
        },
        {
          data: { deviceId: "usb", deviceLabel: "USB interface" },
          id: "desk",
          position,
          type: "deviceOut",
        },
        { data: {}, id: SPEAKERS_NODE_ID, position, type: "speakers" },
      ],
      version: 1,
    } satisfies NodeGraphInput);
    const { controls, view } = renderRack(graph);

    const both = view.getByRole("list", {
      name: "Direct to USB interface and Speakers",
    });
    fireEvent.click(
      within(both).getByRole("button", { name: "Go live Desk mic" })
    );
    expect(controls.setPlaying).toHaveBeenLastCalledWith("mic", true);
    fireEvent.keyDown(
      within(both).getByRole("slider", { name: "Volume Desk mic" }),
      { key: "ArrowLeft" }
    );
    expect(controls.setVolume).toHaveBeenLastCalledWith("mic", 0.99);
    // An input is no saved station: no station menu on its row.
    expect(
      within(both).queryByRole("button", { name: STATION_MENU })
    ).toBeNull();
    expect(view.getByRole("list", { name: "Direct to Speakers" })).toBeTruthy();
  });

  test("every Station's play and volume are reachable by role", () => {
    const graph = buildGraph();
    const plan = compile(graph, ENV);
    setPlaybackChannelRuntime("n:nts", () => ({ isPlaying: true }));
    const { controls, view } = renderRack(graph);

    for (const lane of plan.lanes.values()) {
      const { name } = lane.radio;
      const playing = lane.id === "nts";
      fireEvent.click(
        view.getByRole("button", {
          name: `${playing ? "Pause" : "Play"} ${name}`,
        })
      );
      expect(controls.setPlaying).toHaveBeenLastCalledWith(lane.id, !playing);

      const volume = view.getByRole("slider", { name: `Volume ${name}` });
      expect(volume.getAttribute("aria-valuetext")).toBe("100%");
      fireEvent.keyDown(volume, { key: "ArrowLeft" });
      expect(controls.setVolume).toHaveBeenLastCalledWith(lane.id, 0.99);

      fireEvent.click(view.getByRole("button", { name: `Mute ${name}` }));
      expect(controls.toggleMute).toHaveBeenLastCalledWith(lane.id);
    }
    expect(controls.setPlaying).toHaveBeenCalledTimes(plan.lanes.size);
  });

  test("a lane's FX chip opens the inspector for that effect", () => {
    const { view } = renderRack(buildGraph());

    fireEvent.click(view.getByRole("button", { name: "Delay settings" }));

    expect(inspectNode).toHaveBeenCalledTimes(1);
    expect(inspectNode).toHaveBeenCalledWith("nts-delay");
  });

  test("a Merge in a lane is a plain tag, not a settings button", () => {
    const graph = buildGraph();
    const { view } = renderRack(
      nodeGraphSchema.parse({
        ...graph,
        edges: [
          ...graph.edges.filter((edge) => edge.source !== "kexp"),
          cable("kexp", "mix"),
          cable("mix", SPEAKERS_NODE_ID),
        ],
        nodes: [
          ...graph.nodes,
          { data: {}, id: "mix", position, type: "merge" },
        ],
      })
    );

    expect(view.getByText("Merge")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Merge settings" })).toBeNull();
    expect(view.getByRole("button", { name: "Delay settings" })).toBeTruthy();
  });

  test("a keyed FX chip names the station that keys it", () => {
    const { view } = renderRack(
      buildNodeGraphFromTemplate("duck", {
        saved: [
          {
            enabled: true,
            id: "kexp",
            name: "KEXP",
            streamUrl: "https://radio.example/kexp.mp3",
          },
          {
            enabled: true,
            id: "r4",
            name: "BBC Radio 4",
            streamUrl: "https://radio.example/r4.mp3",
          },
        ],
      })
    );

    const chip = view.getByRole("button", {
      name: "Compressor settings, keyed by BBC Radio 4",
    });
    expect(chip.getAttribute("title")).toBe("Keyed by BBC Radio 4");
  });

  test("an empty patch points at the search", () => {
    const { view } = renderRack(
      nodeGraphSchema.parse({
        edges: [],
        nodes: [{ data: {}, id: SPEAKERS_NODE_ID, position, type: "speakers" }],
        version: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
      } satisfies NodeGraphInput)
    );

    expect(view.getByText("Search to add a station")).toBeTruthy();
  });
});
