import { describe, expect, test } from "bun:test";
import type { EffectProcessor, StereoChannels } from "./effects/types";
import { EffectSource } from "./processor-source";

describe("EffectSource realtime allocations", () => {
  test("reuses channel views across render quanta", () => {
    const source = new EffectSource("deck", 48_000);
    const inputs: StereoChannels[] = [];
    const outputs: StereoChannels[] = [];
    const sidechains: Array<StereoChannels | null> = [];
    const effect: EffectProcessor = {
      process: (input, output, fromIndex, toIndex) => {
        inputs.push(input);
        outputs.push(output);
        for (let index = fromIndex; index < toIndex; index += 1) {
          output[0][index] = input[0][index] ?? 0;
          output[1][index] = input[1][index] ?? 0;
        }
      },
      reset: () => undefined,
      setSidechainInput: (input) => sidechains.push(input),
    };
    const internals = source as unknown as {
      effectConfigs: Map<string, unknown>;
      effectOrder: string[];
      effects: Map<string, EffectProcessor>;
    };
    internals.effects.set("effect", effect);
    internals.effectOrder.push("effect");
    internals.effectConfigs.set("effect", {
      dryWet: 1,
      enabled: true,
      inputGain: 1,
      outputGain: 1,
      raw: { sidechainEnabled: 1 },
    });
    const inputL = new Float32Array(128);
    const inputR = new Float32Array(128);
    const outputL = new Float32Array(128);
    const outputR = new Float32Array(128);
    const sidechainL = new Float32Array(128);
    const sidechainR = new Float32Array(128);
    source.start();

    source.process(
      inputL,
      inputR,
      outputL,
      outputR,
      0,
      128,
      sidechainL,
      sidechainR
    );
    source.process(
      inputL,
      inputR,
      outputL,
      outputR,
      0,
      128,
      sidechainL,
      sidechainR
    );

    expect(inputs[0]).toBe(inputs[1]);
    expect(outputs[0]).toBe(outputs[1]);
    expect(sidechains[0]).toBe(sidechains[1]);
  });
});
