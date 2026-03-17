/**
 * Pitch Shifting Effects - Multiple Algorithms
 *
 * This module provides four distinct pitch shifting implementations:
 * 1. VarispeedEffect - Simple speed-based pitch shift (tape/vinyl analog)
 * 2. OlaPhaseVocoder - FFT-based phase vocoder with Overlap-Add (high quality)
 * 3. PsolaEffect - Pitch-Synchronous Overlap-Add (time-domain, simpler)
 * 4. GranularPitchEffect - Granular synthesis approach with configurable grain size
 */

import type { StereoChannels } from "./types.js";

/**
 * Simple linear resampling pitch shifter.
 * This changes both pitch AND tempo together (like speeding up/slowing down a tape).
 * - pitchFactor < 1.0 = slower + lower pitch
 * - pitchFactor > 1.0 = faster + higher pitch
 */
export class VarispeedEffect {
  private pitchFactor = 1.0;

  // Buffer for resampling
  private readonly bufferSize = 4096;
  private readonly bufferL: Float32Array;
  private readonly bufferR: Float32Array;
  private readPosition = 0;
  private writePosition = 0;

  constructor() {
    this.bufferL = new Float32Array(this.bufferSize);
    this.bufferR = new Float32Array(this.bufferSize);
  }

  setPitchFactor(value: number): void {
    this.pitchFactor = Math.max(0.25, Math.min(4.0, value));
  }

  reset(): void {
    this.bufferL.fill(0);
    this.bufferR.fill(0);
    this.readPosition = 0;
    this.writePosition = 0;
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;

    // If pitch factor is 1.0, pass through
    if (Math.abs(this.pitchFactor - 1.0) < 0.001) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = inputL[i] ?? 0;
        outputR[i] = inputR[i] ?? 0;
      }
      return;
    }

    // Simple resampling-based pitch shift
    // Write input to buffer
    for (let i = fromIndex; i < toIndex; i++) {
      this.bufferL[this.writePosition] = inputL[i] ?? 0;
      this.bufferR[this.writePosition] = inputR[i] ?? 0;
      this.writePosition = (this.writePosition + 1) & (this.bufferSize - 1);
    }

    // Read from buffer with pitch-shifted rate
    const step = this.pitchFactor;

    for (let i = fromIndex; i < toIndex; i++) {
      const pos = this.readPosition;
      const posInt = Math.floor(pos);
      const posFrac = pos - posInt;

      // Linear interpolation
      const idx0 = posInt & (this.bufferSize - 1);
      const idx1 = (posInt + 1) & (this.bufferSize - 1);

      const sampleL0 = this.bufferL[idx0] ?? 0;
      const sampleL1 = this.bufferL[idx1] ?? 0;
      const sampleR0 = this.bufferR[idx0] ?? 0;
      const sampleR1 = this.bufferR[idx1] ?? 0;

      outputL[i] = sampleL0 + (sampleL1 - sampleL0) * posFrac;
      outputR[i] = sampleR0 + (sampleR1 - sampleR0) * posFrac;

      this.readPosition += step;

      // Keep read position in bounds
      while (this.readPosition >= this.bufferSize) {
        this.readPosition -= this.bufferSize;
      }
    }
  }
}

/**
 * OLA (Overlap-Add) pitch shifter — time-domain, no FFT required.
 *
 * Reads the input at a pitch-scaled rate and overlap-adds Hann-windowed grains
 * into the synthesis buffer. Because the read pointer advances at `pitchFactor`
 * per output sample, the perceived pitch changes without stretching time.
 *
 * Better than VarispeedEffect: windowing eliminates the hard splices that
 * cause aliasing in plain linear resampling. Slightly more CPU intensive.
 */
export class OlaPhaseVocoder {
  private pitchFactor = 1.0;
  private readonly grainSize: number;
  private readonly hopSize: number;
  private readonly window: Float32Array;

  // Circular input buffer
  private readonly inBufL: Float32Array;
  private readonly inBufR: Float32Array;
  private inWrite = 0;

  // Synthesis (overlap-add) buffer
  private readonly outBufL: Float32Array;
  private readonly outBufR: Float32Array;
  private outRead = 0;
  private outWrite = 0;

  // Read position in input buffer (fractional, pitch-scaled)
  private readPos = 0;
  // Counter to trigger next grain
  private samplesSinceGrain = 0;

  constructor(grainSize: number = 2048) {
    this.grainSize = grainSize;
    this.hopSize = grainSize >> 2; // 75% overlap

    // Pre-compute Hann window
    this.window = new Float32Array(grainSize);
    for (let i = 0; i < grainSize; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
    }

    // Input buffer: 4× grain size for safe look-back
    const inBufLen = grainSize * 4;
    this.inBufL = new Float32Array(inBufLen);
    this.inBufR = new Float32Array(inBufLen);

    // Output buffer: 4× grain size for accumulated overlap-add
    const outBufLen = grainSize * 4;
    this.outBufL = new Float32Array(outBufLen);
    this.outBufR = new Float32Array(outBufLen);
  }

  setPitchFactor(value: number): void {
    this.pitchFactor = Math.max(0.25, Math.min(4.0, value));
  }

  reset(): void {
    this.inBufL.fill(0);
    this.inBufR.fill(0);
    this.outBufL.fill(0);
    this.outBufR.fill(0);
    this.inWrite = 0;
    this.outRead = 0;
    this.outWrite = 0;
    this.readPos = 0;
    this.samplesSinceGrain = 0;
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;
    const inBufLen = this.inBufL.length;
    const outBufLen = this.outBufL.length;

    if (Math.abs(this.pitchFactor - 1.0) < 0.001) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = inputL[i] ?? 0;
        outputR[i] = inputR[i] ?? 0;
      }
      return;
    }

    for (let i = fromIndex; i < toIndex; i++) {
      // Write new input sample
      this.inBufL[this.inWrite] = inputL[i] ?? 0;
      this.inBufR[this.inWrite] = inputR[i] ?? 0;
      this.inWrite = (this.inWrite + 1) % inBufLen;

      // Trigger a new grain every hopSize output samples
      if (this.samplesSinceGrain >= this.hopSize) {
        this.samplesSinceGrain = 0;
        this.addGrain(inBufLen, outBufLen);
      }
      this.samplesSinceGrain++;

      // Read one sample from synthesis buffer
      outputL[i] = this.outBufL[this.outRead];
      outputR[i] = this.outBufR[this.outRead];
      this.outBufL[this.outRead] = 0;
      this.outBufR[this.outRead] = 0;
      this.outRead = (this.outRead + 1) % outBufLen;
      this.outWrite = (this.outWrite + 1) % outBufLen;
    }
  }

  private addGrain(inBufLen: number, outBufLen: number): void {
    const grainSize = this.grainSize;
    // Start reading from the past so the grain is centred near the current position
    const grainStart = this.readPos - grainSize * 0.5;

    for (let j = 0; j < grainSize; j++) {
      const w = this.window[j]!;
      // Source position in input circular buffer
      const srcFrac = grainStart + j * this.pitchFactor;
      const srcInt = Math.floor(srcFrac);
      const frac = srcFrac - srcInt;
      const idx0 = ((srcInt % inBufLen) + inBufLen) % inBufLen;
      const idx1 = (idx0 + 1) % inBufLen;

      const sL = (this.inBufL[idx0]! + (this.inBufL[idx1]! - this.inBufL[idx0]!) * frac) * w;
      const sR = (this.inBufR[idx0]! + (this.inBufR[idx1]! - this.inBufR[idx0]!) * frac) * w;

      const outIdx = (this.outWrite + j) % outBufLen;
      this.outBufL[outIdx] = (this.outBufL[outIdx] ?? 0) + sL;
      this.outBufR[outIdx] = (this.outBufR[outIdx] ?? 0) + sR;
    }

    // Advance the read position by one synthesis hop
    this.readPos += this.hopSize;
  }
}

/**
 * PSOLA (Pitch-Synchronous Overlap-Add)
 * Time-domain pitch shifting without FFT.
 * Good balance between quality and CPU cost.
 */
export class PsolaEffect {
  private pitchFactor = 1.0;
  private readonly periodSize: number;
  private readonly bufferSize: number;
  private readonly bufferL: Float32Array;
  private readonly bufferR: Float32Array;
  private readPos = 0;
  private writePos = 0;

  constructor() {
    this.periodSize = 512; // Base grain period
    this.bufferSize = this.periodSize * 8; // Circular buffer
    this.bufferL = new Float32Array(this.bufferSize);
    this.bufferR = new Float32Array(this.bufferSize);
  }

  setPitchFactor(value: number): void {
    this.pitchFactor = Math.max(0.25, Math.min(4.0, value));
  }

  reset(): void {
    this.bufferL.fill(0);
    this.bufferR.fill(0);
    this.readPos = 0;
    this.writePos = 0;
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;

    if (Math.abs(this.pitchFactor - 1.0) < 0.001) {
      // Pass through if pitch = 1.0
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = inputL[i] ?? 0;
        outputR[i] = inputR[i] ?? 0;
      }
      return;
    }

    const grainSize = Math.round(this.periodSize / this.pitchFactor);

    for (let i = fromIndex; i < toIndex; i++) {
      // Write input to circular buffer
      this.bufferL[this.writePos] = inputL[i] ?? 0;
      this.bufferR[this.writePos] = inputR[i] ?? 0;
      this.writePos = (this.writePos + 1) % this.bufferSize;

      // Read with Hann window overlap
      const readPhase = (this.readPos / this.periodSize) % 1.0;
      const hannWindow = 0.5 * (1 - Math.cos(2 * Math.PI * readPhase));

      const readIdx = Math.floor(this.readPos) % this.bufferSize;
      outputL[i] = this.bufferL[readIdx] * hannWindow;
      outputR[i] = this.bufferR[readIdx] * hannWindow;

      this.readPos += grainSize / this.periodSize;
    }
  }
}

/**
 * Granular Pitch Shifting
 * Overlapping grains with pitch-scaled playback.
 * Flexible grain size parameter.
 */
export class GranularPitchEffect {
  private pitchFactor = 1.0;
  private grainSizeMs = 50;
  private readonly sampleRate: number;
  private readonly maxGrains = 4;
  private readonly grains: GrainState[];
  private readonly bufferL: Float32Array;
  private readonly bufferR: Float32Array;
  private bufferPos = 0;
  private nextGrainTime = 0;

  constructor(sampleRate: number = 44100) {
    this.sampleRate = sampleRate;
    this.bufferL = new Float32Array(sampleRate * 0.5); // 500ms buffer
    this.bufferR = new Float32Array(sampleRate * 0.5);
    this.grains = [];
    for (let i = 0; i < this.maxGrains; i++) {
      this.grains.push({
        readPos: 0,
        grainPos: 0,
        envelope: 0,
        active: false,
        startBufferPos: 0,
      });
    }
  }

  setPitchFactor(value: number): void {
    this.pitchFactor = Math.max(0.25, Math.min(4.0, value));
  }

  setGrainSize(sizeMs: number): void {
    this.grainSizeMs = Math.max(10, Math.min(200, sizeMs));
  }

  reset(): void {
    this.bufferL.fill(0);
    this.bufferR.fill(0);
    this.bufferPos = 0;
    this.nextGrainTime = 0;
    for (const grain of this.grains) {
      grain.active = false;
    }
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;
    const grainSizeSamples = Math.round((this.grainSizeMs * this.sampleRate) / 1000);

    // Write input to circular buffer
    for (let i = fromIndex; i < toIndex; i++) {
      this.bufferL[this.bufferPos] = inputL[i] ?? 0;
      this.bufferR[this.bufferPos] = inputR[i] ?? 0;
      this.bufferPos = (this.bufferPos + 1) % this.bufferL.length;
    }

    // Process each sample
    for (let i = fromIndex; i < toIndex; i++) {
      let outL = 0;
      let outR = 0;
      let totalEnvelope = 0;

      // Spawn new grain if needed
      this.nextGrainTime--;
      if (this.nextGrainTime <= 0) {
        for (const grain of this.grains) {
          if (!grain.active) {
            grain.active = true;
            grain.readPos = this.bufferPos;
            grain.grainPos = 0;
            grain.startBufferPos = this.bufferPos;
            this.nextGrainTime = Math.round(grainSizeSamples / this.maxGrains);
            break;
          }
        }
      }

      // Process active grains
      for (const grain of this.grains) {
        if (!grain.active) continue;

        // Hann window envelope
        const phase = grain.grainPos / grainSizeSamples;
        grain.envelope = phase < 1.0 ? 0.5 * (1 - Math.cos(Math.PI * phase)) : 0;

        // Read from buffer at pitch-scaled rate
        const readIdx = Math.floor(grain.readPos) % this.bufferL.length;
        outL += this.bufferL[readIdx] * grain.envelope;
        outR += this.bufferR[readIdx] * grain.envelope;
        totalEnvelope += grain.envelope;

        // Advance grain read position by pitch factor
        grain.readPos += this.pitchFactor;
        grain.grainPos++;

        // Deactivate grain when it exceeds grain size
        if (grain.grainPos >= grainSizeSamples) {
          grain.active = false;
        }
      }

      // Normalize output
      if (totalEnvelope > 0) {
        outputL[i] = outL / totalEnvelope;
        outputR[i] = outR / totalEnvelope;
      } else {
        outputL[i] = 0;
        outputR[i] = 0;
      }
    }
  }
}

type GrainState = {
  readPos: number;
  grainPos: number;
  envelope: number;
  active: boolean;
  startBufferPos: number;
};

/**
 * Backward compatibility: default export alias to OlaPhaseVocoder (high-quality default)
 * @deprecated Use OlaPhaseVocoder, VarispeedEffect, PsolaEffect, or GranularPitchEffect directly
 */
export { OlaPhaseVocoder as PhaseVocoder };
