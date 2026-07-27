import { describe, expect, mock, test } from "bun:test";
import { ContainerEffect } from "./container-effects";
import { createDefaultEffectConfig } from "./registry";
import type { EffectConfig, StereoChannels } from "./types";

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;

function buffers(): StereoChannels {
  return [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
}

function createContainer(
  type: "frequencySplit" | "fxComposite" | "stereoSplit"
) {
  const config = {
    ...createDefaultEffectConfig(type, type, 0),
    enabled: true,
  } satisfies EffectConfig;
  return new ContainerEffect(type, SAMPLE_RATE, config, () => null);
}

describe("compatibility effect containers", () => {
  test("reconstructs a neutral frequency split at unity across representative bands", () => {
    for (const frequency of [100, 500, 2000, 10_000]) {
      const effect = createContainer("frequencySplit");
      let inputEnergy = 0;
      let outputEnergy = 0;

      for (let block = 0; block < 100; block++) {
        const input = buffers();
        const output = buffers();
        for (let index = 0; index < BLOCK_SIZE; index++) {
          const sample = Math.sin(
            (2 * Math.PI * frequency * (block * BLOCK_SIZE + index)) /
              SAMPLE_RATE
          );
          input[0][index] = sample;
          input[1][index] = sample;
          inputEnergy += sample * sample;
        }
        effect.process(input, output, 0, BLOCK_SIZE);
        for (const sample of output[0]) {
          outputEnergy += sample * sample;
        }
      }

      expect(10 * Math.log10(outputEnergy / inputEnergy)).toBeCloseTo(0, 1);
    }
  });

  test("keeps centered stereo split branches at unity", () => {
    const effect = createContainer("stereoSplit");
    const input = buffers();
    const output = buffers();
    input[0].fill(0.25);
    input[1].fill(-0.5);

    effect.process(input, output, 0, BLOCK_SIZE);

    expect(output[0]).toEqual(input[0]);
    expect(output[1]).toEqual(input[1]);
  });

  test("keeps both default parallel branches without summing above unity", () => {
    const effect = createContainer("fxComposite");
    const input = buffers();
    const output = buffers();
    input[0].fill(0.25);
    input[1].fill(-0.5);

    effect.process(input, output, 0, BLOCK_SIZE);

    for (let index = 0; index < BLOCK_SIZE; index++) {
      expect(output[0][index]).toBeCloseTo(input[0][index] ?? 0, 6);
      expect(output[1][index]).toBeCloseTo(input[1][index] ?? 0, 6);
    }
  });

  test("forwards sidechain input only to nested effects that request it", () => {
    const config = createDefaultEffectConfig("fxComposite", "fx", 0);
    const gate = createDefaultEffectConfig("gate", "gate", 0);
    const compressor = createDefaultEffectConfig("compressor", "compressor", 0);
    gate.sidechain = { channelId: "deck-b" };
    const [firstChain, secondChain] = config.chains;
    if (!(firstChain && secondChain)) {
      throw new Error("Default composite must contain two chains");
    }
    firstChain.effects = [gate];
    secondChain.effects = [compressor];
    const sidechainSetters = new Map<
      string,
      ReturnType<typeof mock<(input: StereoChannels | null) => void>>
    >();
    const effect = new ContainerEffect(
      "fxComposite",
      SAMPLE_RATE,
      config,
      (child) => {
        const setSidechainInput = mock(
          (_input: StereoChannels | null) => undefined
        );
        sidechainSetters.set(child.id, setSidechainInput);
        return {
          process: (input, output, fromIndex, toIndex) => {
            output[0].set(input[0].subarray(fromIndex, toIndex), fromIndex);
            output[1].set(input[1].subarray(fromIndex, toIndex), fromIndex);
          },
          reset: () => undefined,
          setSidechainInput,
        };
      }
    );
    const sidechain = buffers();

    effect.setSidechainInput(sidechain);

    expect(sidechainSetters.get("gate")).toHaveBeenLastCalledWith(sidechain);
    expect(sidechainSetters.get("compressor")).toHaveBeenLastCalledWith(null);
  });

  test("propagates sidechains through multiple container levels to gate, compressor, and vocoder", () => {
    const root = createDefaultEffectConfig("fxComposite", "root", 0);
    const nested = createDefaultEffectConfig("fxComposite", "nested", 0);
    const deepest = createDefaultEffectConfig("stereoSplit", "deepest", 0);
    const gate = createDefaultEffectConfig("gate", "gate", 0);
    const compressor = createDefaultEffectConfig("compressor", "compressor", 1);
    const vocoder = createDefaultEffectConfig("vocoder", "vocoder", 0);
    const internal = createDefaultEffectConfig("gate", "internal", 1);
    gate.sidechain = { channelId: "deck-b" };
    compressor.sidechain = { channelId: "deck-b" };
    vocoder.sidechain = { channelId: "deck-b" };
    const deepestLeft = deepest.chains[0];
    const deepestRight = deepest.chains[1];
    const nestedFirst = nested.chains[0];
    const rootFirst = root.chains[0];
    if (!(deepestLeft && deepestRight && nestedFirst && rootFirst)) {
      throw new Error("Default containers require their fixed chains");
    }
    deepestLeft.effects = [gate, compressor];
    deepestRight.effects = [vocoder, internal];
    nestedFirst.effects = [deepest];
    rootFirst.effects = [nested];

    const setters = new Map<
      string,
      ReturnType<typeof mock<(input: StereoChannels | null) => void>>
    >();
    let factory: (config: EffectConfig) => {
      process(
        input: StereoChannels,
        output: StereoChannels,
        fromIndex: number,
        toIndex: number
      ): void;
      reset(): void;
      setSidechainInput?(input: StereoChannels | null): void;
    };
    factory = (config) => {
      if (
        config.type === "fxComposite" ||
        config.type === "stereoSplit" ||
        config.type === "frequencySplit"
      ) {
        return new ContainerEffect(config.type, SAMPLE_RATE, config, factory);
      }
      const setSidechainInput = mock(
        (_input: StereoChannels | null) => undefined
      );
      setters.set(config.id, setSidechainInput);
      return {
        process: (input, output, fromIndex, toIndex) => {
          output[0].set(input[0].subarray(fromIndex, toIndex), fromIndex);
          output[1].set(input[1].subarray(fromIndex, toIndex), fromIndex);
        },
        reset: () => undefined,
        setSidechainInput,
      };
    };
    const effect = new ContainerEffect(
      "fxComposite",
      SAMPLE_RATE,
      root,
      factory
    );
    const sidechain = buffers();

    effect.setSidechainInput(sidechain);

    for (const id of ["gate", "compressor", "vocoder"]) {
      expect(setters.get(id)).toHaveBeenLastCalledWith(sidechain);
    }
    expect(setters.get("internal")).toHaveBeenLastCalledWith(null);
  });

  test.each([
    { pan: -1, left: 1, right: 0 },
    { pan: -0.5, left: 1, right: 0.5 },
    { pan: 0, left: 1, right: 1 },
    { pan: 0.5, left: 0.5, right: 1 },
    { pan: 1, left: 0, right: 1 },
  ])("applies stereo split branch pan $pan with gain and neutral reconstruction", ({
    pan,
    left,
    right,
  }) => {
    const config = createDefaultEffectConfig("stereoSplit", "stereo", 0);
    const [leftChain, rightChain] = config.chains;
    if (!(leftChain && rightChain)) {
      throw new Error("Stereo Split requires two chains");
    }
    leftChain.pan = pan;
    leftChain.gain = 0.5;
    rightChain.pan = pan;
    rightChain.gain = 0.5;
    const effect = new ContainerEffect(
      "stereoSplit",
      SAMPLE_RATE,
      config,
      () => null
    );
    const input = buffers();
    const output = buffers();
    input[0].fill(0.8);
    input[1].fill(-0.4);

    effect.process(input, output, 0, BLOCK_SIZE);

    expect(output[0][0]).toBeCloseTo(0.8 * 0.5 * left, 6);
    expect(output[1][0]).toBeCloseTo(-0.4 * 0.5 * right, 6);
  });
});
