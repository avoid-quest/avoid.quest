import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio/playback/types";
import { compile } from "./compile";
import {
  addEmptyStationNode,
  addStationNode,
  connectNodes,
  findStationNode,
  moveNodes,
  removeEdges,
  removeNodes,
  setStationRadio,
  setViewport,
  syncStationSnapshots,
} from "./graph-edits";
import {
  buildNodeGraphFromTemplate,
  SPEAKERS_NODE_ID,
  STATION_ROW_HEIGHT,
} from "./templates";
import { validate } from "./validate";

function radio(id: string, extra: Partial<Radio> = {}): Radio {
  return {
    enabled: true,
    id,
    name: `Station ${id}`,
    streamUrl: `https://radio.example/${id}.mp3`,
    ...extra,
  };
}

function patch(...radios: Radio[]) {
  return buildNodeGraphFromTemplate("start-from-multiple", { saved: radios });
}

const ENV = { crossOriginIsolated: false };

describe("addStationNode", () => {
  test("adds a Station below the others, wired to Speakers", () => {
    const { graph, nodeId } = addStationNode(patch(radio("a")), radio("b"));

    expect(nodeId).toBe("src-b");
    const added = graph.nodes.find((node) => node.id === "src-b");
    expect(added?.position).toEqual({ x: 0, y: STATION_ROW_HEIGHT });
    expect(graph.edges.at(-1)).toMatchObject({
      source: "src-b",
      sourceHandle: "out:audio:main",
      target: SPEAKERS_NODE_ID,
      targetHandle: "in:audio:main",
    });
    expect(validate(graph)).toEqual([]);
    expect([...compile(graph, ENV).lanes.keys()]).toEqual(["src-a", "src-b"]);
  });

  test("reuses the Station already holding that radio", () => {
    const start = patch(radio("a"));
    const { graph, nodeId } = addStationNode(start, radio("a"));

    expect(graph).toBe(start);
    expect(nodeId).toBe("src-a");
  });

  test("puts the first Station one column left of Speakers", () => {
    const blank = buildNodeGraphFromTemplate("blank");
    const { graph } = addStationNode(blank, radio("a"));
    const [speakers] = blank.nodes;

    expect(graph.nodes.at(-1)?.position).toEqual({
      x: (speakers?.position.x ?? 0) - 480,
      y: speakers?.position.y ?? 0,
    });
  });
});

describe("empty Station slots", () => {
  test("a slot dropped from Speakers is wired in and has no lane until filled", () => {
    const start = buildNodeGraphFromTemplate("blank");
    const { graph, nodeId } = addEmptyStationNode(
      start,
      { x: 10, y: 20 },
      { handle: "in:audio:main", node: SPEAKERS_NODE_ID }
    );

    expect(graph.edges).toHaveLength(1);
    expect(compile(graph, ENV).lanes.size).toBe(0);

    const filled = setStationRadio(graph, nodeId, radio("a"));
    expect([...compile(filled, ENV).lanes.keys()]).toEqual([nodeId]);
    expect(findStationNode(filled, radio("a"))?.id).toBe(nodeId);
  });
});

describe("removeNodes and removeEdges", () => {
  test("removing a Station drops its cables", () => {
    const start = patch(radio("a"), radio("b"));
    const graph = removeNodes(start, ["src-a"]);

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "src-b",
      SPEAKERS_NODE_ID,
    ]);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["src-b->speakers"]);
    expect(removeNodes(graph, ["missing"])).toBe(graph);
  });

  test("a removed cable can be connected again", () => {
    const start = patch(radio("a"));
    const cut = removeEdges(start, ["src-a->speakers"]);
    expect(cut.edges).toEqual([]);

    const joined = connectNodes(cut, {
      source: "src-a",
      sourceHandle: "out:audio:main",
      target: SPEAKERS_NODE_ID,
      targetHandle: "in:audio:main",
    });
    expect(joined.edges.map((edge) => edge.id)).toEqual(["src-a->speakers"]);
  });
});

test("moveNodes commits only changed positions", () => {
  const start = patch(radio("a"));
  expect(moveNodes(start, new Map([["src-a", { x: 0, y: 0 }]]))).toBe(start);

  const moved = moveNodes(start, new Map([["src-a", { x: 5, y: 6 }]]));
  expect(moved.nodes[0]?.position).toEqual({ x: 5, y: 6 });
});

test("setViewport commits only a changed viewport", () => {
  const start = patch(radio("a"));
  expect(setViewport(start, { ...start.viewport })).toBe(start);
  const panned = setViewport(start, { x: 40, y: -12, zoom: 0.75 });
  expect(panned.viewport).toEqual({ x: 40, y: -12, zoom: 0.75 });
  expect(panned.nodes).toBe(start.nodes);
});

describe("syncStationSnapshots", () => {
  test("follows an edit and a hide, and ignores key order", () => {
    const start = patch(radio("a"));
    const renamed = { ...radio("a"), name: "Renamed" };
    const synced = syncStationSnapshots(start, () => renamed);
    expect(findStationNode(synced, renamed)?.data.radio?.name).toBe("Renamed");

    const reordered = Object.fromEntries(
      Object.entries(renamed).reverse()
    ) as Radio;
    expect(syncStationSnapshots(synced, () => reordered)).toBe(synced);

    const hidden = syncStationSnapshots(synced, () => ({
      ...renamed,
      enabled: false,
    }));
    expect(hidden.nodes.map((node) => node.id)).toContain("src-a");
    expect(compile(hidden, ENV).lanes.size).toBe(0);
  });

  test("keeps the snapshot of a station whose record is gone", () => {
    const start = patch(radio("a"));
    expect(syncStationSnapshots(start, () => undefined)).toBe(start);
  });
});
