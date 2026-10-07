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

  test("a channel index the nodes lack throws, as Web Audio's unsigned longs do", () => {
    const graph = new OfflineGraph();
    const splitter = graph.createChannelSplitter(2);
    const merger = graph.createChannelMerger(2);
    for (const [output, input] of [
      [-1, 0],
      [0, -1],
      [2, 0],
      [0, 2],
    ] as const) {
      expect(() => splitter.connect(merger, output, input)).toThrow(
        "Channel index out of range"
      );
    }
    // A fraction truncates.
    expect(() => splitter.connect(merger, 1.5, 1.5)).not.toThrow();
  });
});
