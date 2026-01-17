/**
 * AudioBuffer for DSP Processing
 *
 * A stereo audio buffer compatible with openDAW's AudioBuffer pattern.
 * Provides convenient methods for audio processing workflows.
 *
 * @see https://github.com/andremichelle/openDAW/blob/main/packages/lib/dsp/src/AudioBuffer.ts
 */

import type { StereoMatrix } from "@opendaw/lib-dsp";

/** Standard Web Audio API render quantum size */
export const RenderQuantum = 128;

export class AudioBuffer {
  static readonly Empty = new AudioBuffer(RenderQuantum);

  readonly #left: Float32Array;
  readonly #right: Float32Array;
  readonly #channels: StereoMatrix.Channels;

  constructor(size: number = RenderQuantum) {
    this.#left = new Float32Array(size);
    this.#right = new Float32Array(size);
    this.#channels = [this.#left, this.#right];
  }

  /** Get the number of samples in the buffer */
  get length(): number {
    return this.#left.length;
  }

  /** Get the left channel */
  get left(): Float32Array {
    return this.#left;
  }

  /** Get the right channel */
  get right(): Float32Array {
    return this.#right;
  }

  /** Get both channels as a tuple (openDAW compatible) */
  channels(): StereoMatrix.Channels {
    return this.#channels;
  }

  /** Get a specific channel by index (openDAW compatible) */
  getChannel(index: number): Float32Array {
    return index === 0 ? this.#left : this.#right;
  }

  /** Clear the buffer (fill with zeros) */
  clear(start?: number, end?: number): void {
    this.#left.fill(0.0, start, end);
    this.#right.fill(0.0, start, end);
  }

  /** Copy this buffer's contents into another buffer (openDAW compatible) */
  replace(target: AudioBuffer): void {
    target.#left.set(this.#left);
    target.#right.set(this.#right);
  }

  /** Mix this buffer into a target (additive) */
  mixInto(
    target: StereoMatrix.Channels,
    fromIndex = 0,
    toIndex = this.length
  ): void {
    const [targetL, targetR] = target;
    for (let i = fromIndex; i < toIndex; i++) {
      targetL[i] += this.#left[i];
      targetR[i] += this.#right[i];
    }
  }

  /** Copy from source channels into this buffer */
  copyFrom(
    source: StereoMatrix.Channels,
    fromIndex = 0,
    toIndex = this.length
  ): void {
    const [sourceL, sourceR] = source;
    for (let i = fromIndex; i < toIndex; i++) {
      this.#left[i] = sourceL[i];
      this.#right[i] = sourceR[i];
    }
  }

  /** Apply gain to the buffer */
  applyGain(gain: number, fromIndex = 0, toIndex = this.length): void {
    for (let i = fromIndex; i < toIndex; i++) {
      this.#left[i] *= gain;
      this.#right[i] *= gain;
    }
  }

  /** Apply stereo gain (different gain per channel) */
  applyStereoGain(
    leftGain: number,
    rightGain: number,
    fromIndex = 0,
    toIndex = this.length
  ): void {
    for (let i = fromIndex; i < toIndex; i++) {
      this.#left[i] *= leftGain;
      this.#right[i] *= rightGain;
    }
  }
}
