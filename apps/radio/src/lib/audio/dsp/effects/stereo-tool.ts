/**
 * Stereo Tool Effect
 *
 * Ported from openDAW StereoToolDeviceProcessor.
 */

import { dbToGain, Ramp, type StereoMatrix } from "@opendaw/lib-dsp";

export class StereoToolEffect {
  private readonly matrix: Ramp.StereoMatrixRamp;
  private readonly params: StereoMatrix.Params = {
    gain: 0.0,
    panning: 0.0,
    stereo: 0.0,
    invertL: false,
    invertR: false,
    swap: false,
  };
  private mixing = 0; // 0 = Linear, 1 = EqualPower (from openDAW)
  private needsUpdate = true;
  private processed = false;

  constructor(sampleRate: number) {
    this.matrix = Ramp.stereoMatrix(sampleRate);
  }

  setVolume(value: number): void {
    this.params.gain = dbToGain(value);
    this.needsUpdate = true;
  }

  setPanning(value: number): void {
    this.params.panning = value;
    this.needsUpdate = true;
  }

  setPanLaw(value: string): void {
    this.mixing = value === "equalPower" ? 1 : 0;
    this.needsUpdate = true;
  }

  setStereoWidth(value: number): void {
    this.params.stereo = value;
    this.needsUpdate = true;
  }

  setInvertL(value: boolean): void {
    this.params.invertL = value;
    this.needsUpdate = true;
  }

  setInvertR(value: boolean): void {
    this.params.invertR = value;
    this.needsUpdate = true;
  }

  setSwap(value: boolean): void {
    this.params.swap = value;
    this.needsUpdate = true;
  }

  reset(): void {
    this.processed = false;
    this.needsUpdate = true;
  }

  process(
    input: StereoMatrix.Channels,
    output: StereoMatrix.Channels,
    fromIndex: number,
    toIndex: number
  ): void {
    if (this.needsUpdate) {
      this.matrix.update(this.params, this.mixing, this.processed);
      this.needsUpdate = false;
    }
    this.matrix.processFrames(input, output, fromIndex, toIndex);
    this.processed = true;
  }
}
