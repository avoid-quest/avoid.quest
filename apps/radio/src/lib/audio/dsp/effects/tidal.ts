// SPDX-License-Identifier: AGPL-3.0-or-later
// Derived from openDAW; see THIRD_PARTY_NOTICES.md for attribution and changes.
/**
 * Tidal Rhythm Shaping Effect
 *
 * Ported from openDAW TidalDeviceProcessor.
 * Note: This is a simplified version that doesn't require BPM/time info.
 */

import { Smooth, TidalComputer } from "@opendaw/lib-dsp";
import { clampEffectTempo } from "./tempo.js";

const fractionToBeats = (value: string): number => {
  const [numerator, denominator] = value.split("/").map(Number);
  return numerator && denominator ? (numerator * 4) / denominator : 1;
};

export class TidalEffect {
  private readonly sampleRate: number;
  private readonly computer: TidalComputer;
  private readonly smoothGainL: Smooth;
  private readonly smoothGainR: Smooth;

  private rate = 1.0; // LFO frequency in Hz (1.0 = 1 cycle per second)
  private tempo = 120;
  private tempoSync = false as boolean;
  private tempoDivision = "1/4";
  private depth = 0.0;
  private slope = 0.0;
  private symmetry = 0.0;
  private offset = 0.0; // Phase offset in cycles (0-1)
  private channelOffset = 0.0; // Channel offset in cycles (0-1)
  private phase = 0.0;
  private needsUpdate = true as boolean;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.computer = new TidalComputer();
    this.smoothGainL = new Smooth(0.003, sampleRate);
    this.smoothGainR = new Smooth(0.003, sampleRate);
  }

  setRate(value: number): void {
    this.rate = value;
  }

  setTempo(value: number): void {
    this.tempo = clampEffectTempo(value);
  }

  setTempoSync(value: boolean): void {
    this.tempoSync = value;
  }

  setTempoDivision(value: string): void {
    this.tempoDivision = value;
  }

  setRateDivision(value: string): void {
    this.tempoDivision = value;
    this.tempoSync = true;
  }

  setDepth(value: number): void {
    this.depth = value;
    this.needsUpdate = true;
  }

  setSlope(value: number): void {
    this.slope = value;
    this.needsUpdate = true;
  }

  setSymmetry(value: number): void {
    this.symmetry = value;
    this.needsUpdate = true;
  }

  setOffset(value: number): void {
    // Convert from degrees (0-360) to cycles (0-1)
    this.offset = value / 360.0;
  }

  setChannelOffset(value: number): void {
    // Convert from degrees (0-360) to cycles (0-1)
    this.channelOffset = value / 360.0;
  }

  reset(): void {
    this.phase = 0.0;
    this.needsUpdate = true;
  }

  process(
    input: [Float32Array, Float32Array],
    output: [Float32Array, Float32Array],
    fromIndex: number,
    toIndex: number
  ): void {
    if (this.needsUpdate) {
      this.computer.set(this.depth, this.slope, this.symmetry);
      this.needsUpdate = false;
    }

    const [inputL, inputR] = input;
    const [outputL, outputR] = output;
    const offset0 = this.offset;
    const offset1 = offset0 + this.channelOffset;
    const rate = this.tempoSync
      ? this.tempo / 60 / fractionToBeats(this.tempoDivision)
      : this.rate;
    const phaseIncrement = rate / this.sampleRate;

    for (let i = fromIndex; i < toIndex; i += 1) {
      const phaseL = this.phase + i * phaseIncrement + offset0;
      const phaseR = this.phase + i * phaseIncrement + offset1;

      const gainL = this.smoothGainL.process(
        this.computer.compute(phaseL - Math.floor(phaseL))
      );
      const gainR = this.smoothGainR.process(
        this.computer.compute(phaseR - Math.floor(phaseR))
      );

      outputL[i] = (inputL[i] ?? 0) * gainL;
      outputR[i] = (inputR[i] ?? 0) * gainR;
    }

    this.phase += (toIndex - fromIndex) * phaseIncrement;
    // Wrap phase to prevent overflow
    if (this.phase > 1.0) {
      this.phase -= Math.floor(this.phase);
    }
  }
}
