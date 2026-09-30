import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import { loadLocalFile } from "@/lib/node-source-loaders";
import {
  commitNodeGraph,
  loadNodeGraph,
  NODE_HISTORY_LIMIT,
  redoNodeGraph,
  undoNodeGraph,
} from "./node-store";
import { type NodeGraph, nodeGraphSchema } from "./schema";
import {
  forgetLocalFileUrls,
  isLocalFileGone,
  releaseUnusedLocalFileUrls,
  retainLocalFileUrl,
} from "./sources";

let createUrl: ReturnType<typeof spyOn<typeof URL, "createObjectURL">>;
let revokeUrl: ReturnType<typeof spyOn<typeof URL, "revokeObjectURL">>;

beforeEach(async () => {
  forgetLocalFileUrls();
  loadNodeGraph(null);
  await Promise.resolve();
  createUrl = spyOn(URL, "createObjectURL");
  revokeUrl = spyOn(URL, "revokeObjectURL");
});

afterEach(async () => {
  loadNodeGraph(null);
  await Promise.resolve();
  forgetLocalFileUrls();
  createUrl.mockRestore();
  revokeUrl.mockRestore();
});

async function pickFile(name = "demo.mp3"): Promise<Radio> {
  const file = new File(["audio"], name, { type: "audio/mpeg" });
  const loaded = await loadLocalFile("file", file, {
    loadFile: async (picked) => ({
      displayName: picked.name,
      duration: 10,
      fileName: picked.name,
      fileSize: picked.size,
      mimeType: picked.type,
      objectUrl: URL.createObjectURL(picked),
    }),
  });
  if ("error" in loaded) {
    throw new Error(loaded.error);
  }
  return loaded.radio;
}

function patch(radio: Radio | null): NodeGraph {
  return nodeGraphSchema.parse({
    edges: [],
    nodes: [
      { data: { radio }, id: "file", position: { x: 0, y: 0 }, type: "file" },
      {
        data: {},
        id: "speakers",
        position: { x: 320, y: 0 },
        type: "speakers",
      },
    ],
    version: 2,
  });
}

function clearFile(graph: NodeGraph): NodeGraph {
  return { ...graph, nodes: graph.nodes.filter((node) => node.id !== "file") };
}

describe("Node local-file URL lifetime", () => {
  test("the current patch, Undo and Redo retain a picked file", async () => {
    const radio = await pickFile();
    loadNodeGraph(patch(radio));
    await Promise.resolve();
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).not.toHaveBeenCalled();

    commitNodeGraph(clearFile, undefined, "snapshot");
    await Promise.resolve();
    expect(isLocalFileGone(radio)).toBe(false);
    expect(undoNodeGraph()).toBe(true);
    await Promise.resolve();
    expect(isLocalFileGone(radio)).toBe(false);
    expect(redoNodeGraph()).toBe(true);
    await Promise.resolve();
    expect(revokeUrl).not.toHaveBeenCalled();

    loadNodeGraph(null);
    await Promise.resolve();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith(radio.streamUrl);
    expect(isLocalFileGone(radio)).toBe(true);
  });

  test("evicting the last history snapshot releases its file", async () => {
    const radio = await pickFile();
    loadNodeGraph(patch(radio));
    commitNodeGraph(clearFile, undefined, "snapshot");
    for (let index = 0; index <= NODE_HISTORY_LIMIT; index += 1) {
      commitNodeGraph(
        (graph) => ({
          ...graph,
          nodes: graph.nodes.map((node) => ({
            ...node,
            position: { ...node.position, x: index + 1 },
          })),
        }),
        undefined,
        "snapshot"
      );
    }
    await Promise.resolve();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith(radio.streamUrl);
    expect(isLocalFileGone(radio)).toBe(true);
  });

  test("replacement releases the old file and keeps the new one", async () => {
    const first = await pickFile("one.mp3");
    loadNodeGraph(patch(first));
    await Promise.resolve();
    const second = await pickFile("two.mp3");
    loadNodeGraph(patch(second));
    await Promise.resolve();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith(first.streamUrl);
    expect(isLocalFileGone(second)).toBe(false);
  });

  test("a registered sound retains its file through reset until cleanup", async () => {
    const radio = await pickFile();
    loadNodeGraph(patch(radio));
    const firstSound = retainLocalFileUrl(radio.streamUrl);
    const secondSound = retainLocalFileUrl(radio.streamUrl);
    loadNodeGraph(null);
    await Promise.resolve();
    firstSound();
    firstSound();
    await Promise.resolve();
    expect(revokeUrl).not.toHaveBeenCalled();

    secondSound();
    await Promise.resolve();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith(radio.streamUrl);
  });

  test("an abandoned load is released and arbitrary imported blobs are untouched", async () => {
    const picked = await pickFile();
    const imported = {
      ...picked,
      streamUrl: "blob:https://example.com/imported",
    };
    loadNodeGraph(patch(imported));
    releaseUnusedLocalFileUrls();
    loadNodeGraph(null);
    await Promise.resolve();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith(picked.streamUrl);
    expect(isLocalFileGone(imported)).toBe(true);
  });
});
