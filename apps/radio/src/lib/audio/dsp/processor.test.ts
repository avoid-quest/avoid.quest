import { describe, expect, test } from "bun:test";
import { DSPProcessor, MessageType } from "./processor";

describe("DSPProcessor effect path", () => {
  test("keeps centered stereo at unity with no effects or a bypassed effect", () => {
    const processor = new DSPProcessor(44_100);
    processor.handleMessage({
      payload: { id: "deck-a" },
      type: MessageType.CREATE_SOURCE,
    });
    processor.handleMessage({
      payload: { sourceId: "deck-a" },
      type: MessageType.START_SOURCE,
    });

    const inputL = new Float32Array(128).fill(0.25);
    const inputR = new Float32Array(128).fill(-0.125);
    const outputL = new Float32Array(128);
    const outputR = new Float32Array(128);
    processor.process(inputL, inputR, outputL, outputR, 0, 128);

    expect(outputL).toEqual(inputL);
    expect(outputR).toEqual(inputR);

    processor.handleMessage({
      payload: {
        config: {
          delayTime: 0,
          dryWet: 1,
          enabled: 0,
          feedback: 0,
          inputGain: 1,
          outputGain: 1,
        },
        effectId: "delay-1",
        order: 0,
        sourceId: "deck-a",
        type: "delay",
      },
      type: MessageType.ADD_EFFECT,
    });
    outputL.fill(0);
    outputR.fill(0);
    processor.process(inputL, inputR, outputL, outputR, 0, 128);

    expect(outputL).toEqual(inputL);
    expect(outputR).toEqual(inputR);

    processor.handleMessage({
      payload: { pan: -1, sourceId: "deck-a" },
      type: MessageType.SET_SOURCE_PAN,
    });
    for (let block = 0; block < 8; block += 1) {
      processor.process(inputL, inputR, outputL, outputR, 0, 128);
    }
    expect(outputL.at(-1)).toBeCloseTo(0.25, 6);
    expect(outputR.at(-1)).toBeCloseTo(0, 6);

    processor.handleMessage({
      payload: { pan: 1, sourceId: "deck-a" },
      type: MessageType.SET_SOURCE_PAN,
    });
    for (let block = 0; block < 8; block += 1) {
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
      payload: { id: "deck-a" },
      type: MessageType.CREATE_SOURCE,
    });
    processor.handleMessage({
      payload: { sourceId: "deck-a" },
      type: MessageType.START_SOURCE,
    });
    processor.handleMessage({
      payload: {
        config: {
          delayTime: 0,
          dryWet: 1,
          enabled: 1,
          feedback: 0,
          inputGain: 1,
          outputGain: 1,
        },
        effectId: "delay-1",
        order: 0,
        sourceId: "deck-a",
        type: "delay",
      },
      type: MessageType.ADD_EFFECT,
    });

    const impulse = new Float32Array(128);
    impulse[0] = 0.25;
    const wetL = new Float32Array(128);
    const wetR = new Float32Array(128);
    processor.process(impulse, impulse, wetL, wetR, 0, 128);

    expect(wetL[0]).toBe(0);
    expect(wetL[1]).toBeGreaterThan(0);

    processor.handleMessage({
      payload: {
        config: { enabled: 0 },
        effectId: "delay-1",
        sourceId: "deck-a",
      },
      type: MessageType.UPDATE_EFFECT,
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
