/**
 * Master Limiter Effect
 *
 * Transparent brick-wall limiter for output protection.
 * Prevents clipping without audible distortion using a fast
 * attack (3ms) and smooth release (20ms).
 *
 * Based on openDAW's SimpleLimiter algorithm.
 * @see https://github.com/andremichelle/openDAW/blob/main/packages/lib/dsp/src/simple-limiter.ts
 */

import type { StereoChannels } from "./types.js";

const ATTACK_SECONDS = 0.003; // 3ms attack
const RELEASE_SECONDS = 0.02; // 20ms release

export class Limiter {
  readonly #envelopeAttack: number;
  readonly #envelopeRelease: number;
  #envelope = 0.0;
  #threshold = 1.0; // Linear threshold (default 0dB = 1.0)

  constructor(sampleRate: number) {
    // Calculate envelope coefficients
    // The formula 0.01 ** (1.0 / (time * sampleRate)) gives a smooth
    // exponential decay/attack to 1% in the given time
    this.#envelopeAttack = 0.01 ** (1.0 / (ATTACK_SECONDS * sampleRate));
    this.#envelopeRelease = 0.01 ** (1.0 / (RELEASE_SECONDS * sampleRate));
  }

  /**
   * Set threshold in dB (-60 to 0)
   * 0dB = no limiting until clipping
   * -6dB = limit at ~0.5 amplitude
   */
  setThreshold(dB: number): void {
    // Convert dB to linear: 10^(dB/20)
    this.#threshold = 10 ** (dB / 20);
  }

  reset(): void {
    this.#envelope = 0.0;
  }

  /**
   * Process audio through the limiter.
   * Modifies the buffer in place.
   */
  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const attack = this.#envelopeAttack;
    const release = this.#envelopeRelease;
    const threshold = this.#threshold;
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;
    let env = this.#envelope;

    for (let i = fromIndex; i < toIndex; i++) {
      const sampleL = inputL[i] ?? 0;
      const sampleR = inputR[i] ?? 0;

      // Get absolute peak of both channels
      const abs = Math.max(Math.abs(sampleL), Math.abs(sampleR));

      // Envelope follower with different attack/release
      // When signal is louder than envelope, use fast attack
      // When signal is quieter, use slower release
      env =
        abs > env
          ? attack * (env - abs) + abs // Attack: quick ramp up
          : release * (env - abs) + abs; // Release: slower decay

      // Apply gain reduction when envelope exceeds threshold
      if (env > threshold) {
        const gain = threshold / env;
        outputL[i] = sampleL * gain;
        outputR[i] = sampleR * gain;
      } else {
        // Pass through unchanged
        outputL[i] = sampleL;
        outputR[i] = sampleR;
      }
    }

    this.#envelope = env;
  }

  /**
   * Get current envelope value (for visualization)
   */
  getEnvelope(): number {
    return this.#envelope;
  }

  /**
   * Get current gain reduction in dB (for visualization)
   */
  getGainReductionDb(): number {
    if (this.#envelope <= this.#threshold) {
      return 0.0;
    }
    return 20 * Math.log10(this.#threshold / this.#envelope);
  }
}
