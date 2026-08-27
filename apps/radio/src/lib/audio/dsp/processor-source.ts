import {
  applyEffectConfig,
  createEffectProcessor,
} from "./effect-processor-factory.js";
import {
  BiquadFilter,
  type BiquadFilterType,
} from "./effects/biquad-filter.js";
import { ContainerEffect } from "./effects/container-effects.js";
import { clampEffectTempo } from "./effects/tempo.js";
import type {
  EffectConfig,
  EffectProcessor,
  EffectType,
  StereoChannels,
} from "./effects/types.js";

export { ChannelStrip } from "./channel-strip.js";

function stereoBalanceGains(volume: number, pan: number): [number, number] {
  return [(1 - Math.max(0, pan)) * volume, (1 + Math.min(0, pan)) * volume];
}

type EffectConfigData = {
  enabled: boolean;
  inputGain: number;
  outputGain: number;
  dryWet: number;
  order: number;
  raw: Record<string, unknown>;
};

export class EffectSource {
  readonly id: string;
  private readonly sampleRate: number;

  volume = 1.0;
  pan = 0.0;
  private targetLeftGain = 1.0;
  private targetRightGain = 1.0;
  private currentLeftGain = 1.0;
  private currentRightGain = 1.0;

  private static readonly GAIN_SMOOTH_COEFF = 0.1;

  private readonly filters = new Map<string, BiquadFilter>();
  private filterOrder: string[] = [];
  private readonly effects = new Map<string, EffectProcessor>();
  private effectOrder: string[] = [];
  private readonly effectTypes = new Map<string, EffectType>();
  private readonly effectConfigs = new Map<string, EffectConfigData>();

  private readonly tempL: Float32Array;
  private readonly tempR: Float32Array;
  private readonly dryL: Float32Array;
  private readonly dryR: Float32Array;
  private readonly originalL: Float32Array;
  private readonly originalR: Float32Array;
  private readonly outputChannels: StereoChannels;
  private readonly sidechainChannels: StereoChannels;
  private readonly tempChannels: StereoChannels;

  private playing = false;
  private paused = false;
  private masterEffectsDryWet = 1.0;
  private tempo = 120;

  constructor(id: string, sampleRate: number) {
    this.id = id;
    this.sampleRate = sampleRate;
    this.tempL = new Float32Array(128);
    this.tempR = new Float32Array(128);
    this.dryL = new Float32Array(128);
    this.dryR = new Float32Array(128);
    this.originalL = new Float32Array(128);
    this.originalR = new Float32Array(128);
    this.tempChannels = [this.tempL, this.tempR];
    this.outputChannels = [this.tempL, this.tempR];
    this.sidechainChannels = [this.tempL, this.tempR];
    this.updateGains();
  }

  get isPlaying(): boolean {
    return this.playing && !this.paused;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  start(): void {
    this.playing = true;
    this.paused = false;
  }

  stop(): void {
    this.playing = false;
    this.paused = false;
    this.resetEffects();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.updateGains();
  }

  setPan(value: number): void {
    this.pan = Math.max(-1, Math.min(1, value));
    this.updateGains();
  }

  setEffectsDryWet(value: number): void {
    this.masterEffectsDryWet = Math.max(0, Math.min(1, value));
  }

  setTempo(value: number): void {
    this.tempo = clampEffectTempo(value);
    for (const effect of this.effects.values()) {
      effect.setTempo?.(this.tempo);
    }
  }

  private updateGains(): void {
    [this.targetLeftGain, this.targetRightGain] = stereoBalanceGains(
      this.volume,
      this.pan
    );
  }

  private smoothGain(current: number, target: number): number {
    return current + (target - current) * EffectSource.GAIN_SMOOTH_COEFF;
  }

  addFilter(
    filterId: string,
    type: BiquadFilterType,
    frequency: number,
    Q: number,
    gain: number
  ): void {
    const filter = new BiquadFilter(this.sampleRate);
    filter.type = type;
    filter.frequency = frequency;
    filter.Q = Q;
    filter.gain = gain;
    this.filters.set(filterId, filter);
    this.filterOrder.push(filterId);
  }

  removeFilter(filterId: string): void {
    this.filters.delete(filterId);
    this.filterOrder = this.filterOrder.filter((id) => id !== filterId);
  }

  setFilterParam(
    filterId: string,
    param: "frequency" | "Q" | "gain" | "type",
    value: number | string
  ): void {
    const filter = this.filters.get(filterId);
    if (!filter) {
      return;
    }

    switch (param) {
      case "frequency":
        filter.frequency = value as number;
        break;
      case "Q":
        filter.Q = value as number;
        break;
      case "gain":
        filter.gain = value as number;
        break;
      case "type":
        filter.type = value as BiquadFilterType;
        break;
      default:
        break;
    }
  }

  addEffect(
    effectId: string,
    type: EffectType,
    config: Record<string, unknown>,
    order: number
  ): boolean {
    const fullConfig = {
      id: effectId,
      type,
      order,
      ...config,
    } as EffectConfig;
    const processor = createEffectProcessor(type, this.sampleRate, fullConfig);
    if (!processor) {
      return false;
    }

    applyEffectConfig(processor, type, config);
    processor.setTempo?.(this.tempo);
    this.effects.set(effectId, processor);
    this.effectTypes.set(effectId, type);
    this.effectConfigs.set(effectId, {
      enabled: !!config.enabled,
      inputGain: typeof config.inputGain === "number" ? config.inputGain : 1.0,
      outputGain:
        typeof config.outputGain === "number" ? config.outputGain : 1.0,
      dryWet: typeof config.dryWet === "number" ? config.dryWet : 1.0,
      order,
      raw: { ...fullConfig },
    });
    this.insertEffectAtOrder(effectId, order);
    return true;
  }

  removeEffect(effectId: string): void {
    this.effects.delete(effectId);
    this.effectTypes.delete(effectId);
    this.effectConfigs.delete(effectId);
    this.effectOrder = this.effectOrder.filter((id) => id !== effectId);
  }

  updateEffect(effectId: string, config: Record<string, unknown>): void {
    const processor = this.effects.get(effectId);
    const type = this.effectTypes.get(effectId);
    if (!(processor && type)) {
      return;
    }

    applyEffectConfig(processor, type, config);

    const existingConfig = this.effectConfigs.get(effectId);
    if (existingConfig) {
      Object.assign(existingConfig.raw, config);
      if (processor instanceof ContainerEffect) {
        processor.configure(existingConfig.raw as EffectConfig);
      }
      if (typeof config.enabled === "boolean") {
        existingConfig.enabled = config.enabled;
      } else if (typeof config.enabled === "number") {
        existingConfig.enabled = config.enabled !== 0;
      }
      if (typeof config.inputGain === "number") {
        existingConfig.inputGain = config.inputGain;
      }
      if (typeof config.outputGain === "number") {
        existingConfig.outputGain = config.outputGain;
      }
      if (typeof config.dryWet === "number") {
        existingConfig.dryWet = config.dryWet;
      }
    }
  }

  reorderEffects(effectIds: string[]): void {
    this.effectOrder = effectIds.filter((id) => this.effects.has(id));
  }

  private insertEffectAtOrder(effectId: string, order: number): void {
    const insertIndex = this.effectOrder.findIndex((existingId) => {
      const existingConfig = this.effectConfigs.get(existingId);
      return existingConfig !== undefined && existingConfig.order > order;
    });

    if (insertIndex === -1) {
      this.effectOrder.push(effectId);
    } else {
      this.effectOrder.splice(insertIndex, 0, effectId);
    }
  }

  private resetEffects(): void {
    for (const filter of this.filters.values()) {
      filter.reset();
    }
    for (const effect of this.effects.values()) {
      effect.reset();
    }
  }

  process(
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: number,
    toIndex: number,
    sidechainL?: Float32Array,
    sidechainR?: Float32Array
  ): void {
    if (this.paused) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = 0;
        outputR[i] = 0;
      }
      return;
    }

    for (let i = fromIndex; i < toIndex; i++) {
      this.originalL[i] = inputL[i] ?? 0;
      this.originalR[i] = inputR[i] ?? 0;
      this.tempL[i] = inputL[i] ?? 0;
      this.tempR[i] = inputR[i] ?? 0;
    }

    const { outputChannels, tempChannels } = this;
    outputChannels[0] = outputL;
    outputChannels[1] = outputR;
    let current = tempChannels;

    for (const filterId of this.filterOrder) {
      const filter = this.filters.get(filterId);
      if (filter) {
        const target =
          current === outputChannels ? tempChannels : outputChannels;
        filter.process(current, target, fromIndex, toIndex);
        current = target;
      }
    }

    for (const effectId of this.effectOrder) {
      const effect = this.effects.get(effectId);
      const config = this.effectConfigs.get(effectId);
      if (!(effect && config?.enabled)) {
        continue;
      }

      if (sidechainL && config.raw.sidechainEnabled === 1) {
        this.sidechainChannels[0] = sidechainL;
        this.sidechainChannels[1] = sidechainR ?? sidechainL;
        effect.setSidechainInput?.(this.sidechainChannels);
      } else {
        effect.setSidechainInput?.(null);
      }

      const needsDryMix = config.dryWet < 1.0;
      if (needsDryMix) {
        for (let i = fromIndex; i < toIndex; i++) {
          this.dryL[i] = current[0][i] ?? 0;
          this.dryR[i] = current[1][i] ?? 0;
        }
      }

      if (config.inputGain !== 1.0) {
        for (let i = fromIndex; i < toIndex; i++) {
          current[0][i] = (current[0][i] ?? 0) * config.inputGain;
          current[1][i] = (current[1][i] ?? 0) * config.inputGain;
        }
      }

      const target = current === outputChannels ? tempChannels : outputChannels;
      effect.process(current, target, fromIndex, toIndex);
      current = target;

      if (needsDryMix) {
        const dry = 1.0 - config.dryWet;
        for (let i = fromIndex; i < toIndex; i++) {
          current[0][i] =
            (this.dryL[i] ?? 0) * dry + (current[0][i] ?? 0) * config.dryWet;
          current[1][i] =
            (this.dryR[i] ?? 0) * dry + (current[1][i] ?? 0) * config.dryWet;
        }
      }

      if (config.outputGain !== 1.0) {
        for (let i = fromIndex; i < toIndex; i++) {
          current[0][i] = (current[0][i] ?? 0) * config.outputGain;
          current[1][i] = (current[1][i] ?? 0) * config.outputGain;
        }
      }
    }

    if (current !== outputChannels) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = current[0][i] ?? 0;
        outputR[i] = current[1][i] ?? 0;
      }
    }

    if (this.masterEffectsDryWet < 1.0 && this.effectOrder.length > 0) {
      const wet = this.masterEffectsDryWet;
      const dry = 1.0 - wet;
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = (this.originalL[i] ?? 0) * dry + (outputL[i] ?? 0) * wet;
        outputR[i] = (this.originalR[i] ?? 0) * dry + (outputR[i] ?? 0) * wet;
      }
    }

    for (let i = fromIndex; i < toIndex; i++) {
      this.currentLeftGain = this.smoothGain(
        this.currentLeftGain,
        this.targetLeftGain
      );
      this.currentRightGain = this.smoothGain(
        this.currentRightGain,
        this.targetRightGain
      );

      outputL[i] = (outputL[i] ?? 0) * this.currentLeftGain;
      outputR[i] = (outputR[i] ?? 0) * this.currentRightGain;
    }
  }
}
