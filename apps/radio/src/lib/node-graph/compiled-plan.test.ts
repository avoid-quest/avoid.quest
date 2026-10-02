import { afterAll, afterEach, expect, spyOn, test } from "bun:test";

const compiler = await import("./compile");

import { compiledPlan } from "./compiled-plan";
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
  expect(compiledPlan({ ...graph }, env)).not.toBe(base);
  expect(compiledPlan(graph, { ...env, crossOriginIsolated: true })).not.toBe(
    base
  );
  expect(compiledPlan(graph, { ...env, profile: "mobile" })).not.toBe(base);
  expect(compiledPlan(graph, { ...env, release: "v1" })).not.toBe(base);
  expect(compiledPlan(graph, { ...env, playing: ["station"] })).not.toBe(base);
  expect(compiledPlan(graph, { ...env })).toBe(base);
});
