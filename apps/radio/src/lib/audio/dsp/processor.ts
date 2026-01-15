/**
 * DSP Audio Processor
 *
 * AudioWorklet processor for real-time audio processing.
 * Handles streaming audio sources with effects and filters.
 *
 * NOTE: This file is designed to be bundled separately and loaded as a worklet.
 */

import { LevelMeter, SpectrumAnalyzer } from "./analysis/index.js";
import {
  BiquadFilter,
  type BiquadFilterType,
} from "./effects/biquad-filter.js";
import { Compressor } from "./effects/compressor.js";
import { CrusherEffect } from "./effects/crusher.js";
import { Distortion } from "./effects/distortion.js";
import { FoldEffect } from "./effects/fold.js";
import { FreeVerbReverb } from "./effects/freeverb.js";
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

  // Streaming
  ADD_STREAM_CHUNK: "ADD_STREAM_CHUNK",

  // Volume/Pan
  SET_SOURCE_VOLUME: "SET_SOURCE_VOLUME",
  SET_SOURCE_PAN: "SET_SOURCE_PAN",
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
  STREAM_UNDERRUN: "STREAM_UNDERRUN",

  // Analysis (worklet → main)
  ANALYSIS_DATA: "ANALYSIS_DATA",

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
 * Channel strip for volume and panning
 */
class ChannelStrip {
  volume = 1.0;
  pan = 0.0;
  private leftGain = 1.0;
  private rightGain = 1.0;

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
    this.leftGain = Math.cos(angle) * this.volume;
    this.rightGain = Math.sin(angle) * this.volume;
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
      outputL[i] = (inputL[i] ?? 0) * this.leftGain;
      outputR[i] = (inputR[i] ?? 0) * this.rightGain;
    }
  }
}

/**
 * Stream source for buffered audio playback
 */
class StreamSource {
  readonly id: string;
  private readonly sampleRate: number;
  private readonly bufferL: Float32Array[] = [];
  private readonly bufferR: Float32Array[] = [];
  private readPosition = 0;
  private currentChunkIndex = 0;
  private playing = false;
  private paused = false;
  private hasReceivedFirstChunk = false;

  // Per-source volume and pan
  volume = 1.0;
  pan = 0.0;
  private leftGain = 1.0;
  private rightGain = 1.0;

  // Filters and effects
  private readonly filters = new Map<string, BiquadFilter>();
  private filterOrder: string[] = [];
  private readonly effects = new Map<string, EffectProcessor>();
  private effectOrder: string[] = [];
  private readonly effectTypes = new Map<string, EffectType>();

  // Temp buffers for processing
  private readonly tempL: Float32Array;
  private readonly tempR: Float32Array;

  constructor(id: string, sampleRate: number) {
    this.id = id;
    this.sampleRate = sampleRate;
    this.tempL = new Float32Array(128);
    this.tempR = new Float32Array(128);
    this.updateGains();
  }

  get isPlaying(): boolean {
    return this.playing && !this.paused;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get hasData(): boolean {
    return this.bufferL.length > 0;
  }

  get firstChunkReceived(): boolean {
    return this.hasReceivedFirstChunk;
  }

  start(): void {
    this.playing = true;
    this.paused = false;
  }

  stop(): void {
    this.playing = false;
    this.paused = false;
    this.readPosition = 0;
    this.currentChunkIndex = 0;

    // Clear old audio to prevent stale playback
    this.bufferL.length = 0;
    this.bufferR.length = 0;

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

  private updateGains(): void {
    const angle = ((this.pan + 1) / 2) * (Math.PI / 2);
    this.leftGain = Math.cos(angle) * this.volume;
    this.rightGain = Math.sin(angle) * this.volume;
  }

  addChunk(channels: Float32Array[]): void {
    if (channels.length >= 2) {
      this.bufferL.push(channels[0] ?? new Float32Array(0));
      this.bufferR.push(channels[1] ?? new Float32Array(0));
    } else if (channels.length === 1) {
      // Mono - duplicate to stereo
      this.bufferL.push(channels[0] ?? new Float32Array(0));
      this.bufferR.push(channels[0] ?? new Float32Array(0));
    }

    if (!this.hasReceivedFirstChunk && this.bufferL.length > 0) {
      this.hasReceivedFirstChunk = true;
    }
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

    // Insert at correct order position
    this.insertEffectAtOrder(effectId, order);
  }

  removeEffect(effectId: string): void {
    this.effects.delete(effectId);
    this.effectTypes.delete(effectId);
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
  }

  reorderEffects(effectIds: string[]): void {
    this.effectOrder = effectIds.filter((id) => this.effects.has(id));
  }

  private createEffectProcessor(type: EffectType): EffectProcessor | null {
    switch (type) {
      case "biquadFilter":
        return new BiquadFilter(this.sampleRate);
      case "plateReverb":
        return new DattorroReverb(this.sampleRate);
      case "standardReverb":
        return new FreeVerbReverb(this.sampleRate);
      case "phaseVocoder":
        return new PhaseVocoder(this.sampleRate);
      case "distortion":
        return new Distortion(this.sampleRate);
      case "compressor":
        return new Compressor(this.sampleRate);
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
        break;
      }
      case "stereoTool": {
        const stereo = processor as StereoToolEffect;
        if (config.volume !== undefined) {
          stereo.setVolume(config.volume as number);
        }
        if (config.panning !== undefined) {
          stereo.setPanning(config.panning as number);
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
        if (config.decay !== undefined) {
          reverb.setDecay(config.decay as number);
        }
        if (config.damping !== undefined) {
          reverb.setDamping(config.damping as number);
        }
        break;
      }
      case "standardReverb": {
        const reverb = processor as FreeVerbReverb;
        if (config.roomSize !== undefined) {
          reverb.setRoomSize(config.roomSize as number);
        }
        if (config.damp !== undefined) {
          reverb.setDamp(config.damp as number);
        }
        break;
      }
      case "distortion": {
        const dist = processor as Distortion;
        if (config.amount !== undefined) {
          dist.setAmount(config.amount as number);
        }
        break;
      }
      case "compressor": {
        const comp = processor as Compressor;
        if (config.threshold !== undefined) {
          comp.setThreshold(config.threshold as number);
        }
        if (config.ratio !== undefined) {
          comp.setRatio(config.ratio as number);
        }
        if (config.attack !== undefined) {
          comp.setAttack(config.attack as number);
        }
        if (config.release !== undefined) {
          comp.setRelease(config.release as number);
        }
        if (config.knee !== undefined) {
          comp.setKnee(config.knee as number);
        }
        break;
      }
      case "phaseVocoder": {
        const pv = processor as PhaseVocoder;
        if (config.pitchFactor !== undefined) {
          pv.setPitchFactor(config.pitchFactor as number);
        }
        break;
      }
      case "biquadFilter": {
        const filter = processor as BiquadFilter;
        if (config.filterType !== undefined) {
          filter.type = config.filterType as unknown as BiquadFilterType;
        }
        if (config.frequency !== undefined) {
          filter.frequency = config.frequency as number;
        }
        if (config.Q !== undefined) {
          filter.Q = config.Q as number;
        }
        if (config.gain !== undefined) {
          filter.gain = config.gain as number;
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
   * Process audio into output buffers
   * Returns false if source has ended
   */
  process(
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: number,
    toIndex: number
  ): boolean {
    if (!(this.isPlaying && this.hasData)) {
      return true; // Keep source alive but produce silence
    }

    const blockSize = toIndex - fromIndex;
    let samplesWritten = 0;

    // Read from buffer
    while (
      samplesWritten < blockSize &&
      this.currentChunkIndex < this.bufferL.length
    ) {
      const chunkL = this.bufferL[this.currentChunkIndex];
      const chunkR = this.bufferR[this.currentChunkIndex];

      if (!(chunkL && chunkR)) {
        this.currentChunkIndex++;
        continue;
      }

      const chunkRemaining = chunkL.length - this.readPosition;
      const samplesToRead = Math.min(
        blockSize - samplesWritten,
        chunkRemaining
      );

      for (let i = 0; i < samplesToRead; i++) {
        this.tempL[fromIndex + samplesWritten + i] =
          chunkL[this.readPosition + i] ?? 0;
        this.tempR[fromIndex + samplesWritten + i] =
          chunkR[this.readPosition + i] ?? 0;
      }

      this.readPosition += samplesToRead;
      samplesWritten += samplesToRead;

      if (this.readPosition >= chunkL.length) {
        this.readPosition = 0;
        this.currentChunkIndex++;

        // Clean up old chunks to prevent memory leak (keep current + 2 ahead)
        if (this.currentChunkIndex > 2) {
          const removeCount = this.currentChunkIndex - 2;
          this.bufferL.splice(0, removeCount);
          this.bufferR.splice(0, removeCount);
          this.currentChunkIndex = 2;
        }
      }
    }

    // Fill remaining with silence
    for (let i = samplesWritten; i < blockSize; i++) {
      this.tempL[fromIndex + i] = 0;
      this.tempR[fromIndex + i] = 0;
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

    // Apply effects
    for (const effectId of this.effectOrder) {
      const effect = this.effects.get(effectId);
      if (effect) {
        effect.process(current, outputChannels, fromIndex, toIndex);
        current = outputChannels;
      }
    }

    // If no filters/effects, copy temp to output
    if (this.filterOrder.length === 0 && this.effectOrder.length === 0) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = this.tempL[i] ?? 0;
        outputR[i] = this.tempR[i] ?? 0;
      }
    }

    // Apply volume/pan
    for (let i = fromIndex; i < toIndex; i++) {
      outputL[i] = (outputL[i] ?? 0) * this.leftGain;
      outputR[i] = (outputR[i] ?? 0) * this.rightGain;
    }

    return true;
  }
}

/**
 * Main DSP Processor for AudioWorklet
 */
export class DSPProcessor {
  private readonly sources = new Map<string, StreamSource>();
  private readonly channelStrip = new ChannelStrip();
  private readonly masterLimiter: Limiter;
  private readonly sampleRate: number;

  // Pre-allocated temp buffers for mixing (avoid GC pressure in audio thread)
  private readonly mixTempL = new Float32Array(128);
  private readonly mixTempR = new Float32Array(128);

  // Analysis components (lazily initialized)
  private levelMeter: LevelMeter | null = null;
  private spectrumAnalyzer: SpectrumAnalyzer | null = null;
  private analysisEnabled = false;
  private analysisFrameCounter = 0;
  private readonly analysisInterval = 3; // Send every N render quanta (~60fps at 128 samples)

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

      case MessageType.ADD_STREAM_CHUNK: {
        const { sourceId, chunk } = payload as {
          sourceId: string;
          chunk: Float32Array[];
        };
        this.addStreamChunk(sourceId, chunk);
        break;
      }

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
   * Process audio
   */
  process(
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: number,
    toIndex: number
  ): void {
    // Clear output
    for (let i = fromIndex; i < toIndex; i++) {
      outputL[i] = 0;
      outputR[i] = 0;
    }

    // Use pre-allocated temp buffers (avoid GC pressure)
    const tempL = this.mixTempL;
    const tempR = this.mixTempR;

    // Mix all sources
    for (const source of this.sources.values()) {
      if (source.isPlaying) {
        // Clear temp buffers before each source
        for (let i = fromIndex; i < toIndex; i++) {
          tempL[i] = 0;
          tempR[i] = 0;
        }

        source.process(tempL, tempR, fromIndex, toIndex);

        // Mix into output
        for (let i = fromIndex; i < toIndex; i++) {
          outputL[i] = (outputL[i] ?? 0) + (tempL[i] ?? 0);
          outputR[i] = (outputR[i] ?? 0) + (tempR[i] ?? 0);
        }
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
    const source = new StreamSource(id, this.sampleRate);
    this.sources.set(id, source);
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

  private addStreamChunk(sourceId: string, chunk: Float32Array[]): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      return;
    }

    const wasEmpty = !source.firstChunkReceived;
    source.addChunk(chunk);

    if (wasEmpty && source.firstChunkReceived) {
      this.emitMessage(MessageType.STREAM_READY, { sourceId });
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
