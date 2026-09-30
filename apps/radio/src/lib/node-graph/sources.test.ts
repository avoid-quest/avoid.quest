import { afterEach, describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio/playback/types";
import { PLATFORM_SOURCE_DEFINITIONS } from "@/lib/dj-library-sources";
import { setSourceRadio, setTrackSearchPlatform } from "./graph-edits";
import { addPaletteNode, paletteEntries, trackChip } from "./palette";
import {
  DEFAULT_MEDIA_STRIP,
  migrateNodeGraph,
  nodeGraphSchema,
} from "./schema";
import {
  forgetLocalFileUrls,
  isLocalFileGone,
  isTrackRadio,
  keepLocalFileUrl,
  localFileRadio,
  sourceTypeForRadio,
} from "./sources";
import { buildNodeGraphFromTemplate, SPEAKERS_NODE_ID } from "./templates";
import { validate } from "./validate";

const station: Radio = {
  id: "kexp",
  name: "KEXP",
  streamUrl: "https://kexp.example/live.mp3",
};

const youtube: Radio = {
  id: "yt-1",
  name: "A video",
  platformMetadata: {
    itemType: "video",
    platform: "youtube",
    url: "https://www.youtube.com/watch?v=abc",
    videoId: "abc",
  },
  streamUrl: "https://media.example/abc.m4a",
};

const staticMp3: Radio = {
  id: "mp3",
  name: "track.mp3",
  platformMetadata: {
    displayName: "track",
    duration: 0,
    fileName: "track.mp3",
    fileSize: 0,
    isLocal: false,
    itemType: "track",
    mimeType: "audio/mpeg",
    platform: "static-audio",
    streamUrl: "https://files.example/track.mp3",
    url: "https://files.example/track.mp3",
  },
  streamUrl: "https://files.example/track.mp3",
};

afterEach(() => {
  forgetLocalFileUrls();
});

describe("sourceTypeForRadio", () => {
  test("live radio is a Station, platform items a Track, files a File", () => {
    expect(sourceTypeForRadio(station)).toBe("station");
    expect(
      sourceTypeForRadio({
        ...station,
        platformMetadata: {
          channelId: "x",
          itemType: "channel",
          platform: "radiogarden",
          url: "",
        },
      })
    ).toBe("station");
    expect(sourceTypeForRadio(youtube)).toBe("platform");
    expect(sourceTypeForRadio(staticMp3)).toBe("file");
    expect(isTrackRadio(youtube)).toBe(true);
    expect(isTrackRadio(station)).toBe(false);
  });
});

describe("local files", () => {
  const metadata = {
    displayName: "Demo",
    duration: 10,
    fileName: "demo.mp3",
    fileSize: 100,
    mimeType: "audio/mpeg",
    objectUrl: "blob:https://radio.example/demo",
  };

  test("a file picked in this page plays; after a reload it is gone", () => {
    const radio = localFileRadio("file", metadata);
    expect(radio).toMatchObject({
      name: "Demo",
      platformMetadata: { platform: "local-file" },
      streamUrl: metadata.objectUrl,
    });
    expect(isLocalFileGone(radio)).toBe(true);
    keepLocalFileUrl(metadata.objectUrl);
    expect(isLocalFileGone(radio)).toBe(false);
    forgetLocalFileUrls();
    expect(isLocalFileGone(radio)).toBe(true);
    expect(isLocalFileGone(staticMp3)).toBe(false);
  });
});

describe("Source nodes in the patch", () => {
  test("Track and File parse like a Station, with defaults", () => {
    const migration = migrateNodeGraph({
      edges: [],
      nodes: [
        { id: "track", position: { x: 0, y: 0 }, type: "platform" },
        {
          data: { radio: staticMp3, volume: 0.5 },
          id: "file",
          position: { x: 0, y: 0 },
          type: "file",
        },
        { id: SPEAKERS_NODE_ID, position: { x: 400, y: 0 }, type: "speakers" },
      ],
      version: 2,
    });
    expect(migration.status).toBe("ok");
    const nodes = migration.status === "ok" ? migration.graph.nodes : [];
    expect(nodes[0]?.data).toEqual({
      muted: false,
      radio: null,
      strip: DEFAULT_MEDIA_STRIP,
      volume: 1,
    });
    expect(nodes[1]?.data).toMatchObject({
      muted: false,
      radio: { id: "mp3" },
      volume: 0.5,
    });
  });

  test("filling a source with another kind of radio turns it into the one that plays it", () => {
    const graph = nodeGraphSchema.parse({
      edges: [
        {
          id: "track->speakers",
          source: "track",
          sourceHandle: "out:audio:main",
          target: SPEAKERS_NODE_ID,
          targetHandle: "in:audio:main",
        },
      ],
      nodes: [
        {
          data: { muted: true, searchPlatform: "youtube", volume: 0.4 },
          id: "track",
          position: { x: 1, y: 2 },
          type: "platform",
        },
        { id: SPEAKERS_NODE_ID, position: { x: 400, y: 0 }, type: "speakers" },
      ],
      version: 2,
    });
    const asTrack = setSourceRadio(graph, "track", youtube);
    expect(asTrack.nodes[0]).toMatchObject({
      data: { muted: true, radio: { id: "yt-1" }, volume: 0.4 },
      type: "platform",
    });
    // A radio link pasted into a Track hands off to a Station in place.
    const asStation = setSourceRadio(graph, "track", station);
    expect(asStation.nodes[0]).toMatchObject({
      data: { radio: { id: "kexp" } },
      id: "track",
      position: { x: 1, y: 2 },
      type: "station",
    });
    expect(asStation.edges).toEqual(graph.edges);
    expect(validate(asStation)).toEqual([]);
    expect(setSourceRadio(graph, SPEAKERS_NODE_ID, youtube)).toBe(graph);
  });

  test("a Track's chip locks its search", () => {
    const graph = nodeGraphSchema.parse({
      edges: [],
      nodes: [
        { id: "track", position: { x: 0, y: 0 }, type: "platform" },
        { id: SPEAKERS_NODE_ID, position: { x: 400, y: 0 }, type: "speakers" },
      ],
      version: 2,
    });
    const locked = setTrackSearchPlatform(graph, "track", "soundcloud");
    expect(locked.nodes[0]?.data).toMatchObject({
      searchPlatform: "soundcloud",
    });
    expect(setTrackSearchPlatform(locked, "track", "soundcloud")).toBe(locked);
  });
});

describe("palette Sources", () => {
  const patch = buildNodeGraphFromTemplate("blank");

  test("offers Station, Track with DJ's platform chips, and File", () => {
    const sources = paletteEntries(patch).filter(
      (entry) => entry.section === "sources"
    );
    expect(sources.map((entry) => entry.id)).toEqual([
      "station",
      "platform",
      "platform:youtube",
      "platform:soundcloud",
      "platform:bandcamp",
      "file",
      "deviceIn",
      "capture:browser-audio",
      "capture:spotify",
      "capture:mixcloud",
      "capture:radio-shows",
    ]);
    for (const platform of ["youtube", "soundcloud", "bandcamp"] as const) {
      const definition = PLATFORM_SOURCE_DEFINITIONS.find(
        (entry) => entry.pendingPlatform === platform
      );
      expect(trackChip(platform)).toEqual({
        color: String(definition?.color),
        description: String(definition?.radio.description),
        icon: definition?.icon ?? "search",
        name: String(definition?.radio.name),
      } as ReturnType<typeof trackChip>);
    }
  });

  test("a Track chip adds a Track locked to it, wired to Speakers", () => {
    const entry = paletteEntries(patch).find(
      (candidate) => candidate.id === "platform:bandcamp"
    );
    if (entry?.kind !== "node") {
      throw new Error("No Bandcamp chip");
    }
    const { graph, nodeId } = addPaletteNode(patch, entry);
    const added = graph.nodes.find((node) => node.id === nodeId);
    expect(nodeId).toStartWith("platform-");
    expect(added).toMatchObject({
      data: { radio: null, searchPlatform: "bandcamp" },
      type: "platform",
    });
    expect(graph.edges).toEqual([
      expect.objectContaining({ source: nodeId, target: SPEAKERS_NODE_ID }),
    ]);
    expect(validate(graph)).toEqual([]);
  });
});
