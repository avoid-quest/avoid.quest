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

function clampPitchFactor(value: number): number {
  return Math.max(0.25, Math.min(4.0, value));
}

function wrapIndex(index: number, length: number): number {
  const wrapped = index % length;
  return wrapped < 0 ? wrapped + length : wrapped;
}

function smoothstepWindow(phase: number): number {
  const x = Math.max(0, Math.min(1, phase));
  return Math.sin(Math.PI * x);
}

function cubicInterpolate(
  y0: number,
  y1: number,
  y2: number,
  y3: number,
  t: number
): number {
  const a0 = y3 - y2 - y0 + y1;
  const a1 = y0 - y1 - a0;
  const a2 = y2 - y0;
  const a3 = y1;
  return ((a0 * t + a1) * t + a2) * t + a3;
}

function readCubic(buffer: Float32Array, position: number): number {
  const length = buffer.length;
  const x1 = Math.floor(position);
  const t = position - x1;
  const x0 = wrapIndex(x1 - 1, length);
  const x2 = wrapIndex(x1 + 1, length);
  const x3 = wrapIndex(x1 + 2, length);
  return cubicInterpolate(
    buffer[x0] ?? 0,
    buffer[wrapIndex(x1, length)] ?? 0,
    buffer[x2] ?? 0,
    buffer[x3] ?? 0,
    t
  );
}

function readLinear(buffer: Float32Array, position: number): number {
  const length = buffer.length;
  const i0 = Math.floor(position);
  const frac = position - i0;
  const idx0 = wrapIndex(i0, length);
  const idx1 = wrapIndex(i0 + 1, length);
  const a = buffer[idx0] ?? 0;
  const b = buffer[idx1] ?? 0;
  return a + (b - a) * frac;
}

/**
 * Simple linear resampling pitch shifter.
 * This changes both pitch AND tempo together (like speeding up/slowing down a tape).
 * - pitchFactor < 1.0 = slower + lower pitch
 * - pitchFactor > 1.0 = faster + higher pitch
 */
export class VarispeedEffect {
  private pitchFactor = 1.0;
  private smoothedPitchFactor = 1.0;

  private readonly bufferSize = 8192;
  private readonly bufferL: Float32Array;
  private readonly bufferR: Float32Array;
  private readPosition = 0;
  private writePosition = 0;

  constructor() {
    this.bufferL = new Float32Array(this.bufferSize);
    this.bufferR = new Float32Array(this.bufferSize);
  }

  setPitchFactor(value: number): void {
    this.pitchFactor = clampPitchFactor(value);
  }

  reset(): void {
    this.bufferL.fill(0);
    this.bufferR.fill(0);
    this.readPosition = 0;
    this.writePosition = 0;
    this.smoothedPitchFactor = this.pitchFactor;
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
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = inputL[i] ?? 0;
        outputR[i] = inputR[i] ?? 0;
      }
      this.smoothedPitchFactor = 1.0;
      return;
    }

    for (let i = fromIndex; i < toIndex; i++) {
      this.bufferL[this.writePosition] = inputL[i] ?? 0;
      this.bufferR[this.writePosition] = inputR[i] ?? 0;
      this.writePosition = (this.writePosition + 1) & (this.bufferSize - 1);
    }

    for (let i = fromIndex; i < toIndex; i++) {
      this.smoothedPitchFactor +=
        (this.pitchFactor - this.smoothedPitchFactor) * 0.01;

      outputL[i] = readCubic(this.bufferL, this.readPosition);
      outputR[i] = readCubic(this.bufferR, this.readPosition);

      this.readPosition += this.smoothedPitchFactor;
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
  private smoothedPitchFactor = 1.0;
  private readonly grainSize: number;
  private readonly hopSize: number;
  private readonly window: Float32Array;
  private readonly normalization: Float32Array;
  private readonly bufferL: Float32Array;
  private readonly bufferR: Float32Array;
  private readonly outBufL: Float32Array;
  private readonly outBufR: Float32Array;
  private readonly normBuf: Float32Array;
  private writePosition = 0;
  private outRead = 0;
  private outWrite = 0;
  private analysisCenter = 0;
  private samplesUntilNextGrain = 0;

  constructor(grainSize: number = 2048) {
    this.grainSize = grainSize;
    this.hopSize = grainSize >> 3;
    this.window = new Float32Array(grainSize);
    this.normalization = new Float32Array(grainSize);
    for (let i = 0; i < grainSize; i++) {
      const phase = i / (grainSize - 1);
      const w = smoothstepWindow(phase);
      this.window[i] = w;
      this.normalization[i] = w * w;
    }

    const bufLen = grainSize * 8;
    this.bufferL = new Float32Array(bufLen);
    this.bufferR = new Float32Array(bufLen);
    this.outBufL = new Float32Array(bufLen);
    this.outBufR = new Float32Array(bufLen);
    this.normBuf = new Float32Array(bufLen);
    this.samplesUntilNextGrain = this.hopSize;
  }

  setPitchFactor(value: number): void {
    this.pitchFactor = clampPitchFactor(value);
  }

  reset(): void {
    this.bufferL.fill(0);
    this.bufferR.fill(0);
    this.outBufL.fill(0);
    this.outBufR.fill(0);
    this.normBuf.fill(0);
    this.writePosition = 0;
    this.outRead = 0;
    this.outWrite = 0;
    this.analysisCenter = 0;
    this.samplesUntilNextGrain = this.hopSize;
    this.smoothedPitchFactor = this.pitchFactor;
  }

  process(input: StereoChannels, output: StereoChannels, fromIndex: number, toIndex: number): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;
    const bufferLength = this.bufferL.length;

    if (Math.abs(this.pitchFactor - 1.0) < 0.001) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = inputL[i] ?? 0;
        outputR[i] = inputR[i] ?? 0;
      }
      this.smoothedPitchFactor = 1.0;
      return;
    }

    for (let i = fromIndex; i < toIndex; i++) {
      this.bufferL[this.writePosition] = inputL[i] ?? 0;
      this.bufferR[this.writePosition] = inputR[i] ?? 0;

      this.smoothedPitchFactor += (this.pitchFactor - this.smoothedPitchFactor) * 0.005;
      this.samplesUntilNextGrain--;
      if (this.samplesUntilNextGrain <= 0) {
        this.spawnGrain();
        this.samplesUntilNextGrain += this.hopSize;
      }

      const norm = this.normBuf[this.outRead] || 1;
      outputL[i] = this.outBufL[this.outRead] / norm;
      outputR[i] = this.outBufR[this.outRead] / norm;
      this.outBufL[this.outRead] = 0;
      this.outBufR[this.outRead] = 0;
      this.normBuf[this.outRead] = 0;

      this.writePosition = (this.writePosition + 1) % bufferLength;
      this.outRead = (this.outRead + 1) % bufferLength;
      this.outWrite = (this.outWrite + 1) % bufferLength;
    }
  }

  private spawnGrain(): void {
    const bufferLength = this.bufferL.length;
    const half = this.grainSize >> 1;
    const sourceStart = this.analysisCenter - half;

    for (let i = 0; i < this.grainSize; i++) {
      const windowValue = this.window[i] ?? 0;
      const normValue = this.normalization[i] ?? 0;
      const sourcePosition = sourceStart + i / this.smoothedPitchFactor;
      const sampleL = readCubic(this.bufferL, sourcePosition) * windowValue;
      const sampleR = readCubic(this.bufferR, sourcePosition) * windowValue;
      const outIndex = (this.outWrite + i) % bufferLength;
      this.outBufL[outIndex] += sampleL;
      this.outBufR[outIndex] += sampleR;
      this.normBuf[outIndex] += normValue;
    }

    this.analysisCenter += this.hopSize / this.smoothedPitchFactor;
  }
}

/**
 * PSOLA (Pitch-Synchronous Overlap-Add)
 * Time-domain pitch shifting without FFT.
 * Good balance between quality and CPU cost.
 */
export class PsolaEffect {
  private pitchFactor = 1.0;
  private smoothedPitchFactor = 1.0;
  private readonly periodSize: number;
  private readonly grainSize: number;
  private readonly bufferSize: number;
  private readonly bufferL: Float32Array;
  private readonly bufferR: Float32Array;
  private readonly outBufL: Float32Array;
  private readonly outBufR: Float32Array;
  private readonly normBuf: Float32Array;
  private writePos = 0;
  private outRead = 0;
  private outWrite = 0;
  private sourceAnchor = 0;
  private samplesUntilPulse = 0;

  constructor() {
    this.periodSize = 384;
    this.grainSize = this.periodSize * 2;
    this.bufferSize = this.periodSize * 16;
    this.bufferL = new Float32Array(this.bufferSize);
    this.bufferR = new Float32Array(this.bufferSize);
    this.outBufL = new Float32Array(this.bufferSize);
    this.outBufR = new Float32Array(this.bufferSize);
    this.normBuf = new Float32Array(this.bufferSize);
    this.samplesUntilPulse = this.periodSize >> 1;
  }

  setPitchFactor(value: number): void {
    this.pitchFactor = clampPitchFactor(value);
  }

  reset(): void {
    this.bufferL.fill(0);
    this.bufferR.fill(0);
    this.outBufL.fill(0);
    this.outBufR.fill(0);
    this.normBuf.fill(0);
    this.writePos = 0;
    this.outRead = 0;
    this.outWrite = 0;
    this.sourceAnchor = 0;
    this.samplesUntilPulse = this.periodSize >> 1;
    this.smoothedPitchFactor = this.pitchFactor;
  }

  process(input: StereoChannels, output: StereoChannels, fromIndex: number, toIndex: number): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;

    if (Math.abs(this.pitchFactor - 1.0) < 0.001) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = inputL[i] ?? 0;
        outputR[i] = inputR[i] ?? 0;
      }
      this.smoothedPitchFactor = 1.0;
      return;
    }

    for (let i = fromIndex; i < toIndex; i++) {
      this.bufferL[this.writePos] = inputL[i] ?? 0;
      this.bufferR[this.writePos] = inputR[i] ?? 0;

      this.smoothedPitchFactor += (this.pitchFactor - this.smoothedPitchFactor) * 0.01;
      this.samplesUntilPulse--;
      if (this.samplesUntilPulse <= 0) {
        this.spawnPulse();
        this.samplesUntilPulse += Math.max(32, Math.round((this.periodSize >> 1) / this.smoothedPitchFactor));
      }

      const norm = this.normBuf[this.outRead] || 1;
      outputL[i] = this.outBufL[this.outRead] / norm;
      outputR[i] = this.outBufR[this.outRead] / norm;
      this.outBufL[this.outRead] = 0;
      this.outBufR[this.outRead] = 0;
      this.normBuf[this.outRead] = 0;

      this.writePos = (this.writePos + 1) % this.bufferSize;
      this.outRead = (this.outRead + 1) % this.bufferSize;
      this.outWrite = (this.outWrite + 1) % this.bufferSize;
    }
  }

  private spawnPulse(): void {
    const half = this.grainSize >> 1;
    const start = this.sourceAnchor - half;

    for (let i = 0; i < this.grainSize; i++) {
      const phase = i / (this.grainSize - 1);
      const windowValue = smoothstepWindow(phase);
      const sourcePosition = start + i / this.smoothedPitchFactor;
      const outIndex = (this.outWrite + i) % this.bufferSize;
      this.outBufL[outIndex] += readLinear(this.bufferL, sourcePosition) * windowValue;
      this.outBufR[outIndex] += readLinear(this.bufferR, sourcePosition) * windowValue;
      this.normBuf[outIndex] += windowValue * windowValue;
    }

    this.sourceAnchor += this.periodSize / this.smoothedPitchFactor;
  }
}

/**
 * Granular Pitch Shifting
 * Overlapping grains with pitch-scaled playback.
 * Flexible grain size parameter.
 */
export class GranularPitchEffect {
  private pitchFactor = 1.0;
  private smoothedPitchFactor = 1.0;
  private grainSizeMs = 50;
  private readonly sampleRate: number;
  private readonly maxGrains = 6;
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
    this.pitchFactor = clampPitchFactor(value);
  }

  setGrainSize(sizeMs: number): void {
    this.grainSizeMs = Math.max(10, Math.min(200, sizeMs));
  }

  reset(): void {
    this.bufferL.fill(0);
    this.bufferR.fill(0);
    this.bufferPos = 0;
    this.nextGrainTime = 0;
    this.smoothedPitchFactor = this.pitchFactor;
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
    const grainSizeSamples = Math.max(
      64,
      Math.round((this.grainSizeMs * this.sampleRate) / 1000)
    );

    for (let i = fromIndex; i < toIndex; i++) {
      this.bufferL[this.bufferPos] = inputL[i] ?? 0;
      this.bufferR[this.bufferPos] = inputR[i] ?? 0;

      this.smoothedPitchFactor +=
        (this.pitchFactor - this.smoothedPitchFactor) * 0.01;

      let outL = 0;
      let outR = 0;
      let totalEnvelope = 0;

      this.nextGrainTime--;
      if (this.nextGrainTime <= 0) {
        for (const grain of this.grains) {
          if (!grain.active) {
            grain.active = true;
            grain.readPos = this.bufferPos - grainSizeSamples;
            grain.grainPos = 0;
            grain.startBufferPos = this.bufferPos;
            this.nextGrainTime = Math.max(
              16,
              Math.round(grainSizeSamples / this.maxGrains)
            );
            break;
          }
        }
      }

      for (const grain of this.grains) {
        if (!grain.active) continue;

        const phase = grain.grainPos / (grainSizeSamples - 1);
        grain.envelope = phase < 1.0 ? smoothstepWindow(phase) : 0;

        const sampleL = readLinear(this.bufferL, grain.readPos);
        const sampleR = readLinear(this.bufferR, grain.readPos);
        outL += sampleL * grain.envelope;
        outR += sampleR * grain.envelope;
        totalEnvelope += grain.envelope * grain.envelope;

        grain.readPos += this.smoothedPitchFactor;
        grain.grainPos++;

        if (grain.grainPos >= grainSizeSamples) {
          grain.active = false;
        }
      }

      if (totalEnvelope > 1e-6) {
        outputL[i] = outL / totalEnvelope;
        outputR[i] = outR / totalEnvelope;
      } else {
        outputL[i] = 0;
        outputR[i] = 0;
      }

      this.bufferPos = (this.bufferPos + 1) % this.bufferL.length;
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
