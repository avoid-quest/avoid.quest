/**
 * Pitch shifting effects.
 *
 * Notes:
 * - VarispeedEffect is true tape-style resampling (pitch + tempo together)
 * - WsolaPitchShifter is a time-domain overlap-add pitch shifter with waveform matching
 * - PhaseVocoder is currently an alias of WSOLA in this codebase until a proper FFT/STFT
 *   implementation is introduced. This is intentionally explicit rather than shipping a fake
 *   phase vocoder with misleading behavior.
 */

import type { StereoChannels } from "./types.js";

function clampPitchFactor(value: number): number {
  return Math.max(0.25, Math.min(4.0, value));
}

function wrapIndex(index: number, length: number): number {
  const wrapped = index % length;
  return wrapped < 0 ? wrapped + length : wrapped;
}

function hermiteInterpolate(
  x0: number,
  x1: number,
  x2: number,
  x3: number,
  t: number
): number {
  const c0 = x1;
  const c1 = 0.5 * (x2 - x0);
  const c2 = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3;
  const c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);
  return ((c3 * t + c2) * t + c1) * t + c0;
}

function readHermite(buffer: Float32Array, position: number): number {
  const length = buffer.length;
  const i1 = Math.floor(position);
  const frac = position - i1;
  const i0 = wrapIndex(i1 - 1, length);
  const i2 = wrapIndex(i1 + 1, length);
  const i3 = wrapIndex(i1 + 2, length);
  return hermiteInterpolate(
    buffer[i0] ?? 0,
    buffer[wrapIndex(i1, length)] ?? 0,
    buffer[i2] ?? 0,
    buffer[i3] ?? 0,
    frac
  );
}

function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
}

function overlapCorrelation(
  buffer: Float32Array,
  ref: Float32Array,
  start: number,
  overlap: number
): number {
  let sum = 0;
  for (let i = 0; i < overlap; i++) {
    sum += (buffer[wrapIndex(start + i, buffer.length)] ?? 0) * (ref[i] ?? 0);
  }
  return sum;
}

/**
 * Tape-style resampling pitch shifter.
 * Pitch and duration change together.
 */
export class VarispeedEffect {
  private pitchFactor = 1.0;
  private smoothedPitchFactor = 1.0;
  private readonly bufferSize = 16384;
  private readonly bufferL = new Float32Array(this.bufferSize);
  private readonly bufferR = new Float32Array(this.bufferSize);
  private readPosition = 0;
  private writePosition = 0;

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

    if (Math.abs(this.pitchFactor - 1.0) < 0.0001) {
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
        (this.pitchFactor - this.smoothedPitchFactor) * 0.0025;

      outputL[i] = readHermite(this.bufferL, this.readPosition);
      outputR[i] = readHermite(this.bufferR, this.readPosition);

      this.readPosition += this.smoothedPitchFactor;
      while (this.readPosition >= this.bufferSize) {
        this.readPosition -= this.bufferSize;
      }
    }
  }
}

/**
 * WSOLA-like pitch shifter.
 *
 * This is a time-domain overlap-add algorithm with local waveform matching:
 * - synthesis hop is fixed
 * - analysis hop follows pitchFactor
 * - a short correlation search aligns the next grain to reduce boundary clicks
 */
export class WsolaPitchShifter {
  private pitchFactor = 1.0;
  private smoothedPitchFactor = 1.0;

  private readonly frameSize: number;
  private readonly hopSize: number;
  private readonly overlapSize: number;
  private readonly searchRadius: number;
  private readonly window: Float32Array;

  private readonly inputL: Float32Array;
  private readonly inputR: Float32Array;
  private readonly outputL: Float32Array;
  private readonly outputR: Float32Array;
  private readonly norm: Float32Array;
  private readonly refL: Float32Array;
  private readonly refR: Float32Array;

  private inputWrite = 0;
  private outputRead = 0;
  private outputWrite = 0;
  private sourceCenter = 0;
  private samplesUntilFrame = 0;

  constructor(frameSize: number = 1024, searchRadius: number = 128) {
    this.frameSize = frameSize;
    this.hopSize = frameSize >> 2;
    this.overlapSize = frameSize >> 1;
    this.searchRadius = searchRadius;
    this.window = hannWindow(frameSize);

    const bufferSize = frameSize * 16;
    this.inputL = new Float32Array(bufferSize);
    this.inputR = new Float32Array(bufferSize);
    this.outputL = new Float32Array(bufferSize);
    this.outputR = new Float32Array(bufferSize);
    this.norm = new Float32Array(bufferSize);
    this.refL = new Float32Array(this.overlapSize);
    this.refR = new Float32Array(this.overlapSize);
    this.samplesUntilFrame = this.hopSize;
  }

  setPitchFactor(value: number): void {
    this.pitchFactor = clampPitchFactor(value);
  }

  reset(): void {
    this.inputL.fill(0);
    this.inputR.fill(0);
    this.outputL.fill(0);
    this.outputR.fill(0);
    this.norm.fill(0);
    this.refL.fill(0);
    this.refR.fill(0);
    this.inputWrite = 0;
    this.outputRead = 0;
    this.outputWrite = 0;
    this.sourceCenter = 0;
    this.samplesUntilFrame = this.hopSize;
    this.smoothedPitchFactor = this.pitchFactor;
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputChL, inputChR] = input;
    const [outputChL, outputChR] = output;
    const inputLength = this.inputL.length;
    const outputLength = this.outputL.length;

    if (Math.abs(this.pitchFactor - 1.0) < 0.0001) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputChL[i] = inputChL[i] ?? 0;
        outputChR[i] = inputChR[i] ?? 0;
      }
      this.smoothedPitchFactor = 1.0;
      return;
    }

    for (let i = fromIndex; i < toIndex; i++) {
      this.inputL[this.inputWrite] = inputChL[i] ?? 0;
      this.inputR[this.inputWrite] = inputChR[i] ?? 0;

      this.smoothedPitchFactor +=
        (this.pitchFactor - this.smoothedPitchFactor) * 0.0025;

      this.samplesUntilFrame--;
      if (this.samplesUntilFrame <= 0) {
        this.samplesUntilFrame += this.hopSize;
        this.renderFrame();
      }

      const denom = this.norm[this.outputRead];
      if (denom > 1e-6) {
        outputChL[i] = this.outputL[this.outputRead] / denom;
        outputChR[i] = this.outputR[this.outputRead] / denom;
      } else {
        outputChL[i] = 0;
        outputChR[i] = 0;
      }

      this.outputL[this.outputRead] = 0;
      this.outputR[this.outputRead] = 0;
      this.norm[this.outputRead] = 0;

      this.inputWrite = (this.inputWrite + 1) % inputLength;
      this.outputRead = (this.outputRead + 1) % outputLength;
      this.outputWrite = (this.outputWrite + 1) % outputLength;
    }
  }

  private renderFrame(): void {
    const inputLength = this.inputL.length;
    const outputLength = this.outputL.length;
    const halfFrame = this.frameSize >> 1;
    const expectedStart = Math.floor(this.sourceCenter - halfFrame);
    let bestStart = expectedStart;

    let bestScore = -Infinity;
    for (let delta = -this.searchRadius; delta <= this.searchRadius; delta++) {
      const candidate = expectedStart + delta;
      let score = overlapCorrelation(
        this.inputL,
        this.refL,
        candidate,
        this.overlapSize
      );
      score += overlapCorrelation(
        this.inputR,
        this.refR,
        candidate,
        this.overlapSize
      );
      if (score > bestScore) {
        bestScore = score;
        bestStart = candidate;
      }
    }

    for (let i = 0; i < this.frameSize; i++) {
      const inIdx = wrapIndex(bestStart + i, inputLength);
      const outIdx = (this.outputWrite + i) % outputLength;
      const w = this.window[i] ?? 0;
      const wn = w * w;
      const sampleL = (this.inputL[inIdx] ?? 0) * w;
      const sampleR = (this.inputR[inIdx] ?? 0) * w;
      this.outputL[outIdx] += sampleL;
      this.outputR[outIdx] += sampleR;
      this.norm[outIdx] += wn;
    }

    for (let i = 0; i < this.overlapSize; i++) {
      const idx = wrapIndex(bestStart + this.frameSize - this.overlapSize + i, inputLength);
      this.refL[i] = this.inputL[idx] ?? 0;
      this.refR[i] = this.inputR[idx] ?? 0;
    }

    this.sourceCenter += this.hopSize * this.smoothedPitchFactor;
  }
}

/**
 * Temporary alias until a proper FFT/STFT phase vocoder is introduced.
 * Kept explicit for API stability and honest naming in the codebase.
 */
export class PhaseVocoder extends WsolaPitchShifter {}
export class OlaPhaseVocoder extends WsolaPitchShifter {}
