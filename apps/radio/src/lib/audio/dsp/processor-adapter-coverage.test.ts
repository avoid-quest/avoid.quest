import { describe, expect, spyOn, test } from "bun:test";
import { CTAGCompressor } from "./effects/ctag-compressor";
import { Delay } from "./effects/delay";
import { createDefaultEffectConfig } from "./effects/registry";
import { DattorroReverb } from "./effects/reverb";
import type { EffectProcessor } from "./effects/types";
import { EFFECT_TYPES } from "./effects/types";
import { EffectSource } from "./processor-source";

const BLOCK_SIZE = 128;

function processBlock(source: EffectSource, value: number): Float32Array {
  const inputL = new Float32Array(BLOCK_SIZE).fill(value);
  const inputR = new Float32Array(BLOCK_SIZE).fill(value);
  const outputL = new Float32Array(BLOCK_SIZE);
  const outputR = new Float32Array(BLOCK_SIZE);
  source.process(inputL, inputR, outputL, outputR, 0, BLOCK_SIZE);
  return outputL;
}

function getProcessor(
  source: EffectSource,
  effectId: string
): Record<string, unknown> {
  const { effects } = source as unknown as {
    effects: Map<string, EffectProcessor>;
  };
  return effects.get(effectId) as unknown as Record<string, unknown>;
}

describe("worklet effect adapter", () => {
  test("constructs every catalog processor from its persisted default config", () => {
    const source = new EffectSource("deck-a", 48_000);

    for (const [order, type] of EFFECT_TYPES.entries()) {
      const config = createDefaultEffectConfig(type, `effect-${type}`, order);

      expect(
        source.addEffect(
          config.id,
          config.type,
          { ...config, enabled: true },
          config.order
        )
      ).toBe(true);
    }
  });

  test("keeps every disabled effect sample-exactly at unity", () => {
    const source = new EffectSource("bypassed-catalog", 48_000);

    for (const [order, type] of EFFECT_TYPES.entries()) {
      const config = createDefaultEffectConfig(type, `effect-${type}`, order);
      source.addEffect(
        config.id,
        config.type,
        {
          ...config,
          dryWet: 0.37,
          enabled: false,
          inputGain: 2.5,
          outputGain: 3.5,
        },
        config.order
      );
    }

    const input = new Float32Array(BLOCK_SIZE).map(
      (_, index) => (index - BLOCK_SIZE / 2) / BLOCK_SIZE
    );
    const outputL = new Float32Array(BLOCK_SIZE);
    const outputR = new Float32Array(BLOCK_SIZE);
    source.process(input, input, outputL, outputR, 0, BLOCK_SIZE);

    expect(outputL).toEqual(input);
    expect(outputR).toEqual(input);
  });

  test("keeps a container audible after an earlier compatibility effect", () => {
    const source = new EffectSource("container-chain", 48_000);
    const distortion = {
      ...createDefaultEffectConfig("distortion", "distortion", 0),
      enabled: true,
    };
    const container = {
      ...createDefaultEffectConfig("fxComposite", "container", 1),
      enabled: true,
    };
    source.addEffect(
      distortion.id,
      distortion.type,
      distortion,
      distortion.order
    );
    source.addEffect(container.id, container.type, container, container.order);

    expect(processBlock(source, 0.25).some((sample) => sample !== 0)).toBe(
      true
    );
  });

  test("applies stock effect parameters instead of silently using defaults", () => {
    const closedGate = new EffectSource("closed", 48_000);
    const openGate = new EffectSource("open", 48_000);
    const base = {
      ...createDefaultEffectConfig("gate", "gate", 0),
      attack: 0.1,
      enabled: true,
      floor: -120,
      hold: 0,
      release: 1,
    };

    expect(
      closedGate.addEffect("gate", "gate", { ...base, threshold: 0 }, 0)
    ).toBe(true);
    expect(
      openGate.addEffect("gate", "gate", { ...base, threshold: -80 }, 0)
    ).toBe(true);

    let closed: Float32Array<ArrayBufferLike> = new Float32Array(BLOCK_SIZE);
    let open: Float32Array<ArrayBufferLike> = new Float32Array(BLOCK_SIZE);
    for (let block = 0; block < 20; block += 1) {
      closed = processBlock(closedGate, 0.5);
      open = processBlock(openGate, 0.5);
    }

    expect(Math.abs(closed.at(-1) ?? 0)).toBeLessThan(0.001);
    expect(Math.abs(open.at(-1) ?? 0)).toBeGreaterThan(0.1);
  });

  test("reconfigures nested containers without losing the processor", () => {
    const source = new EffectSource("deck-a", 48_000);
    const composite = {
      ...createDefaultEffectConfig("fxComposite", "parallel", 0),
      enabled: true,
    };
    const delay = {
      ...createDefaultEffectConfig("delay", "nested-delay", 0),
      enabled: true,
    };
    const [firstChain] = composite.chains;
    if (!firstChain) {
      throw new Error("Default composite must contain a chain");
    }
    firstChain.effects = [delay];
    const reset = spyOn(Delay.prototype, "reset");
    const setFeedback = spyOn(Delay.prototype, "setFeedback");

    expect(source.addEffect("parallel", "fxComposite", composite, 0)).toBe(
      true
    );
    reset.mockClear();
    setFeedback.mockClear();
    source.updateEffect("parallel", {
      chains: composite.chains.map((chain) => ({
        ...chain,
        effects:
          chain.id === firstChain.id
            ? [{ ...delay, feedback: 0.73 }]
            : chain.effects,
      })),
    });

    const output = processBlock(source, 0.25);
    expect(setFeedback).toHaveBeenLastCalledWith(0.73);
    expect(reset).not.toHaveBeenCalled();
    expect(output.every(Number.isFinite)).toBe(true);
    expect(output.some((sample) => sample !== 0)).toBe(true);
    reset.mockRestore();
    setFeedback.mockRestore();
  });

  test("maps official schema keys into the radio compatibility processors", () => {
    const source = new EffectSource("mixed", 48_000);
    source.addEffect(
      "pitch",
      "pitchShifter",
      {
        ...createDefaultEffectConfig("pitchShifter", "pitch", 0),
        enabled: true,
      },
      0
    );

    const compressorInput = spyOn(CTAGCompressor.prototype, "setInputGain");
    const compressorAttack = spyOn(CTAGCompressor.prototype, "setAutoAttack");
    const compressorRelease = spyOn(CTAGCompressor.prototype, "setAutoRelease");
    const compressorMakeup = spyOn(CTAGCompressor.prototype, "setAutoMakeup");

    const configs = [
      {
        ...createDefaultEffectConfig("delay", "delay", 1),
        cross: 0.44,
        delayMillis: 41,
        delayMusical: "1/12",
        dry: -8,
        filter: -0.45,
        lfoDepth: 47,
        lfoSpeed: 4.6,
        preMillisTimeLeft: 42,
        preMillisTimeRight: 43,
        preSyncTimeLeft: "3/32",
        preSyncTimeRight: "1/6",
        wet: -9,
      },
      {
        ...createDefaultEffectConfig("compressor", "compressor", 2),
        autoattack: true,
        automakeup: false,
        autorelease: true,
        inputgain: 3,
      },
      {
        ...createDefaultEffectConfig("tidal", "tidal", 3),
        rateDivision: "1/12",
      },
      {
        ...createDefaultEffectConfig("cheapReverb", "reverb", 4),
        damp: 0.63,
        decay: 0.61,
        dry: -6.5,
        filter: -0.64,
        preDelay: 0.062,
        wet: -7.5,
      },
      {
        ...createDefaultEffectConfig("gate", "gate", 5),
        return: 6.6,
      },
      {
        ...createDefaultEffectConfig("waveshaper", "waveshaper", 6),
        deviceInputGain: 17,
        deviceOutputGain: -7,
        equation: "hardclip",
        mix: 0.68,
      },
      {
        ...createDefaultEffectConfig("maximizer", "maximizer", 7),
        lookaheadEnabled: false,
      },
      {
        ...createDefaultEffectConfig("vocoder", "vocoder", 8),
        bandCount: 8,
        carrierMaxFreq: 11_111,
        carrierMinFreq: 111,
        envAttack: 7,
        envRelease: 70,
        gain: 3,
        mix: 0.69,
        modulatorMaxFreq: 12_222,
        modulatorMinFreq: 222,
        modulatorSource: "noise-brown",
        qEnd: 4,
        qStart: 23,
      },
      {
        ...createDefaultEffectConfig("neuralAmp", "amp", 9),
        mix: 0.71,
        mono: false,
      },
      {
        ...createDefaultEffectConfig("autotune", "autotune", 10),
        retuneAmount: 0.75,
        scale: "majorPentatonic",
        smooth: 0.72,
      },
    ];

    for (const config of configs) {
      expect(
        source.addEffect(
          config.id,
          config.type,
          config as unknown as Record<string, unknown>,
          config.order
        )
      ).toBe(true);
    }

    expect(getProcessor(source, "delay")).toMatchObject({
      crossFeedback: 0.44,
      delayMillis: 41,
      delayMusical: "1/12",
      lfoDepth: 47,
      lfoRate: 4.6,
      preMillisTimeLeft: 42,
      preMillisTimeRight: 43,
      preSyncTimeLeft: "3/32",
      preSyncTimeRight: "1/6",
    });
    expect(compressorInput).toHaveBeenLastCalledWith(3);
    expect(compressorAttack).toHaveBeenLastCalledWith(true);
    expect(compressorRelease).toHaveBeenLastCalledWith(true);
    expect(compressorMakeup).toHaveBeenLastCalledWith(false);
    expect(getProcessor(source, "tidal")).toMatchObject({
      tempoDivision: "1/12",
      tempoSync: true,
    });
    expect(getProcessor(source, "reverb")).toMatchObject({
      damping: 0.63,
      filter: -0.64,
      roomSize: 0.61,
    });
    expect(getProcessor(source, "gate")).toMatchObject({
      returnAmount: 6.6,
    });
    expect(getProcessor(source, "waveshaper")).toMatchObject({
      mix: 0.68,
      shape: "hardclip",
    });
    expect(getProcessor(source, "maximizer")).toMatchObject({
      lookahead: 0,
    });
    expect(getProcessor(source, "vocoder")).toMatchObject({
      attack: 7,
      bands: 8,
      carrierMaxFreq: 11_111,
      carrierMinFreq: 111,
      mix: 0.69,
      modulator: "noise",
      modulatorMaxFreq: 12_222,
      modulatorMinFreq: 222,
      noiseKind: "brown",
      qEnd: 4,
      qStart: 23,
      release: 70,
    });
    expect(getProcessor(source, "amp")).toMatchObject({
      mix: 0.71,
      mono: false,
    });
    expect(getProcessor(source, "autotune")).toMatchObject({
      retune: 60,
      scale: "majorPentatonic",
      smoothing: 0.72,
    });
    compressorInput.mockRestore();
    compressorAttack.mockRestore();
    compressorRelease.mockRestore();
    compressorMakeup.mockRestore();
  });

  test("converts plate reverb pre-delay milliseconds to DSP seconds", () => {
    const preDelay = spyOn(DattorroReverb.prototype, "setPreDelay");
    const source = new EffectSource("reverb-units", 48_000);
    const config = {
      ...createDefaultEffectConfig("plateReverb", "reverb", 0),
      enabled: true,
      preDelayMillis: 100,
    };

    source.addEffect(config.id, config.type, config, config.order);

    expect(preDelay).toHaveBeenLastCalledWith(0.1);
    preDelay.mockRestore();
  });

  test("preserves positive plate reverb wet and dry gains", () => {
    const source = new EffectSource("reverb-positive-gain", 48_000);
    const config = {
      ...createDefaultEffectConfig("plateReverb", "reverb", 0),
      dry: 12,
      wet: 12,
    };

    source.addEffect(config.id, config.type, config, config.order);

    expect(getProcessor(source, config.id)).toMatchObject({
      dry: 10 ** (12 / 20),
      wet: 10 ** (12 / 20),
    });
  });

  test("bypasses a compatibility neural amp until a model is selected", () => {
    const source = new EffectSource("model-less-amp", 48_000);
    const config = {
      ...createDefaultEffectConfig("neuralAmp", "amp", 0),
      enabled: true,
    };
    source.addEffect(config.id, config.type, config, config.order);

    const input = new Float32Array(BLOCK_SIZE).map(
      (_, index) => (index - BLOCK_SIZE / 2) / BLOCK_SIZE
    );
    const outputL = new Float32Array(BLOCK_SIZE);
    const outputR = new Float32Array(BLOCK_SIZE);
    source.process(input, input, outputL, outputR, 0, BLOCK_SIZE);

    expect(outputL).toEqual(input);
    expect(outputR).toEqual(input);

    source.updateEffect(config.id, { modelAvailable: 1 });
    source.process(input, input, outputL, outputR, 0, BLOCK_SIZE);
    expect(outputL).not.toEqual(input);
  });

  test("composes generalized controls around the device exactly once", () => {
    const source = new EffectSource("wrapper", 48_000);
    const config = {
      ...createDefaultEffectConfig("werkstatt", "werkstatt", 0),
      code: `class Processor {
        drive = 1
        paramChanged(label, value) {
          if (label === "drive") this.drive = value
        }
        process({ src, out }, { s0, s1 }) {
          for (let index = s0; index < s1; index++) {
            out[0][index] = src[0][index] * this.drive
            out[1][index] = src[1][index] * this.drive
          }
        }
      }`,
      dryWet: 0.25,
      enabled: true,
      inputGain: 0.5,
      outputGain: 0.8,
      parameters: { drive: 2 },
      source: "return input * p.drive;",
    };

    expect(source.addEffect(config.id, config.type, config, config.order)).toBe(
      true
    );

    const output = processBlock(source, 0.4);
    // 0.8 * (0.75 * 0.4 + 0.25 * (0.4 * 0.5 * 2))
    expect(output.at(-1)).toBeCloseTo(0.32, 6);

    source.updateEffect(config.id, { dryWet: 0 });
    expect(processBlock(source, 0.4).at(-1)).toBeCloseTo(0.32, 6);
  });

  test("maps native dB and compatibility-only controls without collisions", () => {
    const source = new EffectSource("native-mapping", 48_000);
    const plate = {
      ...createDefaultEffectConfig("plateReverb", "plate", 0),
      dry: -12,
      wet: -6,
    };
    const amp = {
      ...createDefaultEffectConfig("neuralAmp", "amp", 1),
      input: -18,
    };
    const werkstatt = {
      ...createDefaultEffectConfig("werkstatt", "werkstatt", 2),
      code: "class Processor { process() { throw new Error('official only'); } }",
      parameters: { drive: 2 },
      source: "return input * p.drive;",
    };

    source.addEffect(plate.id, plate.type, plate, plate.order);
    source.addEffect(amp.id, amp.type, amp, amp.order);
    source.addEffect(werkstatt.id, werkstatt.type, werkstatt, werkstatt.order);

    expect(getProcessor(source, plate.id)).toMatchObject({
      dry: 10 ** (-12 / 20),
      wet: 10 ** (-6 / 20),
    });
    expect(getProcessor(source, amp.id)).toMatchObject({ drive: -18 });
    expect(getProcessor(source, werkstatt.id)).toMatchObject({
      failed: false,
      source: werkstatt.code,
    });
  });
});
