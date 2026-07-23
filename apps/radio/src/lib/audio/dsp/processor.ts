/**
 * DSP Audio Processor
 *
 * AudioWorklet processor for real-time audio effects processing.
 * Receives audio via a shared Web Audio graph connection.
 *
 * NOTE: This file is designed to be bundled separately and loaded as a worklet.
 */

import { LevelMeter, SpectrumAnalyzer } from "./analysis/index.js";
import type { BiquadFilterType } from "./effects/biquad-filter.js";
import { Limiter } from "./effects/limiter.js";
import type { EffectType } from "./effects/types.js";
import {
  type AnalysisData,
  generateWorkletErrorId,
  MessageType,
  type WorkletErrorCode,
} from "./processor-protocol.js";
import { ChannelStrip, EffectSource } from "./processor-source.js";

export {
  type AnalysisData,
  MessageType,
  type MessageTypeValue,
  type WorkletErrorCode,
} from "./processor-protocol.js";

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

      case MessageType.SET_TEMPO: {
        const { sourceId, bpm } = payload as {
          sourceId: string;
          bpm: number;
        };
        this.setTempo(sourceId, bpm);
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
          config: Record<string, unknown>;
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
          config: Record<string, unknown>;
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
    toIndex: number,
    sidechainL?: Float32Array,
    sidechainR?: Float32Array
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
        source.process(
          tempL,
          tempR,
          outputL,
          outputR,
          fromIndex,
          toIndex,
          sidechainL,
          sidechainR
        );
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

  private setTempo(sourceId: string, bpm: number): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      this.emitSourceError(
        sourceId,
        "SOURCE_NOT_FOUND",
        `Cannot set tempo: source ${sourceId} not found`
      );
      return;
    }
    source.setTempo(bpm);
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
    config: Record<string, unknown>,
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
    config: Record<string, unknown>
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
