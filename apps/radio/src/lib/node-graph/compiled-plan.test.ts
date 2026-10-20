import { afterAll, afterEach, expect, spyOn, test } from "bun:test";

const compiler = await import("./compile");

import { compiledPlan } from "./compiled-plan";
import { nodeGraphSchema } from "./schema";
import {
  forgetLocalFileUrls,
  keepLocalFileUrl,
  localFileRadio,
} from "./sources";
import { buildNodeGraphFromTemplate } from "./templates";

const compileSpy = spyOn(compiler, "compile");
afterEach(() => compileSpy.mockClear());
afterAll(() => compileSpy.mockRestore());

test("playback, canvas and Rack share one compile for an immutable patch", () => {
  const graph = buildNodeGraphFromTemplate("starter");
  const env = { crossOriginIsolated: false };
  const plan = compiledPlan(graph, env);
  expect(compiledPlan(graph, { ...env })).toBe(plan);
  expect(compileSpy).toHaveBeenCalledTimes(1);
});

test("an edit and every compile environment get their own plan", () => {
  const graph = buildNodeGraphFromTemplate("starter");
  const env = { crossOriginIsolated: false };
  const base = compiledPlan(graph, env);
  expect(compiledPlan({ ...graph }, env)).toBe(base);
  expect(
    compiledPlan(
      {
        ...graph,
        nodes: graph.nodes.map((node) => ({ ...node, data: { ...node.data } })),
      } as typeof graph,
      env
    )
  ).not.toBe(base);
  expect(compiledPlan(graph, { ...env, crossOriginIsolated: true })).not.toBe(
    base
  );
  expect(compiledPlan(graph, { ...env, release: "v1" })).not.toBe(base);
  expect(compiledPlan(graph, { ...env })).toBe(base);
});

test("position, viewport, pinning and cable colour share audio work; parameters do not", () => {
  const graph = buildNodeGraphFromTemplate("starter");
  const env = { crossOriginIsolated: false };
  const base = compiledPlan(graph, env);
  const moved = {
    ...graph,
    edges: graph.edges.map((edge) => ({ ...edge, color: "red" })),
    nodes: graph.nodes.map((node) => ({
      ...node,
      pinned: true,
      position: { x: 40, y: 30 },
    })),
    viewport: { x: 12, y: 24, zoom: 0.5 },
  };
  expect(compiledPlan(moved, env)).toBe(base);
  expect(compileSpy).toHaveBeenCalledTimes(1);
  expect(
    compiledPlan(
      { ...moved, edges: moved.edges.map((edge) => ({ ...edge, gain: 0.4 })) },
      env
    )
  ).not.toBe(base);
  expect(compileSpy).toHaveBeenCalledTimes(2);
});

test("local-file availability invalidates even an unchanged graph", () => {
  const radio = localFileRadio("local", {
    displayName: "File",
    duration: 1,
    fileName: "file.wav",
    fileSize: 32,
    mimeType: "audio/wav",
    objectUrl: "blob:compiled-plan-test",
  });
  const graph = nodeGraphSchema.parse({
    ...buildNodeGraphFromTemplate("blank"),
    nodes: [
      ...buildNodeGraphFromTemplate("blank").nodes,
      { data: { radio }, id: "local", position: { x: 0, y: 0 }, type: "file" },
    ],
  });
  const env = { crossOriginIsolated: false };
  const unavailable = compiledPlan(graph, env);
  expect(unavailable.lanes.has("local")).toBe(false);
  keepLocalFileUrl(radio.streamUrl);
  try {
    const available = compiledPlan(graph, env);
    expect(available).not.toBe(unavailable);
    expect(available.lanes.has("local")).toBe(true);
  } finally {
    forgetLocalFileUrls();
  }
  expect(compiledPlan(graph, env).lanes.has("local")).toBe(false);
});
