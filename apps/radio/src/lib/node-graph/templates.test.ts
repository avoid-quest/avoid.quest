import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio/playback/types";
import { parsePlaybackSessionRecord } from "@/lib/collections/playback-sessions";
import { nodeGraphSchema } from "./schema";
import {
  buildNodeGraphFromTemplate,
  buildNodeSessionFromTemplate,
  SPEAKERS_NODE_ID,
  STATION_ROW_HEIGHT,
} from "./templates";
import { validate } from "./validate";

function radio(id: string | undefined, extra: Partial<Radio> = {}): Radio {
  return {
    id,
    name: `Station ${id ?? "unsaved"}`,
    streamUrl: `https://radio.example/${id ?? "unsaved"}.mp3`,
    ...extra,
  };
}

function stationIds(graph: ReturnType<typeof buildNodeGraphFromTemplate>) {
  return graph.nodes
    .filter((node) => node.type === "station")
    .map((node) => node.id);
}

describe("start-from-multiple", () => {
  test("orders enabled saved stations by order, then session stations", () => {
    const graph = buildNodeGraphFromTemplate("start-from-multiple", {
      saved: [
        radio("b", { enabled: true, order: 2 }),
        radio("off", { enabled: false, order: 0 }),
        radio("a", { enabled: true, order: 1 }),
      ],
      session: [radio("rb_live"), radio("a")],
    });

    expect(stationIds(graph)).toEqual(["src-a", "src-b", "src-rb_live"]);
  });

  test("wires each station to Speakers at its volume", () => {
    const quiet = radio("quiet", { enabled: true });
    const graph = buildNodeGraphFromTemplate("start-from-multiple", {
      levels: (station) =>
        station.id === "quiet" ? { muted: true, volume: 0.35 } : undefined,
      saved: [quiet, radio("loud", { enabled: true, order: 1 })],
    });

    expect(graph.nodes.filter((node) => node.type === "speakers")).toHaveLength(
      1
    );
    expect(graph.edges).toEqual([
      {
        gain: 1,
        id: "src-quiet->speakers",
        muted: false,
        source: "src-quiet",
        sourceHandle: "out:audio:main",
        target: SPEAKERS_NODE_ID,
        targetHandle: "in:audio:main",
      },
      expect.objectContaining({ source: "src-loud", target: SPEAKERS_NODE_ID }),
    ]);
    expect(graph.nodes[0]).toMatchObject({
      data: { muted: true, radio: quiet, volume: 0.35 },
      type: "station",
    });
    expect(graph.nodes[1]).toMatchObject({
      data: { muted: false, volume: 1 },
    });
    expect(nodeGraphSchema.parse(graph)).toEqual(graph);
    expect(validate(graph)).toEqual([]);
  });

  test("keeps node ids unique for unsaved stations with one name", () => {
    const graph = buildNodeGraphFromTemplate("start-from-multiple", {
      session: [
        radio(undefined, { name: "Night Owl" }),
        radio(undefined, { name: "Night Owl" }),
      ],
    });

    expect(stationIds(graph)).toEqual(["src-night-owl", "src-night-owl-2"]);
  });

  test("lays out one column up to eight stations, then two", () => {
    const stations = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        radio(String(index), { enabled: true, order: index })
      );
    const one = buildNodeGraphFromTemplate("start-from-multiple", {
      saved: stations(8),
    });
    const two = buildNodeGraphFromTemplate("start-from-multiple", {
      saved: stations(9),
    });
    const xs = (graph: typeof one) =>
      new Set(
        graph.nodes
          .filter((node) => node.type === "station")
          .map((node) => node.position.x)
      );
    const speakersOf = (graph: typeof one) =>
      graph.nodes.find((node) => node.id === SPEAKERS_NODE_ID)?.position;

    expect(xs(one)).toEqual(new Set([0]));
    expect(speakersOf(one)).toEqual({ x: 480, y: 3.5 * STATION_ROW_HEIGHT });
    expect(xs(two)).toEqual(new Set([0, 280]));
    expect(speakersOf(two)?.x).toBeGreaterThan(280 + 240);
  });

  test("builds a valid node session with a lane channel per station", () => {
    const session = buildNodeSessionFromTemplate("start-from-multiple", {
      masterVolume: 0.6,
      saved: [radio("a", { enabled: true })],
      session: [radio("rb_live")],
    });

    expect(session).toMatchObject({ id: "node", masterVolume: 0.6 });
    expect(session.channels).toEqual([
      expect.objectContaining({
        id: "n:src-a",
        order: 0,
        radio: expect.objectContaining({ id: "a" }),
        role: "node",
        volume: 1,
      }),
      expect.objectContaining({ id: "n:src-rb_live", order: 1, role: "node" }),
    ]);
    expect(parsePlaybackSessionRecord(session).graph).toEqual(session.graph);
  });
});

describe("blank", () => {
  test("has only Speakers", () => {
    const session = buildNodeSessionFromTemplate("blank", {
      saved: [radio("a", { enabled: true })],
    });

    expect(session.graph?.nodes).toEqual([
      expect.objectContaining({ id: SPEAKERS_NODE_ID, type: "speakers" }),
    ]);
    expect(session.graph?.edges).toEqual([]);
    expect(session.channels).toEqual([]);
    expect(session.masterVolume).toBe(1);
  });
});
