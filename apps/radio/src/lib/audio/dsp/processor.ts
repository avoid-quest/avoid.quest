/**
 * DSP Audio Processor
 *
 * AudioWorklet processor for real-time audio effects processing.
 * Receives audio via Web Audio graph connection (from MediaElementSource).
 *
 * NOTE: This file is designed to be bundled separately and loaded as a worklet.
 */

import { LevelMeter, SpectrumAnalyzer } from "./analysis/index.js";
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
 * Message types for worklet communication
 */
export const MessageType = {
  // Source lifecycle
  CREATE_SOURCE: "CREATE_SOURCE",
  REMOVE_SOURCE: "REMOVE_SOURCE",
  START_SOURCE: "START_SOURCE",
  STOP_SOURCE: "STOP_SOURCE",
  PAUSE_SOURCE: "PAUSE_SOURCE",
  RESUME_SOURCE: "RESUME_SOURCE",

  // Volume/Pan
  SET_SOURCE_VOLUME: "SET_SOURCE_VOLUME",
  SET_SOURCE_PAN: "SET_SOURCE_PAN",
  SET_EFFECTS_DRY_WET: "SET_EFFECTS_DRY_WET",
  SET_PARAM: "SET_PARAM",

  // Filters
  ADD_FILTER: "ADD_FILTER",
  REMOVE_FILTER: "REMOVE_FILTER",
  SET_FILTER_PARAM: "SET_FILTER_PARAM",

  // Effects
  ADD_EFFECT: "ADD_EFFECT",
  REMOVE_EFFECT: "REMOVE_EFFECT",
  UPDATE_EFFECT: "UPDATE_EFFECT",
  REORDER_EFFECTS: "REORDER_EFFECTS",

  // Events (worklet → main)
  SOURCE_ENDED: "SOURCE_ENDED",
  SOURCE_ERROR: "SOURCE_ERROR",
  STREAM_READY: "STREAM_READY",

  // Analysis (worklet → main)
  ANALYSIS_DATA: "ANALYSIS_DATA",
  PEAK_METER: "PEAK_METER",

  // Analysis control (main → worklet)
  ENABLE_ANALYSIS: "ENABLE_ANALYSIS",
} as const;

/**
 * Analysis data payload sent from worklet to main thread
 */
export type AnalysisData = {
  levels: {
    left: number;
    right: number;
    mono: number;
    peak: number;
  };
  spectrum: Float32Array;
  waveform: Float32Array;
};

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/**
 * Channel strip for volume and panning with smoothing
 */
class ChannelStrip {
  volume = 1.0;
  pan = 0.0;
  private targetLeftGain = 1.0;
  private targetRightGain = 1.0;
  private currentLeftGain = 1.0;
  private currentRightGain = 1.0;

  // Volume smoothing coefficient
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
    // Equal power panning
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
      // Smooth gain changes per-sample to avoid clicks
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

/**
 * Stored effect configuration for universal params
 */
type EffectConfigData = {
  enabled: boolean;
  inputGain: number;
  outputGain: number;
  dryWet: number;
};

/**
 * Effect source - tracks effects and filters for a source
 * Audio comes from Web Audio graph, not from chunks
 */
class EffectSource {
  readonly id: string;
  private readonly sampleRate: number;

  // Per-source volume and pan with smoothing
  volume = 1.0;
  pan = 0.0;
  private targetLeftGain = 1.0;
  private targetRightGain = 1.0;
  private currentLeftGain = 1.0;
  private currentRightGain = 1.0;

  // Volume smoothing coefficient
  private static readonly GAIN_SMOOTH_COEFF = 0.1;

  // Filters and effects
  private readonly filters = new Map<string, BiquadFilter>();
  private filterOrder: string[] = [];
  private readonly effects = new Map<string, EffectProcessor>();
  private effectOrder: string[] = [];
  private readonly effectTypes = new Map<string, EffectType>();
  private readonly effectConfigs = new Map<string, EffectConfigData>();

  // Temp buffers for processing
  private readonly tempL: Float32Array;
  private readonly tempR: Float32Array;
  private readonly dryL: Float32Array;
  private readonly dryR: Float32Array;
  // Original unprocessed input for master dry/wet mixing
  private readonly originalL: Float32Array;
  private readonly originalR: Float32Array;

  // State
  private playing = false;
  private paused = false;

  // Master effects dry/wet (0 = bypass all, 1 = full effects)
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

  // Filter management
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

  // Effect management
  addEffect(
    effectId: string,
    type: EffectType,
    config: Record<string, number | boolean>,
    order: number
  ): void {
    const processor = this.createEffectProcessor(type);
    if (!processor) {
      return;
    }

    this.applyEffectConfig(processor, type, config);
    this.effects.set(effectId, processor);
    this.effectTypes.set(effectId, type);

    // Store universal params (enabled, inputGain, outputGain, dryWet)
    // Note: enabled comes as 0/1 number from audio-manager, convert to boolean
    this.effectConfigs.set(effectId, {
      enabled: !!config.enabled,
      inputGain: typeof config.inputGain === "number" ? config.inputGain : 1.0,
      outputGain:
        typeof config.outputGain === "number" ? config.outputGain : 1.0,
      dryWet: typeof config.dryWet === "number" ? config.dryWet : 1.0,
    });

    // Insert at correct order position
    this.insertEffectAtOrder(effectId, order);
  }

  removeEffect(effectId: string): void {
    this.effects.delete(effectId);
    this.effectTypes.delete(effectId);
    this.effectConfigs.delete(effectId);
    this.effectOrder = this.effectOrder.filter((id) => id !== effectId);
  }

  updateEffect(
    effectId: string,
    config: Record<string, number | boolean>
  ): void {
    const processor = this.effects.get(effectId);
    const type = this.effectTypes.get(effectId);
    if (!(processor && type)) {
      return;
    }

    this.applyEffectConfig(processor, type, config);

    // Update universal params if provided
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
        return new PhaseVocoder(this.sampleRate);
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
    config: Record<string, number | boolean>
  ): void {
    // Type-specific configuration
    switch (type) {
      case "crusher": {
        const crusher = processor as CrusherEffect;
        if (config.crush !== undefined) {
          crusher.setCrush(config.crush as number);
        }
        if (config.bitDepth !== undefined) {
          crusher.setBitDepth(config.bitDepth as number);
        }
        if (config.boost !== undefined) {
          crusher.setBoost(config.boost as number);
        }
        if (config.autoGain !== undefined) {
          crusher.setAutoGain(config.autoGain as boolean);
        }
        break;
      }
      case "fold": {
        const fold = processor as FoldEffect;
        if (config.amount !== undefined) {
          fold.setAmount(config.amount as number);
        }
        if (config.volume !== undefined) {
          fold.setVolume(config.volume as number);
        }
        if (config.oversample !== undefined) {
          fold.setOversample(config.oversample as 2 | 4 | 8);
        }
        if (config.autoGain !== undefined) {
          fold.setAutoGain(config.autoGain as boolean);
        }
        break;
      }
      case "stereoTool": {
        const stereo = processor as StereoToolEffect;
        if (config.volume !== undefined) {
          stereo.setVolume(config.volume as number);
        }
        if (config.stereo !== undefined) {
          stereo.setStereoWidth(config.stereo as number);
        }
        if (config.invertL !== undefined) {
          stereo.setInvertL(config.invertL as boolean);
        }
        if (config.invertR !== undefined) {
          stereo.setInvertR(config.invertR as boolean);
        }
        if (config.swap !== undefined) {
          stereo.setSwap(config.swap as boolean);
        }
        break;
      }
      case "tidal": {
        const tidal = processor as TidalEffect;
        if (config.rate !== undefined) {
          tidal.setRate(config.rate as number);
        }
        if (config.depth !== undefined) {
          tidal.setDepth(config.depth as number);
        }
        if (config.slope !== undefined) {
          tidal.setSlope(config.slope as number);
        }
        if (config.symmetry !== undefined) {
          tidal.setSymmetry(config.symmetry as number);
        }
        if (config.offset !== undefined) {
          tidal.setOffset(config.offset as number);
        }
        if (config.channelOffset !== undefined) {
          tidal.setChannelOffset(config.channelOffset as number);
        }
        break;
      }
      case "plateReverb": {
        const reverb = processor as DattorroReverb;
        if (config.preDelay !== undefined) {
          reverb.setPreDelay(config.preDelay as number);
        }
        if (config.bandwidth !== undefined) {
          reverb.setBandwidth(config.bandwidth as number);
        }
        if (config.inputDiffusion1 !== undefined) {
          reverb.setInputDiffusion1(config.inputDiffusion1 as number);
        }
        if (config.inputDiffusion2 !== undefined) {
          reverb.setInputDiffusion2(config.inputDiffusion2 as number);
        }
        if (config.decay !== undefined) {
          reverb.setDecay(config.decay as number);
        }
        if (config.decayDiffusion1 !== undefined) {
          reverb.setDecayDiffusion1(config.decayDiffusion1 as number);
        }
        if (config.decayDiffusion2 !== undefined) {
          reverb.setDecayDiffusion2(config.decayDiffusion2 as number);
        }
        if (config.damping !== undefined) {
          reverb.setDamping(config.damping as number);
        }
        if (config.excursionRate !== undefined) {
          reverb.setExcursionRate(config.excursionRate as number);
        }
        if (config.excursionDepth !== undefined) {
          reverb.setExcursionDepth(config.excursionDepth as number);
        }
        if (config.wet !== undefined) {
          reverb.setWet(config.wet as number);
        }
        if (config.dry !== undefined) {
          reverb.setDry(config.dry as number);
        }
        break;
      }
      case "distortion": {
        const dist = processor as Distortion;
        if (config.amount !== undefined) {
          // Distortion.setAmount handles 0-100 to 0-1 conversion internally
          dist.setAmount(config.amount as number);
        }
        break;
      }
      case "compressor": {
        const comp = processor as CTAGCompressor;
        if (config.threshold !== undefined) {
          comp.setThreshold(config.threshold as number);
        }
        if (config.ratio !== undefined) {
          comp.setRatio(config.ratio as number);
        }
        if (config.attack !== undefined) {
          // Attack is in ms in registry
          comp.setAttack(config.attack as number);
        }
        if (config.release !== undefined) {
          // Release is in ms in registry
          comp.setRelease(config.release as number);
        }
        if (config.knee !== undefined) {
          comp.setKnee(config.knee as number);
        }
        if (config.makeup !== undefined) {
          comp.setMakeup(config.makeup as number);
        }
        if (config.mix !== undefined) {
          comp.setMix(config.mix as number);
        }
        if (config.lookahead !== undefined) {
          comp.setLookahead(config.lookahead as boolean);
        }
        if (config.autoAttack !== undefined) {
          comp.setAutoAttack(config.autoAttack as boolean);
        }
        if (config.autoRelease !== undefined) {
          comp.setAutoRelease(config.autoRelease as boolean);
        }
        if (config.autoMakeup !== undefined) {
          comp.setAutoMakeup(config.autoMakeup as boolean);
        }
        break;
      }
      case "pitchShifter": {
        const pv = processor as PhaseVocoder;
        if (config.pitchFactor !== undefined) {
          pv.setPitchFactor(config.pitchFactor as number);
        }
        break;
      }
      case "limiter": {
        const limiter = processor as Limiter;
        if (config.threshold !== undefined) {
          limiter.setThreshold(config.threshold as number);
        }
        break;
      }
      case "revamp": {
        const revamp = processor as RevampEffect;
        // Highpass
        if (config.highPassEnabled !== undefined) {
          revamp.setHighPassEnabled(!!config.highPassEnabled);
        }
        if (config.highPassFrequency !== undefined) {
          revamp.setHighPassFrequency(config.highPassFrequency as number);
        }
        if (config.highPassQ !== undefined) {
          revamp.setHighPassQ(config.highPassQ as number);
        }
        if (config.highPassOrder !== undefined) {
          revamp.setHighPassOrder(config.highPassOrder as number);
        }
        // Low shelf
        if (config.lowShelfEnabled !== undefined) {
          revamp.setLowShelfEnabled(!!config.lowShelfEnabled);
        }
        if (config.lowShelfFrequency !== undefined) {
          revamp.setLowShelfFrequency(config.lowShelfFrequency as number);
        }
        if (config.lowShelfGain !== undefined) {
          revamp.setLowShelfGain(config.lowShelfGain as number);
        }
        // Low bell
        if (config.lowBellEnabled !== undefined) {
          revamp.setLowBellEnabled(!!config.lowBellEnabled);
        }
        if (config.lowBellFrequency !== undefined) {
          revamp.setLowBellFrequency(config.lowBellFrequency as number);
        }
        if (config.lowBellGain !== undefined) {
          revamp.setLowBellGain(config.lowBellGain as number);
        }
        if (config.lowBellQ !== undefined) {
          revamp.setLowBellQ(config.lowBellQ as number);
        }
        // Mid bell
        if (config.midBellEnabled !== undefined) {
          revamp.setMidBellEnabled(!!config.midBellEnabled);
        }
        if (config.midBellFrequency !== undefined) {
          revamp.setMidBellFrequency(config.midBellFrequency as number);
        }
        if (config.midBellGain !== undefined) {
          revamp.setMidBellGain(config.midBellGain as number);
        }
        if (config.midBellQ !== undefined) {
          revamp.setMidBellQ(config.midBellQ as number);
        }
        // High bell
        if (config.highBellEnabled !== undefined) {
          revamp.setHighBellEnabled(!!config.highBellEnabled);
        }
        if (config.highBellFrequency !== undefined) {
          revamp.setHighBellFrequency(config.highBellFrequency as number);
        }
        if (config.highBellGain !== undefined) {
          revamp.setHighBellGain(config.highBellGain as number);
        }
        if (config.highBellQ !== undefined) {
          revamp.setHighBellQ(config.highBellQ as number);
        }
        // High shelf
        if (config.highShelfEnabled !== undefined) {
          revamp.setHighShelfEnabled(!!config.highShelfEnabled);
        }
        if (config.highShelfFrequency !== undefined) {
          revamp.setHighShelfFrequency(config.highShelfFrequency as number);
        }
        if (config.highShelfGain !== undefined) {
          revamp.setHighShelfGain(config.highShelfGain as number);
        }
        // Lowpass
        if (config.lowPassEnabled !== undefined) {
          revamp.setLowPassEnabled(!!config.lowPassEnabled);
        }
        if (config.lowPassFrequency !== undefined) {
          revamp.setLowPassFrequency(config.lowPassFrequency as number);
        }
        if (config.lowPassQ !== undefined) {
          revamp.setLowPassQ(config.lowPassQ as number);
        }
        if (config.lowPassOrder !== undefined) {
          revamp.setLowPassOrder(config.lowPassOrder as number);
        }
        break;
      }
      case "delay": {
        const delay = processor as Delay;
        if (config.delayTime !== undefined) {
          delay.setDelayTime(config.delayTime as number);
        }
        if (config.feedback !== undefined) {
          delay.setFeedback(config.feedback as number);
        }
        break;
      }
      default:
        break;
    }
  }

  private insertEffectAtOrder(effectId: string, _order: number): void {
    // For now, just append (proper ordering would require tracking order numbers)
    this.effectOrder.push(effectId);
  }

  private resetEffects(): void {
    for (const filter of this.filters.values()) {
      filter.reset();
    }
    for (const effect of this.effects.values()) {
      effect.reset();
    }
  }

  /**
   * Process input audio through filters and effects
   * Audio comes from Web Audio graph input, not from chunks
   */
  process(
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: number,
    toIndex: number
  ): void {
    // If paused, output silence
    if (this.paused) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = 0;
        outputR[i] = 0;
      }
      return;
    }

    // Store original unprocessed input for master dry/wet mixing
    for (let i = fromIndex; i < toIndex; i++) {
      this.originalL[i] = inputL[i] ?? 0;
      this.originalR[i] = inputR[i] ?? 0;
    }

    // Copy input to temp buffers
    for (let i = fromIndex; i < toIndex; i++) {
      this.tempL[i] = inputL[i] ?? 0;
      this.tempR[i] = inputR[i] ?? 0;
    }

    // Apply filters
    let current: [Float32Array, Float32Array] = [this.tempL, this.tempR];
    const outputChannels: [Float32Array, Float32Array] = [outputL, outputR];

    for (const filterId of this.filterOrder) {
      const filter = this.filters.get(filterId);
      if (filter) {
        filter.process(current, outputChannels, fromIndex, toIndex);
        current = outputChannels;
      }
    }

    // Apply effects with universal params (enabled, inputGain, outputGain, dryWet)
    let anyEffectProcessed = false;
    for (const effectId of this.effectOrder) {
      const effect = this.effects.get(effectId);
      const config = this.effectConfigs.get(effectId);

      if (!(effect && config)) {
        continue;
      }

      // Skip disabled effects
      if (!config.enabled) {
        continue;
      }

      anyEffectProcessed = true;

      // Apply input gain
      const inputGain = config.inputGain;
      if (inputGain !== 1.0) {
        for (let i = fromIndex; i < toIndex; i++) {
          current[0][i] = (current[0][i] ?? 0) * inputGain;
          current[1][i] = (current[1][i] ?? 0) * inputGain;
        }
      }

      // Store dry signal for dry/wet mixing
      const dryWet = config.dryWet;
      const needsDryMix = dryWet < 1.0;
      if (needsDryMix) {
        for (let i = fromIndex; i < toIndex; i++) {
          this.dryL[i] = current[0][i] ?? 0;
          this.dryR[i] = current[1][i] ?? 0;
        }
      }

      // Process through effect (wet signal)
      effect.process(current, outputChannels, fromIndex, toIndex);
      current = outputChannels;

      // Mix dry/wet
      if (needsDryMix) {
        const dry = 1.0 - dryWet;
        for (let i = fromIndex; i < toIndex; i++) {
          current[0][i] =
            (this.dryL[i] ?? 0) * dry + (current[0][i] ?? 0) * dryWet;
          current[1][i] =
            (this.dryR[i] ?? 0) * dry + (current[1][i] ?? 0) * dryWet;
        }
      }

      // Apply output gain
      const outputGain = config.outputGain;
      if (outputGain !== 1.0) {
        for (let i = fromIndex; i < toIndex; i++) {
          current[0][i] = (current[0][i] ?? 0) * outputGain;
          current[1][i] = (current[1][i] ?? 0) * outputGain;
        }
      }
    }

    // If no filters or effects actually processed, copy current signal to output
    // This handles: no effects at all, OR all effects disabled (bypass)
    if (this.filterOrder.length === 0 && !anyEffectProcessed) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = this.tempL[i] ?? 0;
        outputR[i] = this.tempR[i] ?? 0;
      }
    }

    // Apply master effects dry/wet (mix original input with processed output)
    if (this.masterEffectsDryWet < 1.0 && this.effectOrder.length > 0) {
      const wet = this.masterEffectsDryWet;
      const dry = 1.0 - wet;
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = (this.originalL[i] ?? 0) * dry + (outputL[i] ?? 0) * wet;
        outputR[i] = (this.originalR[i] ?? 0) * dry + (outputR[i] ?? 0) * wet;
      }
    }

    // Apply volume/pan with per-sample smoothing to avoid clicks
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

/**
 * Main DSP Processor for AudioWorklet
 *
 * Receives audio from Web Audio graph and processes through effect chains.
 */
export class DSPProcessor {
  private readonly sources = new Map<string, EffectSource>();
  private readonly channelStrip = new ChannelStrip();
  private readonly masterLimiter: Limiter;
  private readonly sampleRate: number;

  // Pre-allocated temp buffers for mixing
  private readonly mixTempL = new Float32Array(128);
  private readonly mixTempR = new Float32Array(128);

  // Analysis components (lazily initialized)
  private levelMeter: LevelMeter | null = null;
  private spectrumAnalyzer: SpectrumAnalyzer | null = null;
  private analysisEnabled = false;
  private analysisFrameCounter = 0;
  private readonly analysisInterval = 3; // Send every N render quanta (~60fps)

  // Peak meter (always active, independent of analysis)
  private meterCounter = 0;
  private readonly meterInterval = 3; // Send every N render quanta (~60fps)

  // Callback for emitting events to main thread
  private onMessage?: (message: { type: string; payload?: unknown }) => void;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.masterLimiter = new Limiter(sampleRate);
  }

  /**
   * Enable or disable analysis (spectrum + levels)
   */
  setAnalysisEnabled(enabled: boolean): void {
    this.analysisEnabled = enabled;
    if (enabled && !this.levelMeter) {
      // Lazy init to avoid overhead when not needed
      this.levelMeter = new LevelMeter(2048, 0.95);
      this.spectrumAnalyzer = new SpectrumAnalyzer(512);
    }
  }

  /**
   * Set callback for emitting messages
   */
  setMessageCallback(
    callback: (message: { type: string; payload?: unknown }) => void
  ): void {
    this.onMessage = callback;
  }

  /**
   * Handle incoming message
   */
  handleMessage(message: { type: string; payload?: unknown }): void {
    const { type, payload } = message;

    switch (type) {
      case MessageType.CREATE_SOURCE:
        this.createSource((payload as { id: string }).id);
        break;

      case MessageType.REMOVE_SOURCE:
        this.removeSource((payload as { sourceId: string }).sourceId);
        break;

      case MessageType.START_SOURCE:
        this.startSource((payload as { sourceId: string }).sourceId);
        break;

      case MessageType.STOP_SOURCE:
        this.stopSource((payload as { sourceId: string }).sourceId);
        break;

      case MessageType.PAUSE_SOURCE:
        this.pauseSource((payload as { sourceId: string }).sourceId);
        break;

      case MessageType.RESUME_SOURCE:
        this.resumeSource((payload as { sourceId: string }).sourceId);
        break;

      case MessageType.SET_SOURCE_VOLUME: {
        const { sourceId, volume } = payload as {
          sourceId: string;
          volume: number;
        };
        this.setSourceVolume(sourceId, volume);
        break;
      }

      case MessageType.SET_SOURCE_PAN: {
        const { sourceId, pan } = payload as { sourceId: string; pan: number };
        this.setSourcePan(sourceId, pan);
        break;
      }

      case MessageType.SET_EFFECTS_DRY_WET: {
        const { sourceId, dryWet } = payload as {
          sourceId: string;
          dryWet: number;
        };
        this.setEffectsDryWet(sourceId, dryWet);
        break;
      }

      case MessageType.SET_PARAM: {
        const { target, value } = payload as { target: string; value: number };
        this.setParam(target, value);
        break;
      }

      case MessageType.ADD_FILTER: {
        const { sourceId, filterId, type, frequency, Q, gain } = payload as {
          sourceId: string;
          filterId: string;
          type: BiquadFilterType;
          frequency: number;
          Q: number;
          gain: number;
        };
        this.addFilter(sourceId, filterId, type, frequency, Q, gain);
        break;
      }

      case MessageType.REMOVE_FILTER: {
        const { sourceId, filterId } = payload as {
          sourceId: string;
          filterId: string;
        };
        this.removeFilter(sourceId, filterId);
        break;
      }

      case MessageType.SET_FILTER_PARAM: {
        const { sourceId, filterId, param, value } = payload as {
          sourceId: string;
          filterId: string;
          param: "frequency" | "Q" | "gain" | "type";
          value: number | string;
        };
        this.setFilterParam(sourceId, filterId, param, value);
        break;
      }

      case MessageType.ADD_EFFECT: {
        const { sourceId, effectId, type, config, order } = payload as {
          sourceId: string;
          effectId: string;
          type: EffectType;
          config: Record<string, number | boolean>;
          order: number;
        };
        this.addEffect(sourceId, effectId, type, config, order);
        break;
      }

      case MessageType.REMOVE_EFFECT: {
        const { sourceId, effectId } = payload as {
          sourceId: string;
          effectId: string;
        };
        this.removeEffect(sourceId, effectId);
        break;
      }

      case MessageType.UPDATE_EFFECT: {
        const { sourceId, effectId, config } = payload as {
          sourceId: string;
          effectId: string;
          config: Record<string, number | boolean>;
        };
        this.updateEffect(sourceId, effectId, config);
        break;
      }

      case MessageType.REORDER_EFFECTS: {
        const { sourceId, effectIds } = payload as {
          sourceId: string;
          effectIds: string[];
        };
        this.reorderEffects(sourceId, effectIds);
        break;
      }

      case MessageType.ENABLE_ANALYSIS: {
        const { enabled } = payload as { enabled: boolean };
        this.setAnalysisEnabled(enabled);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Process audio from Web Audio graph input
   *
   * Audio comes in via inputs parameter, not via postMessage chunks.
   */
  process(
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: number,
    toIndex: number
  ): void {
    // Use pre-allocated temp buffers
    const tempL = this.mixTempL;
    const tempR = this.mixTempR;

    // Copy input to temp for processing
    for (let i = fromIndex; i < toIndex; i++) {
      tempL[i] = inputL[i] ?? 0;
      tempR[i] = inputR[i] ?? 0;
    }

    // Clear output first
    for (let i = fromIndex; i < toIndex; i++) {
      outputL[i] = 0;
      outputR[i] = 0;
    }

    // Process through all active sources (apply effects)
    // In the new architecture, all sources receive the same input
    // but can have different effects chains
    let hasActiveSource = false;
    for (const source of this.sources.values()) {
      if (source.isPlaying) {
        hasActiveSource = true;
        // Process effects for this source
        source.process(tempL, tempR, outputL, outputR, fromIndex, toIndex);
      }
    }

    // If no active sources with effects, pass through input directly
    if (!hasActiveSource) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = tempL[i] ?? 0;
        outputR[i] = tempR[i] ?? 0;
      }
    }

    // Apply channel strip
    this.channelStrip.apply(
      outputL,
      outputR,
      outputL,
      outputR,
      fromIndex,
      toIndex
    );

    // Apply master limiter as final protection
    const outputChannels: [Float32Array, Float32Array] = [outputL, outputR];
    this.masterLimiter.process(
      outputChannels,
      outputChannels,
      fromIndex,
      toIndex
    );

    // Emit peak meter data (always active, throttled to ~60fps)
    this.meterCounter++;
    if (this.meterCounter >= this.meterInterval) {
      this.meterCounter = 0;
      let peakL = 0;
      let peakR = 0;
      for (let i = fromIndex; i < toIndex; i++) {
        peakL = Math.max(peakL, Math.abs(outputL[i] ?? 0));
        peakR = Math.max(peakR, Math.abs(outputR[i] ?? 0));
      }
      this.emitMessage(MessageType.PEAK_METER, { peakL, peakR });
    }

    // Run analysis if enabled (throttled)
    if (this.analysisEnabled && this.levelMeter && this.spectrumAnalyzer) {
      this.analysisFrameCounter++;
      if (this.analysisFrameCounter >= this.analysisInterval) {
        this.analysisFrameCounter = 0;

        // Process level meter
        const levels = this.levelMeter.process(
          outputL,
          outputR,
          fromIndex,
          toIndex
        );

        // Process spectrum analyzer
        this.spectrumAnalyzer.process(outputL, outputR, fromIndex, toIndex);

        // Emit analysis data
        this.emitMessage(MessageType.ANALYSIS_DATA, {
          levels,
          spectrum: this.spectrumAnalyzer.getBins(),
          waveform: this.spectrumAnalyzer.getWaveform(),
        } satisfies AnalysisData);
      }
    }
  }

  // Source management
  private createSource(id: string): void {
    const source = new EffectSource(id, this.sampleRate);
    this.sources.set(id, source);
    // Source is immediately ready since audio comes from graph
    this.emitMessage(MessageType.STREAM_READY, { sourceId: id });
  }

  private removeSource(sourceId: string): void {
    this.sources.delete(sourceId);
  }

  private startSource(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.start();
    }
  }

  private stopSource(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.stop();
      this.emitMessage(MessageType.SOURCE_ENDED, {
        sourceId,
        reason: "stopped",
      });
    }
  }

  private pauseSource(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.pause();
    }
  }

  private resumeSource(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.resume();
    }
  }

  private setSourceVolume(sourceId: string, volume: number): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.setVolume(volume);
    }
  }

  private setSourcePan(sourceId: string, pan: number): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.setPan(pan);
    }
  }

  private setEffectsDryWet(sourceId: string, dryWet: number): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.setEffectsDryWet(dryWet);
    }
  }

  private setParam(target: string, value: number): void {
    if (target === "channelStrip.volume") {
      this.channelStrip.setVolume(value);
    } else if (target === "channelStrip.pan") {
      this.channelStrip.setPan(value);
    }
  }

  // Filter management
  private addFilter(
    sourceId: string,
    filterId: string,
    type: BiquadFilterType,
    frequency: number,
    Q: number,
    gain: number
  ): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.addFilter(filterId, type, frequency, Q, gain);
    }
  }

  private removeFilter(sourceId: string, filterId: string): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.removeFilter(filterId);
    }
  }

  private setFilterParam(
    sourceId: string,
    filterId: string,
    param: "frequency" | "Q" | "gain" | "type",
    value: number | string
  ): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.setFilterParam(filterId, param, value);
    }
  }

  // Effect management
  private addEffect(
    sourceId: string,
    effectId: string,
    type: EffectType,
    config: Record<string, number | boolean>,
    order: number
  ): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.addEffect(effectId, type, config, order);
    }
  }

  private removeEffect(sourceId: string, effectId: string): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.removeEffect(effectId);
    }
  }

  private updateEffect(
    sourceId: string,
    effectId: string,
    config: Record<string, number | boolean>
  ): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.updateEffect(effectId, config);
    }
  }

  private reorderEffects(sourceId: string, effectIds: string[]): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.reorderEffects(effectIds);
    }
  }

  private emitMessage(type: string, payload?: unknown): void {
    if (this.onMessage) {
      this.onMessage({ type, payload });
    }
  }
}
