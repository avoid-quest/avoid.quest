import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio/playback/types";
import { parsePlaybackSessionRecord } from "@/lib/collections/playback-sessions";
import { compile } from "./compile";
import { DEFAULT_MEDIA_STRIP, nodeGraphSchema } from "./schema";
import { buildNodeSessionFromTemplate } from "./template-sessions";
import {
  buildNodeGraphFromTemplate,
  DUCK_NODE_ID,
  NODE_TEMPLATE_IDS,
  SPEAKERS_NODE_ID,
  STARTER_STATION_ID,
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

describe("starter", () => {
  test("is one unified search slot wired to Speakers", () => {
    const graph = buildNodeGraphFromTemplate("starter", {
      saved: [radio("a", { enabled: true })],
    });

    expect(graph.nodes).toEqual([
      expect.objectContaining({
        data: {
          muted: false,
          radio: null,
          strip: DEFAULT_MEDIA_STRIP,
          volume: 1,
        },
        id: STARTER_STATION_ID,
        type: "platform",
      }),
      expect.objectContaining({ id: SPEAKERS_NODE_ID, type: "speakers" }),
    ]);
    expect(graph.edges).toEqual([
      {
        gain: 1,
        id: `${STARTER_STATION_ID}->${SPEAKERS_NODE_ID}`,
        muted: false,
        source: STARTER_STATION_ID,
        sourceHandle: "out:audio:main",
        target: SPEAKERS_NODE_ID,
        targetHandle: "in:audio:main",
      },
    ]);
    expect(nodeGraphSchema.parse(graph)).toEqual(graph);
    expect(validate(graph)).toEqual([]);
  });

  test("compiles to Speakers alone until the slot holds a station", () => {
    const plan = compile(buildNodeGraphFromTemplate("starter"), {
      crossOriginIsolated: false,
    });

    expect(plan.lanes.size).toBe(0);
    expect(plan.sinks.size).toBe(1);
  });

  test("builds a valid node session with no lanes", () => {
    const session = buildNodeSessionFromTemplate("starter");

    expect(session.channels).toEqual([]);
    expect(parsePlaybackSessionRecord(session).graph).toEqual(session.graph);
  });

  test("comes first among the templates", () => {
    expect(NODE_TEMPLATE_IDS[0]).toBe("starter");
  });
});

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

describe("duck", () => {
  const env = { crossOriginIsolated: false };

  test("a talk station keys a Compressor on a music station", () => {
    const graph = buildNodeGraphFromTemplate("duck", {
      saved: [
        radio("kexp", { enabled: true, name: "KEXP", order: 0 }),
        radio("r4", { enabled: true, name: "BBC Radio 4", order: 1 }),
      ],
    });

    expect(nodeGraphSchema.parse(graph)).toEqual(graph);
    expect(validate(graph)).toEqual([]);
    expect(graph.edges).toEqual([
      expect.objectContaining({ source: "src-kexp", target: DUCK_NODE_ID }),
      expect.objectContaining({
        source: DUCK_NODE_ID,
        target: SPEAKERS_NODE_ID,
      }),
      expect.objectContaining({ source: "src-r4", target: SPEAKERS_NODE_ID }),
      expect.objectContaining({
        source: "src-r4",
        target: DUCK_NODE_ID,
        targetHandle: "in:sidechain:key",
      }),
    ]);

    const plan = compile(graph, env);
    expect(plan.issues).toEqual([]);
    const [compressor] = plan.lanes.get("src-kexp")?.effects ?? [];
    expect(compressor).toMatchObject({
      autoMakeup: false,
      enabled: true,
      id: DUCK_NODE_ID,
      sidechain: { channelId: `node-key:${DUCK_NODE_ID}` },
      type: "compressor",
    });
    // The talk plays dry, straight to Speakers.
    expect(plan.lanes.get("src-r4")?.effects).toEqual([]);
  });

  test("prefers Radio BlackOut for voice ahead of other talk stations", () => {
    const graph = buildNodeGraphFromTemplate("duck", {
      saved: [
        radio("nts", { enabled: true, name: "NTS 1", order: 0 }),
        radio("news", { enabled: true, name: "City News", order: 1 }),
        radio("fip", { enabled: true, name: "FIP", order: 2 }),
        radio("blackout", { enabled: true, name: "Radio BlackOut", order: 12 }),
      ],
    });

    const key = graph.edges.find(
      (edge) => edge.targetHandle === "in:sidechain:key"
    );
    expect(key?.source).toBe("src-blackout");
    expect(
      graph.edges.find((edge) => edge.target === DUCK_NODE_ID && edge !== key)
        ?.source
    ).toBe("src-nts");
    expect(stationIds(graph)).toEqual(["src-nts", "src-blackout"]);
  });

  test("keeps levels, and builds a valid session whose music lane is keyed", () => {
    const session = buildNodeSessionFromTemplate("duck", {
      levels: (station) =>
        station.id === "b" ? { muted: false, volume: 0.4 } : undefined,
      saved: [radio("a", { enabled: true }), radio("b", { enabled: true })],
    });

    expect(parsePlaybackSessionRecord(session).graph).toEqual(session.graph);
    expect(session.channels).toEqual([
      expect.objectContaining({
        effects: [
          expect.objectContaining({
            id: DUCK_NODE_ID,
            sidechain: { channelId: `node-key:${DUCK_NODE_ID}` },
          }),
        ],
        id: "n:src-a",
      }),
      expect.objectContaining({ effects: [], id: "n:src-b", volume: 0.4 }),
    ]);
  });

  test("one station fills the slot its name reads as, and the other stays empty", () => {
    const music = buildNodeGraphFromTemplate("duck", {
      saved: [radio("nts", { enabled: true, name: "NTS 1" })],
    });
    expect(stationIds(music)).toEqual(["src-nts", "src-talk"]);

    const talk = buildNodeGraphFromTemplate("duck", {
      saved: [radio("r4", { enabled: true, name: "BBC Radio 4" })],
    });
    expect(stationIds(talk)).toEqual(["src-music", "src-r4"]);
    expect(
      talk.edges.find((edge) => edge.targetHandle === "in:sidechain:key")
        ?.source
    ).toBe("src-r4");
    for (const graph of [music, talk]) {
      expect(validate(graph)).toEqual([]);
    }
  });

  test("with no stations, the slots are empty searches and nothing plays", () => {
    const graph = buildNodeGraphFromTemplate("duck");

    expect(stationIds(graph)).toEqual(["src-music", "src-talk"]);
    expect(
      graph.nodes.every(
        (node) => node.type !== "station" || node.data.radio === null
      )
    ).toBe(true);
    expect(validate(graph)).toEqual([]);
    expect(compile(graph, env).lanes.size).toBe(0);
  });
});
