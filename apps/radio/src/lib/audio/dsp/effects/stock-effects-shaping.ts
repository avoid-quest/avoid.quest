import { Waveshaper } from "@opendaw/lib-dsp";
import { clamp, dbToGain } from "./stock-effect-utils.js";
import type { StereoChannels } from "./types.js";

export class WaveshaperEffect {
  private equation: Waveshaper.Equation = "tanh";
  private drive = 1;
  private output = 1;
  private mix = 1;

  setCurve(value: string): void {
    // Legacy configs spell the hard clip curve "hardClip".
    const name = value === "hardClip" ? "hardclip" : value;
    const equation = Waveshaper.Equations.find((option) => option === name);
    if (equation) {
      this.equation = equation;
    }
  }

  setDrive(value: number): void {
    this.drive = dbToGain(clamp(value, -24, 48));
  }

  setOutput(value: number): void {
    this.output = dbToGain(clamp(value, -48, 24));
  }

  setMix(value: number): void {
    this.mix = clamp(value, 0, 1);
  }

  reset(): void {
    // Stateless processor.
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const wet = this.output * this.mix;
    for (let i = fromIndex; i < toIndex; i += 1) {
      const left = input[0][i] ?? 0;
      const right = input[1][i] ?? 0;
      output[0][i] =
        left * (1 - this.mix) +
        Waveshaper.apply(left * this.drive, this.equation) * wet;
      output[1][i] =
        right * (1 - this.mix) +
        Waveshaper.apply(right * this.drive, this.equation) * wet;
    }
  }
}
