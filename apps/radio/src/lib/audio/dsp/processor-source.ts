import {
  BiquadFilter,
  type BiquadFilterType,
} from "./effects/biquad-filter.js";
import { CrusherEffect } from "./effects/crusher.js";
import { CTAGCompressor } from "./effects/ctag-compressor.js";
import { Delay } from "./effects/delay.js";
import { Distortion } from "./effects/distortion.js";
import { FoldEffect } from "./effects/fold.js";
import { Limiter } from "./effects/limiter.js";
import { PhaseVocoder } from "./effects/phase-vocoder.js";
import { RevampEffect } from "./effects/revamp.js";
import { DattorroReverb } from "./effects/reverb.js";
import { StereoToolEffect } from "./effects/stereo-tool.js";
import { TidalEffect } from "./effects/tidal.js";
import type { EffectProcessor, EffectType } from "./effects/types.js";

/**
 * Channel strip for volume and panning with smoothing
 */
export class ChannelStrip {
  volume = 1.0;
  pan = 0.0;
  private targetLeftGain = 1.0;
  private targetRightGain = 1.0;
  private currentLeftGain = 1.0;
  private currentRightGain = 1.0;

  private static readonly GAIN_SMOOTH_COEFF = 0.1;

  constructor() {
    this.updateGains();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.updateGains();
  }

  setPan(value: number): void {
    this.pan = Math.max(-1, Math.min(1, value));
    this.updateGains();
  }

  private updateGains(): void {
    const angle = ((this.pan + 1) / 2) * (Math.PI / 2);
    this.targetLeftGain = Math.cos(angle) * this.volume;
    this.targetRightGain = Math.sin(angle) * this.volume;
  }

  private smoothGain(current: number, target: number): number {
    return current + (target - current) * ChannelStrip.GAIN_SMOOTH_COEFF;
  }

  apply(
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: number,
    toIndex: number
  ): void {
    for (let i = fromIndex; i < toIndex; i++) {
      this.currentLeftGain = this.smoothGain(
        this.currentLeftGain,
        this.targetLeftGain
      );
      this.currentRightGain = this.smoothGain(
        this.currentRightGain,
        this.targetRightGain
      );

      outputL[i] = (inputL[i] ?? 0) * this.currentLeftGain;
      outputR[i] = (inputR[i] ?? 0) * this.currentRightGain;
    }
  }
}

type EffectConfigData = {
  enabled: boolean;
  inputGain: number;
  outputGain: number;
  dryWet: number;
  order: number;
};

function readBooleanConfig(
  config: Record<string, number | boolean | string>,
  key: string
): boolean | undefined {
  const value = config[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return undefined;
}

/**
 * Effect source - tracks effects and filters for a source
 * Audio comes from Web Audio graph, not from chunks
 */
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

  private playing = false;
  private paused = false;
  private masterEffectsDryWet = 1.0;

  constructor(id: string, sampleRate: number) {
    this.id = id;
    this.sampleRate = sampleRate;
    this.tempL = new Float32Array(128);
    this.tempR = new Float32Array(128);
    this.dryL = new Float32Array(128);
    this.dryR = new Float32Array(128);
    this.originalL = new Float32Array(128);
    this.originalR = new Float32Array(128);
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

  private updateGains(): void {
    const angle = ((this.pan + 1) / 2) * (Math.PI / 2);
    this.targetLeftGain = Math.cos(angle) * this.volume;
    this.targetRightGain = Math.sin(angle) * this.volume;
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
    config: Record<string, number | boolean | string>,
    order: number
  ): boolean {
    const processor = this.createEffectProcessor(type);
    if (!processor) {
      return false;
    }

    this.applyEffectConfig(processor, type, config);
    this.effects.set(effectId, processor);
    this.effectTypes.set(effectId, type);
    this.effectConfigs.set(effectId, {
      enabled: !!config.enabled,
      inputGain: typeof config.inputGain === "number" ? config.inputGain : 1.0,
      outputGain:
        typeof config.outputGain === "number" ? config.outputGain : 1.0,
      dryWet: typeof config.dryWet === "number" ? config.dryWet : 1.0,
      order,
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

  updateEffect(
    effectId: string,
    config: Record<string, number | boolean | string>
  ): void {
    const processor = this.effects.get(effectId);
    const type = this.effectTypes.get(effectId);
    if (!(processor && type)) {
      return;
    }

    this.applyEffectConfig(processor, type, config);

    const existingConfig = this.effectConfigs.get(effectId);
    if (existingConfig) {
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

  private createEffectProcessor(type: EffectType): EffectProcessor | null {
    switch (type) {
      case "plateReverb":
        return new DattorroReverb(this.sampleRate);
      case "pitchShifter":
        return new PhaseVocoder();
      case "limiter":
        return new Limiter(this.sampleRate);
      case "distortion":
        return new Distortion(this.sampleRate);
      case "compressor":
        return new CTAGCompressor(this.sampleRate);
      case "crusher":
        return new CrusherEffect(this.sampleRate);
      case "fold":
        return new FoldEffect(this.sampleRate);
      case "stereoTool":
        return new StereoToolEffect(this.sampleRate);
      case "revamp":
        return new RevampEffect(this.sampleRate);
      case "tidal":
        return new TidalEffect(this.sampleRate);
      case "delay":
        return new Delay(this.sampleRate);
      default:
        return null;
    }
  }

  private applyEffectConfig(
    processor: EffectProcessor,
    type: EffectType,
    config: Record<string, number | boolean | string>
  ): void {
    switch (type) {
      case "crusher": {
        const crusher = processor as CrusherEffect;
        if (typeof config.crush === "number") {
          crusher.setCrush(config.crush);
        }
        if (typeof config.bitDepth === "number") {
          crusher.setBitDepth(config.bitDepth);
        }
        if (typeof config.boost === "number") {
          crusher.setBoost(config.boost);
        }
        const autoGain = readBooleanConfig(config, "autoGain");
        if (autoGain !== undefined) {
          crusher.setAutoGain(autoGain);
        }
        break;
      }
      case "fold": {
        const fold = processor as FoldEffect;
        if (typeof config.amount === "number") {
          fold.setAmount(config.amount);
        }
        if (typeof config.volume === "number") {
          fold.setVolume(config.volume);
        }
        if (typeof config.oversample === "number") {
          const os = config.oversample;
          if (os === 2 || os === 4 || os === 8) {
            fold.setOversample(os);
          }
        }
        const autoGain = readBooleanConfig(config, "autoGain");
        if (autoGain !== undefined) {
          fold.setAutoGain(autoGain);
        }
        break;
      }
      case "stereoTool": {
        const stereo = processor as StereoToolEffect;
        if (typeof config.volume === "number") {
          stereo.setVolume(config.volume);
        }
        if (typeof config.stereo === "number") {
          stereo.setStereoWidth(config.stereo);
        }
        const invertL = readBooleanConfig(config, "invertL");
        if (invertL !== undefined) {
          stereo.setInvertL(invertL);
        }
        const invertR = readBooleanConfig(config, "invertR");
        if (invertR !== undefined) {
          stereo.setInvertR(invertR);
        }
        const swap = readBooleanConfig(config, "swap");
        if (swap !== undefined) {
          stereo.setSwap(swap);
        }
        break;
      }
      case "tidal": {
        const tidal = processor as TidalEffect;
        if (typeof config.rate === "number") {
          tidal.setRate(config.rate);
        }
        if (typeof config.depth === "number") {
          tidal.setDepth(config.depth);
        }
        if (typeof config.slope === "number") {
          tidal.setSlope(config.slope);
        }
        if (typeof config.symmetry === "number") {
          tidal.setSymmetry(config.symmetry);
        }
        if (typeof config.offset === "number") {
          tidal.setOffset(config.offset);
        }
        if (typeof config.channelOffset === "number") {
          tidal.setChannelOffset(config.channelOffset);
        }
        break;
      }
      case "plateReverb": {
        const reverb = processor as DattorroReverb;
        if (typeof config.preDelay === "number") {
          reverb.setPreDelay(config.preDelay);
        }
        if (typeof config.bandwidth === "number") {
          reverb.setBandwidth(config.bandwidth);
        }
        if (typeof config.inputDiffusion1 === "number") {
          reverb.setInputDiffusion1(config.inputDiffusion1);
        }
        if (typeof config.inputDiffusion2 === "number") {
          reverb.setInputDiffusion2(config.inputDiffusion2);
        }
        if (typeof config.decay === "number") {
          reverb.setDecay(config.decay);
        }
        if (typeof config.decayDiffusion1 === "number") {
          reverb.setDecayDiffusion1(config.decayDiffusion1);
        }
        if (typeof config.decayDiffusion2 === "number") {
          reverb.setDecayDiffusion2(config.decayDiffusion2);
        }
        if (typeof config.damping === "number") {
          reverb.setDamping(config.damping);
        }
        if (typeof config.excursionRate === "number") {
          reverb.setExcursionRate(config.excursionRate);
        }
        if (typeof config.excursionDepth === "number") {
          reverb.setExcursionDepth(config.excursionDepth);
        }
        if (typeof config.wet === "number") {
          reverb.setWet(config.wet);
        }
        if (typeof config.dry === "number") {
          reverb.setDry(config.dry);
        }
        break;
      }
      case "distortion": {
        const dist = processor as Distortion;
        if (typeof config.amount === "number") {
          dist.setAmount(config.amount);
        }
        if (typeof config.oversample === "string") {
          const os = config.oversample;
          if (os === "none" || os === "2x" || os === "4x") {
            dist.setOversample(os);
          }
        }
        break;
      }
      case "compressor": {
        const comp = processor as CTAGCompressor;
        if (typeof config.threshold === "number") {
          comp.setThreshold(config.threshold);
        }
        if (typeof config.ratio === "number") {
          comp.setRatio(config.ratio);
        }
        if (typeof config.attack === "number") {
          comp.setAttack(config.attack);
        }
        if (typeof config.release === "number") {
          comp.setRelease(config.release);
        }
        if (typeof config.knee === "number") {
          comp.setKnee(config.knee);
        }
        if (typeof config.makeup === "number") {
          comp.setMakeup(config.makeup);
        }
        if (typeof config.mix === "number") {
          comp.setMix(config.mix);
        }
        const lookahead = readBooleanConfig(config, "lookahead");
        if (lookahead !== undefined) {
          comp.setLookahead(lookahead);
        }
        const autoAttack = readBooleanConfig(config, "autoAttack");
        if (autoAttack !== undefined) {
          comp.setAutoAttack(autoAttack);
        }
        const autoRelease = readBooleanConfig(config, "autoRelease");
        if (autoRelease !== undefined) {
          comp.setAutoRelease(autoRelease);
        }
        const autoMakeup = readBooleanConfig(config, "autoMakeup");
        if (autoMakeup !== undefined) {
          comp.setAutoMakeup(autoMakeup);
        }
        break;
      }
      case "pitchShifter": {
        const pv = processor as PhaseVocoder;
        if (typeof config.pitchFactor === "number") {
          pv.setPitchFactor(config.pitchFactor);
        }
        break;
      }
      case "limiter": {
        const limiter = processor as Limiter;
        if (typeof config.threshold === "number") {
          limiter.setThreshold(config.threshold);
        }
        break;
      }
      case "revamp": {
        const revamp = processor as RevampEffect;
        const highPassEnabled = readBooleanConfig(config, "highPassEnabled");
        if (highPassEnabled !== undefined) {
          revamp.setHighPassEnabled(highPassEnabled);
        }
        if (typeof config.highPassFrequency === "number") {
          revamp.setHighPassFrequency(config.highPassFrequency);
        }
        if (typeof config.highPassQ === "number") {
          revamp.setHighPassQ(config.highPassQ);
        }
        if (typeof config.highPassOrder === "number") {
          revamp.setHighPassOrder(config.highPassOrder);
        }
        const lowShelfEnabled = readBooleanConfig(config, "lowShelfEnabled");
        if (lowShelfEnabled !== undefined) {
          revamp.setLowShelfEnabled(lowShelfEnabled);
        }
        if (typeof config.lowShelfFrequency === "number") {
          revamp.setLowShelfFrequency(config.lowShelfFrequency);
        }
        if (typeof config.lowShelfGain === "number") {
          revamp.setLowShelfGain(config.lowShelfGain);
        }
        const lowBellEnabled = readBooleanConfig(config, "lowBellEnabled");
        if (lowBellEnabled !== undefined) {
          revamp.setLowBellEnabled(lowBellEnabled);
        }
        if (typeof config.lowBellFrequency === "number") {
          revamp.setLowBellFrequency(config.lowBellFrequency);
        }
        if (typeof config.lowBellGain === "number") {
          revamp.setLowBellGain(config.lowBellGain);
        }
        if (typeof config.lowBellQ === "number") {
          revamp.setLowBellQ(config.lowBellQ);
        }
        const midBellEnabled = readBooleanConfig(config, "midBellEnabled");
        if (midBellEnabled !== undefined) {
          revamp.setMidBellEnabled(midBellEnabled);
        }
        if (typeof config.midBellFrequency === "number") {
          revamp.setMidBellFrequency(config.midBellFrequency);
        }
        if (typeof config.midBellGain === "number") {
          revamp.setMidBellGain(config.midBellGain);
        }
        if (typeof config.midBellQ === "number") {
          revamp.setMidBellQ(config.midBellQ);
        }
        const highBellEnabled = readBooleanConfig(config, "highBellEnabled");
        if (highBellEnabled !== undefined) {
          revamp.setHighBellEnabled(highBellEnabled);
        }
        if (typeof config.highBellFrequency === "number") {
          revamp.setHighBellFrequency(config.highBellFrequency);
        }
        if (typeof config.highBellGain === "number") {
          revamp.setHighBellGain(config.highBellGain);
        }
        if (typeof config.highBellQ === "number") {
          revamp.setHighBellQ(config.highBellQ);
        }
        const highShelfEnabled = readBooleanConfig(config, "highShelfEnabled");
        if (highShelfEnabled !== undefined) {
          revamp.setHighShelfEnabled(highShelfEnabled);
        }
        if (typeof config.highShelfFrequency === "number") {
          revamp.setHighShelfFrequency(config.highShelfFrequency);
        }
        if (typeof config.highShelfGain === "number") {
          revamp.setHighShelfGain(config.highShelfGain);
        }
        const lowPassEnabled = readBooleanConfig(config, "lowPassEnabled");
        if (lowPassEnabled !== undefined) {
          revamp.setLowPassEnabled(lowPassEnabled);
        }
        if (typeof config.lowPassFrequency === "number") {
          revamp.setLowPassFrequency(config.lowPassFrequency);
        }
        if (typeof config.lowPassQ === "number") {
          revamp.setLowPassQ(config.lowPassQ);
        }
        if (typeof config.lowPassOrder === "number") {
          revamp.setLowPassOrder(config.lowPassOrder);
        }
        break;
      }
      case "delay": {
        const delay = processor as Delay;
        if (typeof config.delayTime === "number") {
          delay.setDelayTime(config.delayTime);
        }
        if (typeof config.feedback === "number") {
          delay.setFeedback(config.feedback);
        }
        break;
      }
      default:
        break;
    }
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
    toIndex: number
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

    let current: [Float32Array, Float32Array] = [this.tempL, this.tempR];
    const outputChannels: [Float32Array, Float32Array] = [outputL, outputR];

    for (const filterId of this.filterOrder) {
      const filter = this.filters.get(filterId);
      if (filter) {
        filter.process(current, outputChannels, fromIndex, toIndex);
        current = outputChannels;
      }
    }

    let anyEffectProcessed = false;
    for (const effectId of this.effectOrder) {
      const effect = this.effects.get(effectId);
      const config = this.effectConfigs.get(effectId);
      if (!(effect && config && config.enabled)) {
        continue;
      }

      anyEffectProcessed = true;

      if (config.inputGain !== 1.0) {
        for (let i = fromIndex; i < toIndex; i++) {
          current[0][i] = (current[0][i] ?? 0) * config.inputGain;
          current[1][i] = (current[1][i] ?? 0) * config.inputGain;
        }
      }

      const needsDryMix = config.dryWet < 1.0;
      if (needsDryMix) {
        for (let i = fromIndex; i < toIndex; i++) {
          this.dryL[i] = current[0][i] ?? 0;
          this.dryR[i] = current[1][i] ?? 0;
        }
      }

      effect.process(current, outputChannels, fromIndex, toIndex);
      current = outputChannels;

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

    if (this.filterOrder.length === 0 && !anyEffectProcessed) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = this.tempL[i] ?? 0;
        outputR[i] = this.tempR[i] ?? 0;
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
