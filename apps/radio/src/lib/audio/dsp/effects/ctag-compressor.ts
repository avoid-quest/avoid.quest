// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from openDAW; see THIRD_PARTY_NOTICES.md for attribution and changes.
/**
 * CTAGDRC Dynamics Compressor
 *
 * Professional-grade dynamics compressor with advanced features:
 * - Lookahead for transparent limiting
 * - Auto attack/release based on crest factor analysis
 * - Auto makeup gain
 * - Soft knee compression curve
 *
 * Ported from openDAW's CompressorDeviceProcessor.
 * @see https://github.com/andremichelle/openDAW/blob/main/packages/studio/core-processors/src/devices/audio-effects/CompressorDeviceProcessor.ts
 * @see https://github.com/p-hlp/CTAGDRC
 */

import { dbToGain, RenderQuantum } from "@opendaw/lib-dsp";
import {
  decibelsToGain,
  GainComputer,
  LevelDetector,
  LookAhead,
  SmoothingFilter,
} from "@opendaw/lib-dsp/ctagdrc";
import type { StereoChannels } from "./types.js";

/** Peak decay time per sample */
const PEAK_DECAY_PER_SAMPLE_FACTOR = 0.5;
/** Reduction decay time per quantum */
const REDUCTION_DECAY_FACTOR = 0.05;
/** Lookahead delay in seconds */
const LOOKAHEAD_DELAY = 0.005;

export type CTAGCompressorConfig = {
  /** Threshold in dB (-60 to 0) */
  threshold: number;
  /** Ratio (1:1 to inf:1, values > 24 become limiter) */
  ratio: number;
  /** Knee width in dB (0 to 24) */
  knee: number;
  /** Attack time in ms (0.1 to 100) */
  attack: number;
  /** Release time in ms (10 to 2000) */
  release: number;
  /** Makeup gain in dB (-12 to 24) */
  makeup: number;
  /** Mix (0 to 1) */
  mix: number;
  /** Input gain in dB (-24 to 24) */
  inputGain: number;
  /** Enable lookahead (5ms delay) */
  lookahead: boolean;
  /** Auto attack based on crest factor */
  autoAttack: boolean;
  /** Auto release based on crest factor */
  autoRelease: boolean;
  /** Auto makeup gain */
  autoMakeup: boolean;
};

export const DEFAULT_CTAG_CONFIG: CTAGCompressorConfig = {
  attack: 2,
  autoAttack: false,
  autoMakeup: false,
  autoRelease: false,
  inputGain: 0,
  knee: 6,
  lookahead: true,
  makeup: 0,
  mix: 1,
  ratio: 4,
  release: 140,
  threshold: -10,
};

/**
 * Simple stereo delay line for lookahead
 */
class StereoDelay {
  readonly #bufferL: Float32Array;
  readonly #bufferR: Float32Array;
  readonly #bufferSize: number;
  readonly #delayInSamples: number;
  #writePosition = 0;

  constructor(
    sampleRate: number,
    delayInSeconds: number,
    maxBlockSize: number
  ) {
    this.#delayInSamples = Math.floor(sampleRate * delayInSeconds);
    this.#bufferSize = maxBlockSize + this.#delayInSamples;
    this.#bufferL = new Float32Array(this.#bufferSize);
    this.#bufferR = new Float32Array(this.#bufferSize);
  }

  process(channels: StereoChannels, fromIndex: number, toIndex: number): void {
    if (this.#delayInSamples === 0) {
      return;
    }
    const [channelL, channelR] = channels;
    let readPos =
      (this.#writePosition - this.#delayInSamples + this.#bufferSize) %
      this.#bufferSize;
    let writePos = this.#writePosition;

    for (let i = fromIndex; i < toIndex; i += 1) {
      const delayedL = this.#bufferL[readPos] ?? 0;
      const delayedR = this.#bufferR[readPos] ?? 0;
      this.#bufferL[writePos] = channelL[i] ?? 0;
      this.#bufferR[writePos] = channelR[i] ?? 0;
      channelL[i] = delayedL;
      channelR[i] = delayedR;
      writePos = (writePos + 1) % this.#bufferSize;
      readPos = (readPos + 1) % this.#bufferSize;
    }
    this.#writePosition =
      (this.#writePosition + (toIndex - fromIndex)) % this.#bufferSize;
  }

  reset(): void {
    this.#bufferL.fill(0);
    this.#bufferR.fill(0);
    this.#writePosition = 0;
  }
}

export class CTAGCompressor {
  readonly #peakDecay: number;
  readonly #reductionDecay: number;

  // CTAGDRC components
  readonly #ballistics: LevelDetector;
  readonly #gainComputer: GainComputer;
  readonly #delay: StereoDelay;
  readonly #lookaheadProcessor: LookAhead;
  readonly #smoothedAutoMakeup: SmoothingFilter;

  // Internal buffers
  readonly #sidechainSignal: Float32Array;
  readonly #originalSignal: StereoChannels;
  #externalSidechain: StereoChannels | null = null;

  // State
  #inputGain = 1;
  #targetInputGain = 1;
  #lookahead = true as boolean;
  #autoMakeup = false as boolean;
  #makeup = 0;
  #mix = 1;
  #autoMakeupValue = 0;
  #inputPeak = 0;
  #outputPeak = 0;
  #reductionMin = 0;

  // Temporary buffer for lookahead processing
  readonly #lookaheadBuffer: StereoChannels;

  constructor(sampleRate: number) {
    this.#peakDecay = Math.exp(
      -1 / (sampleRate * PEAK_DECAY_PER_SAMPLE_FACTOR)
    );
    this.#reductionDecay =
      (RenderQuantum / sampleRate) * REDUCTION_DECAY_FACTOR;

    // Initialize CTAGDRC components
    this.#ballistics = new LevelDetector(sampleRate);
    this.#gainComputer = new GainComputer();
    this.#delay = new StereoDelay(sampleRate, LOOKAHEAD_DELAY, RenderQuantum);
    this.#lookaheadProcessor = new LookAhead(
      sampleRate,
      LOOKAHEAD_DELAY,
      RenderQuantum
    );
    this.#smoothedAutoMakeup = new SmoothingFilter(sampleRate);
    this.#smoothedAutoMakeup.setAlpha(0.03);

    // Initialize buffers
    this.#sidechainSignal = new Float32Array(RenderQuantum);
    this.#originalSignal = [
      new Float32Array(RenderQuantum),
      new Float32Array(RenderQuantum),
    ];
    this.#lookaheadBuffer = [
      new Float32Array(RenderQuantum),
      new Float32Array(RenderQuantum),
    ];

    // Apply default config
    this.setConfig(DEFAULT_CTAG_CONFIG);
  }

  setConfig(config: Partial<CTAGCompressorConfig>): void {
    if (config.lookahead !== undefined) {
      this.#lookahead = config.lookahead;
    }
    if (config.autoMakeup !== undefined) {
      this.#autoMakeup = config.autoMakeup;
    }
    if (config.autoAttack !== undefined) {
      this.#ballistics.setAutoAttack(config.autoAttack);
      if (!config.autoAttack && config.attack !== undefined) {
        this.#ballistics.setAttack(config.attack * 0.001);
      }
    }
    if (config.autoRelease !== undefined) {
      this.#ballistics.setAutoRelease(config.autoRelease);
      if (!config.autoRelease && config.release !== undefined) {
        this.#ballistics.setRelease(config.release * 0.001);
      }
    }
    if (config.inputGain !== undefined) {
      this.#targetInputGain = dbToGain(config.inputGain);
    }
    if (config.threshold !== undefined) {
      this.#gainComputer.setThreshold(config.threshold);
    }
    if (config.ratio !== undefined) {
      this.#gainComputer.setRatio(config.ratio);
    }
    if (config.knee !== undefined) {
      this.#gainComputer.setKnee(config.knee);
    }
    if (config.attack !== undefined) {
      this.#ballistics.setAttack(config.attack * 0.001);
    }
    if (config.release !== undefined) {
      this.#ballistics.setRelease(config.release * 0.001);
    }
    if (config.makeup !== undefined) {
      this.#makeup = config.makeup;
    }
    if (config.mix !== undefined) {
      this.#mix = config.mix;
    }
  }

  setThreshold(value: number): void {
    this.#gainComputer.setThreshold(value);
  }

  setRatio(value: number): void {
    this.#gainComputer.setRatio(value);
  }

  setKnee(value: number): void {
    this.#gainComputer.setKnee(value);
  }

  setAttack(value: number): void {
    this.#ballistics.setAttack(value * 0.001);
  }

  setRelease(value: number): void {
    this.#ballistics.setRelease(value * 0.001);
  }

  setMakeup(value: number): void {
    this.#makeup = value;
  }

  setMix(value: number): void {
    this.#mix = Math.max(0, Math.min(1, value));
  }

  setInputGain(value: number): void {
    this.#targetInputGain = dbToGain(value);
  }

  setLookahead(enabled: boolean): void {
    this.#lookahead = enabled;
  }

  setAutoAttack(enabled: boolean): void {
    this.#ballistics.setAutoAttack(enabled);
  }

  setAutoRelease(enabled: boolean): void {
    this.#ballistics.setAutoRelease(enabled);
  }

  setAutoMakeup(enabled: boolean): void {
    this.#autoMakeup = enabled;
  }

  reset(): void {
    this.#inputGain = this.#targetInputGain;
    this.#autoMakeupValue = 0;
    this.#inputPeak = 0;
    this.#outputPeak = 0;
    this.#reductionMin = 0;
    this.#delay.reset();
    this.#sidechainSignal.fill(0);
    this.#originalSignal[0].fill(0);
    this.#originalSignal[1].fill(0);
    this.#lookaheadBuffer[0].fill(0);
    this.#lookaheadBuffer[1].fill(0);
  }

  /** Get current input peak level in dB */
  getInputPeakDb(): number {
    return this.#inputPeak > 0 ? 20 * Math.log10(this.#inputPeak) : -100;
  }

  /** Get current output peak level in dB */
  getOutputPeakDb(): number {
    return this.#outputPeak > 0 ? 20 * Math.log10(this.#outputPeak) : -100;
  }

  /** Get maximum gain reduction in dB (negative value) */
  getGainReductionDb(): number {
    return this.#reductionMin;
  }

  setSidechainInput(input: StereoChannels | null): void {
    this.#externalSidechain = input;
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;

    // Apply input gain with smoothing
    const inputGainStep =
      (this.#targetInputGain - this.#inputGain) / (toIndex - fromIndex);
    for (let i = fromIndex; i < toIndex; i += 1) {
      this.#inputGain += inputGainStep;
      outputL[i] = (inputL[i] ?? 0) * this.#inputGain;
      outputR[i] = (inputR[i] ?? 0) * this.#inputGain;
    }

    // Get max L/R amplitude for envelope follower (sidechain signal)
    const detector = this.#externalSidechain ?? output;
    this.#sidechainSignal.fill(0, fromIndex, toIndex);
    for (let i = fromIndex; i < toIndex; i += 1) {
      this.#sidechainSignal[i] = Math.max(
        Math.abs(detector[0][i] ?? 0),
        Math.abs(detector[1][i] ?? 0)
      );
    }

    // Track detection signal peak
    for (let i = fromIndex; i < toIndex; i += 1) {
      const peak = this.#sidechainSignal[i];
      if (this.#inputPeak <= peak) {
        this.#inputPeak = peak;
      } else {
        this.#inputPeak *= this.#peakDecay;
      }
    }

    // Calculate crest factor for auto attack/release
    this.#ballistics.processCrestFactor(
      this.#sidechainSignal,
      fromIndex,
      toIndex
    );

    // Compute compression attenuation (converts sidechain from linear to log)
    this.#gainComputer.applyCompressionToBuffer(
      this.#sidechainSignal,
      fromIndex,
      toIndex
    );

    // Smooth attenuation with attack/release ballistics
    this.#ballistics.applyBallistics(this.#sidechainSignal, fromIndex, toIndex);

    // Track minimum gain reduction
    for (let i = fromIndex; i < toIndex; i += 1) {
      const peak = this.#sidechainSignal[i];
      if (this.#reductionMin >= peak) {
        this.#reductionMin = peak;
      } else {
        this.#reductionMin += this.#reductionDecay;
      }
    }

    // Calculate auto makeup gain
    this.#autoMakeupValue = this.#calculateAutoMakeup(fromIndex, toIndex);

    // Apply lookahead if enabled
    if (this.#lookahead) {
      // Copy output to temp buffer for delay line
      const blockSize = toIndex - fromIndex;
      for (let i = 0; i < blockSize; i += 1) {
        this.#lookaheadBuffer[0][i] = outputL[fromIndex + i] ?? 0;
        this.#lookaheadBuffer[1][i] = outputR[fromIndex + i] ?? 0;
      }

      // Delay input buffer
      this.#delay.process(this.#lookaheadBuffer, 0, blockSize);

      // Copy delayed audio back
      for (let i = 0; i < blockSize; i += 1) {
        outputL[fromIndex + i] = this.#lookaheadBuffer[0][i];
        outputR[fromIndex + i] = this.#lookaheadBuffer[1][i];
      }

      // Process sidechain with lookahead (gain reduction fade-in)
      this.#lookaheadProcessor.process(
        this.#sidechainSignal,
        fromIndex,
        toIndex
      );
    }

    // Convert sidechain from dB to linear gain and apply makeup
    for (let i = fromIndex; i < toIndex; i += 1) {
      this.#sidechainSignal[i] = decibelsToGain(
        this.#sidechainSignal[i] + this.#makeup + this.#autoMakeupValue
      );
    }

    // Store original signal for dry/wet mixing
    for (let i = fromIndex; i < toIndex; i += 1) {
      this.#originalSignal[0][i - fromIndex] = outputL[i] ?? 0;
      this.#originalSignal[1][i - fromIndex] = outputR[i] ?? 0;
    }

    // Apply compression gain
    for (let i = fromIndex; i < toIndex; i += 1) {
      outputL[i] = (outputL[i] ?? 0) * this.#sidechainSignal[i];
      outputR[i] = (outputR[i] ?? 0) * this.#sidechainSignal[i];
    }

    // Mix dry and wet signals
    if (this.#mix < 1) {
      const dryMix = 1 - this.#mix;
      for (let i = fromIndex; i < toIndex; i += 1) {
        const origIdx = i - fromIndex;
        const wet = this.#mix;
        outputL[i] =
          (outputL[i] ?? 0) * wet + this.#originalSignal[0][origIdx] * dryMix;
        outputR[i] =
          (outputR[i] ?? 0) * wet + this.#originalSignal[1][origIdx] * dryMix;
      }
    }

    // Track output peak
    for (let i = fromIndex; i < toIndex; i += 1) {
      const peak = Math.max(
        Math.abs(outputL[i] ?? 0),
        Math.abs(outputR[i] ?? 0)
      );
      if (this.#outputPeak <= peak) {
        this.#outputPeak = peak;
      } else {
        this.#outputPeak *= this.#peakDecay;
      }
    }
  }

  #calculateAutoMakeup(fromIndex: number, toIndex: number): number {
    let sum = 0;
    for (let i = fromIndex; i < toIndex; i += 1) {
      sum += this.#sidechainSignal[i];
    }
    this.#smoothedAutoMakeup.process(-sum / (toIndex - fromIndex));
    return this.#autoMakeup ? this.#smoothedAutoMakeup.getState() : 0;
  }
}
