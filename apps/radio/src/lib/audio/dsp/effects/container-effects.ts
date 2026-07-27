import { BiquadFilter } from "./biquad-filter.js";
import { clampEffectTempo } from "./tempo.js";
import type {
  EffectChainConfig,
  EffectConfig,
  EffectProcessor,
  StereoChannels,
} from "./types.js";

type ProcessorFactory = (config: EffectConfig) => EffectProcessor | null;

type ChainRuntime = {
  config: EffectChainConfig;
  processors: Array<{ config: EffectConfig; processor: EffectProcessor }>;
  first: StereoChannels;
  second: StereoChannels;
  dry: StereoChannels;
};

const createBuffer = (): StereoChannels => [
  new Float32Array(128),
  new Float32Array(128),
];

const copy = (
  source: StereoChannels,
  target: StereoChannels,
  fromIndex: number,
  toIndex: number
): void => {
  for (let i = fromIndex; i < toIndex; i++) {
    target[0][i] = source[0][i] ?? 0;
    target[1][i] = source[1][i] ?? 0;
  }
};

const usesSidechain = (effect: EffectConfig): boolean =>
  Boolean(effect.sidechain) ||
  (effect.type === "fxComposite" ||
  effect.type === "stereoSplit" ||
  effect.type === "frequencySplit"
    ? effect.chains.some((chain) => chain.effects.some(usesSidechain))
    : false);

const branchPanGains = (
  type: "fxComposite" | "stereoSplit" | "frequencySplit",
  pan: number
): readonly [number, number] => {
  if (type === "stereoSplit") {
    return [pan <= 0 ? 1 : 1 - pan, pan >= 0 ? 1 : 1 + pan];
  }
  if (type === "frequencySplit") {
    return [pan <= 0 ? 1 : 1 - pan, pan >= 0 ? 1 : 1 + pan];
  }
  const angle = ((pan + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
};

export class ContainerEffect implements EffectProcessor {
  private readonly type: "fxComposite" | "stereoSplit" | "frequencySplit";
  private readonly sampleRate: number;
  private readonly factory: ProcessorFactory;
  private chains: ChainRuntime[] = [];
  private crossovers: number[] = [];
  private crossoverFilters: BiquadFilter[] = [];
  private readonly splitBuffers = Array.from({ length: 6 }, createBuffer);
  private readonly residualBuffers = [createBuffer(), createBuffer()];
  private readonly silent = createBuffer();
  private sidechain: StereoChannels | null = null;
  private tempo = 120;

  constructor(
    type: "fxComposite" | "stereoSplit" | "frequencySplit",
    sampleRate: number,
    config: EffectConfig,
    factory: ProcessorFactory
  ) {
    this.type = type;
    this.sampleRate = sampleRate;
    this.factory = factory;
    this.configure(config);
  }

  configure(config: EffectConfig): void {
    if (
      config.type !== "fxComposite" &&
      config.type !== "stereoSplit" &&
      config.type !== "frequencySplit"
    ) {
      return;
    }
    this.chains = [...config.chains]
      .sort((left, right) => left.order - right.order)
      .map((chain) => ({
        config: chain,
        processors: [...chain.effects]
          .sort((left, right) => left.order - right.order)
          .flatMap((effect) => {
            const processor = this.factory(effect);
            return processor ? [{ config: effect, processor }] : [];
          }),
        first: createBuffer(),
        second: createBuffer(),
        dry: createBuffer(),
      }));
    this.crossovers =
      config.type === "frequencySplit"
        ? [...config.crossoverFrequencies]
            .filter(Number.isFinite)
            .sort((left, right) => left - right)
        : [];
    this.rebuildCrossoverFilters();
    this.setSidechainInput(this.sidechain);
    this.setTempo(this.tempo);
  }

  private rebuildCrossoverFilters(): void {
    this.crossoverFilters = this.crossovers
      .slice(0, Math.max(0, this.chains.length - 1))
      .map((frequency) => {
        const filter = new BiquadFilter(this.sampleRate);
        filter.type = "lowpass";
        filter.frequency = frequency;
        filter.Q = Math.SQRT1_2;
        return filter;
      });
  }

  setSidechainInput(input: StereoChannels | null): void {
    this.sidechain = input;
    for (const chain of this.chains) {
      for (const { config, processor } of chain.processors) {
        processor.setSidechainInput?.(usesSidechain(config) ? input : null);
      }
    }
  }

  setTempo(bpm: number): void {
    this.tempo = clampEffectTempo(bpm);
    for (const chain of this.chains) {
      for (const { processor } of chain.processors) {
        processor.setTempo?.(this.tempo);
      }
    }
  }

  reset(): void {
    for (const chain of this.chains) {
      for (const { processor } of chain.processors) {
        processor.reset();
      }
    }
    for (const filter of this.crossoverFilters) {
      filter.reset();
    }
  }

  private processChain(
    chain: ChainRuntime,
    input: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): StereoChannels {
    copy(input, chain.first, fromIndex, toIndex);
    let current = chain.first;
    let target = chain.second;
    for (const { config, processor } of chain.processors) {
      if (!config.enabled) {
        continue;
      }
      if (config.dryWet < 1) {
        copy(current, chain.dry, fromIndex, toIndex);
      }
      if (config.inputGain !== 1) {
        for (let i = fromIndex; i < toIndex; i++) {
          current[0][i] = (current[0][i] ?? 0) * config.inputGain;
          current[1][i] = (current[1][i] ?? 0) * config.inputGain;
        }
      }
      processor.process(current, target, fromIndex, toIndex);
      if (config.dryWet < 1) {
        const dry = 1 - config.dryWet;
        for (let i = fromIndex; i < toIndex; i++) {
          target[0][i] =
            (chain.dry[0][i] ?? 0) * dry + (target[0][i] ?? 0) * config.dryWet;
          target[1][i] =
            (chain.dry[1][i] ?? 0) * dry + (target[1][i] ?? 0) * config.dryWet;
        }
      }
      if (config.outputGain !== 1) {
        for (let i = fromIndex; i < toIndex; i++) {
          target[0][i] = (target[0][i] ?? 0) * config.outputGain;
          target[1][i] = (target[1][i] ?? 0) * config.outputGain;
        }
      }
      [current, target] = [target, current];
    }
    return current;
  }

  private mixChain(
    chain: ChainRuntime,
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    if (chain.config.muted) {
      return;
    }
    const result = this.processChain(chain, input, fromIndex, toIndex);
    const pan = Math.max(-1, Math.min(1, chain.config.pan));
    const [leftPanGain, rightPanGain] = branchPanGains(this.type, pan);
    const leftGain = leftPanGain * chain.config.gain;
    const rightGain = rightPanGain * chain.config.gain;
    for (let i = fromIndex; i < toIndex; i++) {
      output[0][i] = (output[0][i] ?? 0) + (result[0][i] ?? 0) * leftGain;
      output[1][i] = (output[1][i] ?? 0) + (result[1][i] ?? 0) * rightGain;
    }
  }

  private prepareFrequencyBands(
    input: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): StereoChannels[] {
    const bands = this.chains.map(
      (_, index) => this.splitBuffers[index] ?? createBuffer()
    );
    let residual = this.residualBuffers[0] ?? createBuffer();
    let nextResidual = this.residualBuffers[1] ?? createBuffer();
    copy(input, residual, fromIndex, toIndex);

    for (let index = 0; index < bands.length - 1; index++) {
      const band = bands[index];
      const filter = this.crossoverFilters[index];
      if (!(band && filter)) {
        continue;
      }
      filter.process(residual, band, fromIndex, toIndex);
      for (let i = fromIndex; i < toIndex; i++) {
        nextResidual[0][i] = (residual[0][i] ?? 0) - (band[0][i] ?? 0);
        nextResidual[1][i] = (residual[1][i] ?? 0) - (band[1][i] ?? 0);
      }
      [residual, nextResidual] = [nextResidual, residual];
    }

    const finalBand = bands.at(-1);
    if (finalBand) {
      copy(residual, finalBand, fromIndex, toIndex);
    }
    return bands;
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    output[0].fill(0, fromIndex, toIndex);
    output[1].fill(0, fromIndex, toIndex);
    const hasSolo = this.chains.some((chain) => chain.config.solo);

    if (this.type === "stereoSplit") {
      const leftInput = this.splitBuffers[0] ?? createBuffer();
      const rightInput = this.splitBuffers[1] ?? createBuffer();
      for (let i = fromIndex; i < toIndex; i++) {
        leftInput[0][i] = input[0][i] ?? 0;
        leftInput[1][i] = 0;
        rightInput[0][i] = 0;
        rightInput[1][i] = input[1][i] ?? 0;
      }
      const inputs = [leftInput, rightInput];
      for (let index = 0; index < Math.min(2, this.chains.length); index++) {
        const chain = this.chains[index];
        if (chain && (!hasSolo || chain.config.solo)) {
          this.mixChain(
            chain,
            inputs[index] ?? this.silent,
            output,
            fromIndex,
            toIndex
          );
        }
      }
      return;
    }

    const inputs =
      this.type === "frequencySplit"
        ? this.prepareFrequencyBands(input, fromIndex, toIndex)
        : this.chains.map(() => input);
    for (let index = 0; index < this.chains.length; index++) {
      const chain = this.chains[index];
      if (chain && (!hasSolo || chain.config.solo)) {
        this.mixChain(
          chain,
          inputs[index] ?? input,
          output,
          fromIndex,
          toIndex
        );
      }
    }
  }
}
