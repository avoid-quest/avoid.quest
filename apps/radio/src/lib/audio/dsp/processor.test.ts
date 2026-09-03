import { describe, expect, test } from "bun:test";
import { DSPProcessor, MessageType } from "./processor";

describe("DSPProcessor effect path", () => {
  test("keeps centered stereo at unity with no effects or a bypassed effect", () => {
    const processor = new DSPProcessor(44_100);
    processor.handleMessage({
      type: MessageType.CREATE_SOURCE,
      payload: { id: "deck-a" },
    });
    processor.handleMessage({
      type: MessageType.START_SOURCE,
      payload: { sourceId: "deck-a" },
    });

    const inputL = new Float32Array(128).fill(0.25);
    const inputR = new Float32Array(128).fill(-0.125);
    const outputL = new Float32Array(128);
    const outputR = new Float32Array(128);
    processor.process(inputL, inputR, outputL, outputR, 0, 128);

    expect(outputL).toEqual(inputL);
    expect(outputR).toEqual(inputR);

    processor.handleMessage({
      type: MessageType.ADD_EFFECT,
      payload: {
        sourceId: "deck-a",
        effectId: "delay-1",
        type: "delay",
        order: 0,
        config: {
          enabled: 0,
          inputGain: 1,
          outputGain: 1,
          dryWet: 1,
          delayTime: 0,
          feedback: 0,
        },
      },
    });
    outputL.fill(0);
    outputR.fill(0);
    processor.process(inputL, inputR, outputL, outputR, 0, 128);

    expect(outputL).toEqual(inputL);
    expect(outputR).toEqual(inputR);

    processor.handleMessage({
      type: MessageType.SET_SOURCE_PAN,
      payload: { sourceId: "deck-a", pan: -1 },
    });
    for (let block = 0; block < 8; block++) {
      processor.process(inputL, inputR, outputL, outputR, 0, 128);
    }
    expect(outputL.at(-1)).toBeCloseTo(0.25, 6);
    expect(outputR.at(-1)).toBeCloseTo(0, 6);

    processor.handleMessage({
      type: MessageType.SET_SOURCE_PAN,
      payload: { sourceId: "deck-a", pan: 1 },
    });
    for (let block = 0; block < 8; block++) {
      processor.process(inputL, inputR, outputL, outputR, 0, 128);
    }
    expect(outputL.at(-1)).toBeCloseTo(0, 6);
    expect(outputR.at(-1)).toBeCloseTo(-0.125, 6);
  });

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
