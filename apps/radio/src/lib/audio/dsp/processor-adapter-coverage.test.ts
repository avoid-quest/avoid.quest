import { describe, expect, spyOn, test } from "bun:test";
import { CTAGCompressor } from "./effects/ctag-compressor";
import { createDefaultEffectConfig } from "./effects/registry";
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
  const effects = (
    source as unknown as { effects: Map<string, EffectProcessor> }
  ).effects;
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
          enabled: false,
          dryWet: 0.37,
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

  test("applies stock effect parameters instead of silently using defaults", () => {
    const closedGate = new EffectSource("closed", 48_000);
    const openGate = new EffectSource("open", 48_000);
    const base = {
      ...createDefaultEffectConfig("gate", "gate", 0),
      enabled: true,
      attack: 0.1,
      hold: 0,
      release: 1,
      floor: -120,
    };

    expect(
      closedGate.addEffect("gate", "gate", { ...base, threshold: 0 }, 0)
    ).toBe(true);
    expect(
      openGate.addEffect("gate", "gate", { ...base, threshold: -80 }, 0)
    ).toBe(true);

    let closed: Float32Array<ArrayBufferLike> = new Float32Array(BLOCK_SIZE);
    let open: Float32Array<ArrayBufferLike> = new Float32Array(BLOCK_SIZE);
    for (let block = 0; block < 20; block++) {
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

    expect(source.addEffect("parallel", "fxComposite", composite, 0)).toBe(
      true
    );
    source.updateEffect("parallel", {
      chains: [
        {
          id: "nested",
          name: "Nested",
          order: 0,
          gain: 1,
          pan: 0,
          muted: false,
          solo: false,
          effects: [
            {
              ...createDefaultEffectConfig("limiter", "nested-limiter", 0),
              enabled: true,
            },
          ],
        },
      ],
    });

    const output = processBlock(source, 0.25);
    expect(output.every(Number.isFinite)).toBe(true);
    expect(output.some((sample) => sample !== 0)).toBe(true);
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
        delayMusical: "1/12",
        delayMillis: 41,
        preSyncTimeLeft: "3/32",
        preMillisTimeLeft: 42,
        preSyncTimeRight: "1/6",
        preMillisTimeRight: 43,
        cross: 0.44,
        filter: -0.45,
        lfoSpeed: 4.6,
        lfoDepth: 47,
        dry: -8,
        wet: -9,
      },
      {
        ...createDefaultEffectConfig("compressor", "compressor", 2),
        inputgain: 3,
        autoattack: true,
        autorelease: true,
        automakeup: false,
      },
      {
        ...createDefaultEffectConfig("tidal", "tidal", 3),
        rateDivision: "1/12",
      },
      {
        ...createDefaultEffectConfig("cheapReverb", "reverb", 4),
        decay: 0.61,
        preDelay: 0.062,
        damp: 0.63,
        filter: -0.64,
        dry: -6.5,
        wet: -7.5,
      },
      {
        ...createDefaultEffectConfig("gate", "gate", 5),
        return: 6.6,
      },
      {
        ...createDefaultEffectConfig("waveshaper", "waveshaper", 6),
        equation: "hardclip",
        deviceInputGain: 17,
        deviceOutputGain: -7,
        mix: 0.68,
      },
      {
        ...createDefaultEffectConfig("maximizer", "maximizer", 7),
        lookaheadEnabled: false,
      },
      {
        ...createDefaultEffectConfig("vocoder", "vocoder", 8),
        carrierMinFreq: 111,
        carrierMaxFreq: 11_111,
        modulatorMinFreq: 222,
        modulatorMaxFreq: 12_222,
        qStart: 23,
        qEnd: 4,
        envAttack: 7,
        envRelease: 70,
        gain: 3,
        mix: 0.69,
        bandCount: 8,
        modulatorSource: "noise-brown",
      },
      {
        ...createDefaultEffectConfig("neuralAmp", "amp", 9),
        mono: false,
        mix: 0.71,
      },
      {
        ...createDefaultEffectConfig("autotune", "autotune", 10),
        scale: "majorPentatonic",
        retuneAmount: 0.75,
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
      delayMusical: "1/12",
      delayMillis: 41,
      preSyncTimeLeft: "3/32",
      preMillisTimeLeft: 42,
      preSyncTimeRight: "1/6",
      preMillisTimeRight: 43,
      crossFeedback: 0.44,
      lfoRate: 4.6,
      lfoDepth: 47,
    });
    expect(compressorInput).toHaveBeenLastCalledWith(3);
    expect(compressorAttack).toHaveBeenLastCalledWith(true);
    expect(compressorRelease).toHaveBeenLastCalledWith(true);
    expect(compressorMakeup).toHaveBeenLastCalledWith(false);
    expect(getProcessor(source, "tidal")).toMatchObject({
      tempoSync: true,
      tempoDivision: "1/12",
    });
    expect(getProcessor(source, "reverb")).toMatchObject({
      roomSize: 0.61,
      damping: 0.63,
      filter: -0.64,
    });
    expect(getProcessor(source, "gate")).toMatchObject({
      returnAmount: 6.6,
    });
    expect(getProcessor(source, "waveshaper")).toMatchObject({
      shape: "hardclip",
      mix: 0.68,
    });
    expect(getProcessor(source, "maximizer")).toMatchObject({
      lookahead: 0,
    });
    expect(getProcessor(source, "vocoder")).toMatchObject({
      bands: 8,
      modulator: "noise",
      noiseKind: "brown",
      carrierMinFreq: 111,
      carrierMaxFreq: 11_111,
      modulatorMinFreq: 222,
      modulatorMaxFreq: 12_222,
      qStart: 23,
      qEnd: 4,
      attack: 7,
      release: 70,
      mix: 0.69,
    });
    expect(getProcessor(source, "amp")).toMatchObject({
      mono: false,
      mix: 0.71,
    });
    expect(getProcessor(source, "autotune")).toMatchObject({
      scale: "majorPentatonic",
      retune: 60,
      smoothing: 0.72,
    });
    compressorInput.mockRestore();
    compressorAttack.mockRestore();
    compressorRelease.mockRestore();
    compressorMakeup.mockRestore();
  });

  test("composes generalized controls around the device exactly once", () => {
    const source = new EffectSource("wrapper", 48_000);
    const config = {
      ...createDefaultEffectConfig("werkstatt", "werkstatt", 0),
      enabled: true,
      source: "return input * p.drive;",
      parameters: { drive: 2 },
      inputGain: 0.5,
      dryWet: 0.25,
      outputGain: 0.8,
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
      wet: -6,
      dry: -12,
    };
    const amp = {
      ...createDefaultEffectConfig("neuralAmp", "amp", 1),
      input: -18,
    };
    const werkstatt = {
      ...createDefaultEffectConfig("werkstatt", "werkstatt", 2),
      source: "return input * p.drive;",
      code: "class Processor { process() { throw new Error('official only'); } }",
      parameters: { drive: 2 },
    };

    source.addEffect(plate.id, plate.type, plate, plate.order);
    source.addEffect(amp.id, amp.type, amp, amp.order);
    source.addEffect(werkstatt.id, werkstatt.type, werkstatt, werkstatt.order);

    expect(getProcessor(source, plate.id)).toMatchObject({
      wet: 10 ** (-6 / 20),
      dry: 10 ** (-12 / 20),
    });
    expect(getProcessor(source, amp.id)).toMatchObject({ drive: -18 });
    expect(getProcessor(source, werkstatt.id)).toMatchObject({
      failed: false,
      source: werkstatt.source,
    });
  });
});
