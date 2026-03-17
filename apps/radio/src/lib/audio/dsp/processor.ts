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
import {
  PhaseVocoder,
  VarispeedEffect,
  WsolaPitchShifter,
} from "./effects/phase-vocoder.js";
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
 * Error codes for worklet errors
 */
export type WorkletErrorCode =
  | "EFFECT_INIT_FAILED"
  | "EFFECT_PROCESS_FAILED"
  | "SOURCE_NOT_FOUND"
  | "UNKNOWN_ERROR";

/**
 * Generate a unique error ID (worklet-compatible)
 */
function generateWorkletErrorId(): string {
  return `werr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

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
  order: number;
  // pitchShifter-specific
  variant?: "varispeed" | "wsola" | "phaseVocoder";
  pitchFactor?: number;
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
  /**
   * Add an effect to the source
   * @returns true if effect was added successfully, false if creation failed
   */
  addEffect(
    effectId: string,
    type: EffectType,
    config: Record<string, number | boolean | string>,
    order: number
  ): boolean {
    let processor: EffectProcessor | null;
    if (type === "pitchShifter") {
      processor = this.createPitchShifterVariant(config.variant);
    } else {
      processor = this.createEffectProcessor(type);
    }

    if (!processor) {
      return false;
    }

    this.applyEffectConfig(processor, type, config);
    this.effects.set(effectId, processor);
    this.effectTypes.set(effectId, type);

    // Store universal params (enabled, inputGain, outputGain, dryWet, order)
    // Note: enabled comes as 0/1 number from audio-manager, convert to boolean
    const effectConfig: any = {
      enabled: !!config.enabled,
      inputGain: typeof config.inputGain === "number" ? config.inputGain : 1.0,
      outputGain:
        typeof config.outputGain === "number" ? config.outputGain : 1.0,
      dryWet: typeof config.dryWet === "number" ? config.dryWet : 1.0,
      order,
    };

    // Store pitch shifter specific params
    if (type === "pitchShifter") {
      effectConfig.variant =
        typeof config.variant === "string"
          ? (config.variant as "varispeed" | "wsola" | "phaseVocoder")
          : "wsola";
      effectConfig.pitchFactor =
        typeof config.pitchFactor === "number" ? config.pitchFactor : 1.0;
    }

    this.effectConfigs.set(effectId, effectConfig);

    // Insert at correct order position
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
    let processor = this.effects.get(effectId);
    const type = this.effectTypes.get(effectId);
    if (!(processor && type)) {
      return;
    }

    // Handle variant change for pitch shifter
    if (type === "pitchShifter") {
      const existingConfig = this.effectConfigs.get(effectId);
      const currentVariant =
        existingConfig && typeof existingConfig.variant === "string"
          ? existingConfig.variant
          : "wsola";
      const newVariant = (
        typeof config.variant === "string" ? config.variant : currentVariant
      ) as "varispeed" | "wsola" | "phaseVocoder";

      if (newVariant !== currentVariant) {
        // Variant changed, recreate processor and reapply full cached state
        const newProcessor = this.createPitchShifterVariant(newVariant);
        if (newProcessor) {
          processor = newProcessor;
          this.effects.set(effectId, processor);

          const mergedConfig: Record<string, number | boolean | string> = {
            ...(existingConfig
              ? {
                  enabled: existingConfig.enabled,
                  inputGain: existingConfig.inputGain,
                  outputGain: existingConfig.outputGain,
                  dryWet: existingConfig.dryWet,
                  variant: newVariant,
                  pitchFactor: existingConfig.pitchFactor ?? 1.0,
                }
              : {}),
            ...config,
          };

          this.applyEffectConfig(processor, type, mergedConfig);

          if (existingConfig) {
            existingConfig.variant = newVariant;
          }
        }
      }
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
      // Update pitch shifter specific params
      if (type === "pitchShifter") {
        if (typeof config.variant === "string") {
          existingConfig.variant = config.variant as
            | "varispeed"
            | "wsola"
            | "phaseVocoder";
        }
        if (typeof config.pitchFactor === "number") {
          existingConfig.pitchFactor = config.pitchFactor;
        }
      }
    }
  }

  reorderEffects(effectIds: string[]): void {
    this.effectOrder = effectIds.filter((id) => this.effects.has(id));
  }

  private createPitchShifterVariant(
    variant?: string | number | boolean
  ): EffectProcessor {
    const variantStr = typeof variant === "string" ? variant : "wsola";
    switch (variantStr) {
      case "varispeed":
        return new VarispeedEffect();
      case "phaseVocoder":
        return new PhaseVocoder();
      case "wsola":
      default:
        return new WsolaPitchShifter();
    }
  }

  private createEffectProcessor(type: EffectType): EffectProcessor | null {
    switch (type) {
      case "plateReverb":
        return new DattorroReverb(this.sampleRate);
      case "pitchShifter":
        return this.createPitchShifterVariant("wsola");
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
    // Type-specific configuration with typeof guards
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
        if (typeof config.autoGain === "boolean") {
          crusher.setAutoGain(config.autoGain);
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
        if (typeof config.autoGain === "boolean") {
          fold.setAutoGain(config.autoGain);
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
        if (typeof config.invertL === "boolean") {
          stereo.setInvertL(config.invertL);
        }
        if (typeof config.invertR === "boolean") {
          stereo.setInvertR(config.invertR);
        }
        if (typeof config.swap === "boolean") {
          stereo.setSwap(config.swap);
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
        if (typeof config.lookahead === "boolean") {
          comp.setLookahead(config.lookahead);
        }
        if (typeof config.autoAttack === "boolean") {
          comp.setAutoAttack(config.autoAttack);
        }
        if (typeof config.autoRelease === "boolean") {
          comp.setAutoRelease(config.autoRelease);
        }
        if (typeof config.autoMakeup === "boolean") {
          comp.setAutoMakeup(config.autoMakeup);
        }
        break;
      }
      case "pitchShifter": {
        if (typeof config.pitchFactor === "number") {
          (processor as VarispeedEffect).setPitchFactor(config.pitchFactor);
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
        // Highpass
        if (typeof config.highPassEnabled === "boolean") {
          revamp.setHighPassEnabled(config.highPassEnabled);
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
        // Low shelf
        if (typeof config.lowShelfEnabled === "boolean") {
          revamp.setLowShelfEnabled(config.lowShelfEnabled);
        }
        if (typeof config.lowShelfFrequency === "number") {
          revamp.setLowShelfFrequency(config.lowShelfFrequency);
        }
        if (typeof config.lowShelfGain === "number") {
          revamp.setLowShelfGain(config.lowShelfGain);
        }
        // Low bell
        if (typeof config.lowBellEnabled === "boolean") {
          revamp.setLowBellEnabled(config.lowBellEnabled);
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
        // Mid bell
        if (typeof config.midBellEnabled === "boolean") {
          revamp.setMidBellEnabled(config.midBellEnabled);
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
        // High bell
        if (typeof config.highBellEnabled === "boolean") {
          revamp.setHighBellEnabled(config.highBellEnabled);
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
        // High shelf
        if (typeof config.highShelfEnabled === "boolean") {
          revamp.setHighShelfEnabled(config.highShelfEnabled);
        }
        if (typeof config.highShelfFrequency === "number") {
          revamp.setHighShelfFrequency(config.highShelfFrequency);
        }
        if (typeof config.highShelfGain === "number") {
          revamp.setHighShelfGain(config.highShelfGain);
        }
        // Lowpass
        if (typeof config.lowPassEnabled === "boolean") {
          revamp.setLowPassEnabled(config.lowPassEnabled);
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
    // Find the correct position based on order number
    // Effects with lower order values come first in the chain
    const insertIndex = this.effectOrder.findIndex((existingId) => {
      const existingConfig = this.effectConfigs.get(existingId);
      // Insert before any effect with higher order, or at end if none found
      return existingConfig !== undefined && existingConfig.order > order;
    });

    if (insertIndex === -1) {
      // No effect with higher order found, append at end
      this.effectOrder.push(effectId);
    } else {
      // Insert at the found position
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
  private readonly meterInterval = 6; // Send every N render quanta (~30fps)

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
          config: Record<string, number | boolean | string>;
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
          config: Record<string, number | boolean | string>;
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
        // Log unknown message types for debugging version mismatches
        // Note: console.warn in AudioWorklet goes to browser console
        console.warn(`[DSPProcessor] Unknown message type: ${type}`);
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
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot start: source ${sourceId} not found`
      );
      return;
    }
    source.start();
  }

  private stopSource(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot stop: source ${sourceId} not found`
      );
      return;
    }
    source.stop();
    this.emitMessage(MessageType.SOURCE_ENDED, {
      sourceId,
      reason: "stopped",
    });
  }

  private pauseSource(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot pause: source ${sourceId} not found`
      );
      return;
    }
    source.pause();
  }

  private resumeSource(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot resume: source ${sourceId} not found`
      );
      return;
    }
    source.resume();
  }

  private setSourceVolume(sourceId: string, volume: number): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot set volume: source ${sourceId} not found`
      );
      return;
    }
    source.setVolume(volume);
  }

  private setSourcePan(sourceId: string, pan: number): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot set pan: source ${sourceId} not found`
      );
      return;
    }
    source.setPan(pan);
  }

  private setEffectsDryWet(sourceId: string, dryWet: number): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot set effects dry/wet: source ${sourceId} not found`
      );
      return;
    }
    source.setEffectsDryWet(dryWet);
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
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot add filter: source ${sourceId} not found`
      );
      return;
    }
    source.addFilter(filterId, type, frequency, Q, gain);
  }

  private removeFilter(sourceId: string, filterId: string): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot remove filter: source ${sourceId} not found`
      );
      return;
    }
    source.removeFilter(filterId);
  }

  private setFilterParam(
    sourceId: string,
    filterId: string,
    param: "frequency" | "Q" | "gain" | "type",
    value: number | string
  ): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot set filter param: source ${sourceId} not found`
      );
      return;
    }
    source.setFilterParam(filterId, param, value);
  }

  // Effect management
  private addEffect(
    sourceId: string,
    effectId: string,
    type: EffectType,
    config: Record<string, number | boolean | string>,
    order: number
  ): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Source ${sourceId} not found`
      );
      return;
    }

    const success = source.addEffect(effectId, type, config, order);
    if (!success) {
      this.emitSourceError(
        sourceId,
        "EFFECT_INIT_FAILED",
        `Failed to create effect "${type}" (${effectId})`,
        effectId
      );
    }
  }

  private removeEffect(sourceId: string, effectId: string): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot remove effect: source ${sourceId} not found`
      );
      return;
    }
    source.removeEffect(effectId);
  }

  private updateEffect(
    sourceId: string,
    effectId: string,
    config: Record<string, number | boolean | string>
  ): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot update effect: source ${sourceId} not found`
      );
      return;
    }
    source.updateEffect(effectId, config);
  }

  private reorderEffects(sourceId: string, effectIds: string[]): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot reorder effects: source ${sourceId} not found`
      );
      return;
    }
    source.reorderEffects(effectIds);
  }

  private emitMessage(type: string, payload?: unknown): void {
    if (this.onMessage) {
      this.onMessage({ type, payload });
    }
  }

  /**
   * Emit a source error with proper error payload structure
   */
  private emitSourceError(
    sourceId: string,
    code: WorkletErrorCode,
    message: string,
    effectId?: string
  ): void {
    this.emitMessage(MessageType.SOURCE_ERROR, {
      id: generateWorkletErrorId(),
      sourceId,
      error: message,
      code,
      effectId,
      timestamp: Date.now(),
    });
  }
}
