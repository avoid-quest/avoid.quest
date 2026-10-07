import { describe, expect, test } from "bun:test";
import { OfflineGraph, testProgram } from "./offline-graph";

describe("OfflineGraph", () => {
  test("a delay as long as the render, or longer, renders silence", () => {
    const graph = new OfflineGraph();
    const [left, right] = testProgram(480);
    const source = graph.createSource(left, right);
    for (const frames of [480, 960]) {
      const delay = graph.createDelay();
      delay.delayTime.value = frames / graph.sampleRate;
      source.connect(delay);
      const [outLeft, outRight] = graph.render(delay, 480);
      expect(outLeft?.every((x) => x === 0)).toBe(true);
      expect(outRight?.every((x) => x === 0)).toBe(true);
    }
  });
});
