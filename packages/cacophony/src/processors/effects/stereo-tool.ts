import { dbToGain, Ramp, type StereoMatrix } from "@opendaw/lib-dsp";
import { type int } from "@opendaw/lib-std";

/**
 * Stereo tool effect
 * Ported from openDAW StereoToolDeviceProcessor
 */
export class StereoToolEffect {
  private readonly sampleRate: number;
  private readonly matrix: Ramp.StereoMatrixRamp;
  private readonly params: StereoMatrix.Params = {
    gain: 0.0,
    panning: 0.0,
    stereo: 0.0,
    invertL: false,
    invertR: false,
    swap: false,
  };
  private mixing: number = 0; // 0 = Linear, 1 = EqualPower (from openDAW)
  private needsUpdate = true;
  private processed = false;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
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
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): void {
    if (this.needsUpdate) {
      this.matrix.update(this.params, this.mixing, this.processed);
      this.needsUpdate = false;
    }
    const source: StereoMatrix.Channels = [inputL, inputR];
    const target: StereoMatrix.Channels = [outputL, outputR];
    this.matrix.processFrames(source, target, fromIndex, toIndex);
    this.processed = true;
  }
}
