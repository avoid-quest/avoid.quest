import { describe, expect, test } from "bun:test";
import { DSPProcessor, MessageType } from "./processor";

describe("DSPProcessor effect path", () => {
  test("routes worklet messages through a real delay processor and supports bypass", () => {
    const processor = new DSPProcessor(44_100);
    const messages: Array<{ type: string }> = [];
    processor.setMessageCallback((message) => messages.push(message));
    processor.handleMessage({
      type: MessageType.CREATE_SOURCE,
      payload: { id: "deck-a" },
    });
    processor.handleMessage({
      type: MessageType.START_SOURCE,
      payload: { sourceId: "deck-a" },
    });
    processor.handleMessage({
      type: MessageType.ADD_EFFECT,
      payload: {
        sourceId: "deck-a",
        effectId: "delay-1",
        type: "delay",
        order: 0,
        config: {
          enabled: 1,
          inputGain: 1,
          outputGain: 1,
          dryWet: 1,
          delayTime: 0,
          feedback: 0,
        },
      },
    });

    const impulse = new Float32Array(128);
    impulse[0] = 0.25;
    const wetL = new Float32Array(128);
    const wetR = new Float32Array(128);
    processor.process(impulse, impulse, wetL, wetR, 0, 128);

    expect(wetL[0]).toBe(0);
    expect(wetL[1]).toBeGreaterThan(0);

    processor.handleMessage({
      type: MessageType.UPDATE_EFFECT,
      payload: {
        sourceId: "deck-a",
        effectId: "delay-1",
        config: { enabled: 0 },
      },
    });
    const bypassL = new Float32Array(128);
    const bypassR = new Float32Array(128);
    processor.process(impulse, impulse, bypassL, bypassR, 0, 128);

    expect(bypassL[0]).toBeGreaterThan(0);
    expect(messages.some(({ type }) => type === MessageType.SOURCE_ERROR)).toBe(
      false
    );
  });
});
