import { applyEffectConfig } from "../src/lib/audio/dsp/effect-processor-factory";
import { createDefaultEffectConfig } from "../src/lib/audio/dsp/effects/registry";
import { VocoderEffect } from "../src/lib/audio/dsp/effects/stock-effects";
import type {
  EffectConfig,
  EffectType,
} from "../src/lib/audio/dsp/effects/types";
import { EffectSource } from "../src/lib/audio/dsp/processor-source";

const sampleRate = 48_000;
const frames = 128;
const quantumBudgetUs = (frames / sampleRate) * 1_000_000;
const warmupQuanta = 1000;
const measuredQuanta = 12_000;
const inputL = new Float32Array(frames);
const inputR = new Float32Array(frames);
const outputL = new Float32Array(frames);
const outputR = new Float32Array(frames);

for (let index = 0; index < frames; index += 1) {
  inputL[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.7;
  inputR[index] = Math.sin((2 * Math.PI * 523 * index) / sampleRate) * 0.7;
}

function configured(
  type: EffectType,
  id: string,
  order: number,
  patch: Record<string, unknown> = {}
): EffectConfig {
  return Object.assign(createDefaultEffectConfig(type, id, order), patch, {
    enabled: true,
  }) as EffectConfig;
}

function heavySplit(): EffectConfig {
  const split = configured("frequencySplit", "split", 0) as Extract<
    EffectConfig,
    { type: "frequencySplit" }
  >;
  split.chains = split.chains.map((chain, band) => ({
    ...chain,
    effects: [
      configured("distortion", `distortion-${band}`, 0, {
        amount: 100,
        oversample: "4x",
      }),
      configured("fold", `fold-${band}`, 1, { amount: 40, oversample: 8 }),
      configured("vocoder", `vocoder-${band}`, 2, {
        bandCount: 16,
        modulatorSource: "noise-pink",
      }),
      configured("autotune", `autotune-${band}`, 3),
    ],
  }));
  return split;
}

const scenarios: ReadonlyArray<readonly [string, readonly EffectConfig[]]> = [
  ["bypass", []],
  ["radio-pitch-shifter", [configured("pitchShifter", "pitch", 0)]],
  [
    "radio-distortion-4x",
    [
      configured("distortion", "distortion", 0, {
        amount: 100,
        oversample: "4x",
      }),
    ],
  ],
  ["radio-limiter", [configured("limiter", "limiter", 0)]],
  [
    "vocoder-16-pink",
    [
      configured("vocoder", "vocoder", 0, {
        bandCount: 16,
        modulatorSource: "noise-pink",
      }),
    ],
  ],
  ["frequency-split-heavy", [heavySplit()]],
];

function percentile(sorted: readonly number[], fraction: number): number {
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0
  );
}

function createSource(
  id: string,
  effects: readonly EffectConfig[]
): EffectSource {
  const source = new EffectSource(id, sampleRate);
  for (const effect of effects) {
    source.addEffect(effect.id, effect.type, effect, effect.order);
  }
  source.start();
  return source;
}

function benchmark(
  name: string,
  effects: readonly EffectConfig[],
  decks = 1
): void {
  const sources = Array.from({ length: decks }, (_, index) =>
    createSource(`${name}-${index}`, effects)
  );
  const process = () => {
    for (const source of sources) {
      source.process(inputL, inputR, outputL, outputR, 0, frames);
    }
  };
  for (let index = 0; index < warmupQuanta; index += 1) {
    process();
  }
  const times: number[] = [];
  for (let index = 0; index < measuredQuanta; index += 1) {
    const before = performance.now();
    process();
    times.push((performance.now() - before) * 1000);
  }
  times.sort((left, right) => left - right);
  const p99Us = percentile(times, 0.99);
  console.log(
    JSON.stringify({
      benchmark: "compatibility-effects",
      decks,
      maxUs: Number((times.at(-1) ?? 0).toFixed(2)),
      missedDeadlines: times.filter((time) => time >= quantumBudgetUs).length,
      name,
      p50Us: Number(percentile(times, 0.5).toFixed(2)),
      p95Us: Number(percentile(times, 0.95).toFixed(2)),
      p99LoadPercent: Number(((p99Us / quantumBudgetUs) * 100).toFixed(2)),
      p99Us: Number(p99Us.toFixed(2)),
      quantumBudgetUs: Number(quantumBudgetUs.toFixed(2)),
      sampleRate,
    })
  );
}

function benchmarkVocoderUpdates(): void {
  const effect = new VocoderEffect(sampleRate);
  const config = configured("vocoder", "vocoder", 0, {
    bandCount: 16,
    modulatorSource: "noise-pink",
  });
  applyEffectConfig(effect, "vocoder", config as Record<string, unknown>);
  const times: number[] = [];
  for (let index = 0; index < measuredQuanta; index += 1) {
    const before = performance.now();
    applyEffectConfig(effect, "vocoder", { gain: index % 2 });
    times.push((performance.now() - before) * 1000);
  }
  times.sort((left, right) => left - right);
  console.log(
    JSON.stringify({
      benchmark: "effect-config-update",
      maxUs: Number((times.at(-1) ?? 0).toFixed(2)),
      name: "vocoder-gain",
      p50Us: Number(percentile(times, 0.5).toFixed(2)),
      p95Us: Number(percentile(times, 0.95).toFixed(2)),
      p99Us: Number(percentile(times, 0.99).toFixed(2)),
    })
  );
}

for (const [name, effects] of scenarios) {
  benchmark(name, effects);
}
benchmark("frequency-split-heavy", [heavySplit()], 2);
benchmarkVocoderUpdates();
