import { describe, expect, test } from "bun:test";
import { DSPProcessor, MessageType } from "./processor";

function makeChannel(value: number): Float32Array {
  return new Float32Array(128).fill(value);
}

describe("DSPProcessor peak meter gating", () => {
  test("emits peak meter data only when enabled", () => {
    const processor = new DSPProcessor(44_100);
    const messages: Array<{ type: string; payload?: unknown }> = [];
    processor.setMessageCallback((message) => {
      messages.push(message);
    });

    const inputL = makeChannel(0.5);
    const inputR = makeChannel(0.5);
    const outputL = new Float32Array(128);
    const outputR = new Float32Array(128);

    for (let i = 0; i < 6; i += 1) {
      processor.process(inputL, inputR, outputL, outputR, 0, 128);
    }
    expect(messages).toHaveLength(0);

    processor.handleMessage({
      type: MessageType.ENABLE_PEAK_METER,
      payload: { enabled: true },
    });

    for (let i = 0; i < 6; i += 1) {
      processor.process(inputL, inputR, outputL, outputR, 0, 128);
    }

    expect(
      messages.some((message) => message.type === MessageType.PEAK_METER)
    ).toBeTrue();
  });
});
