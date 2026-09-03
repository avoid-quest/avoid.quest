import { clamp, dbToGain } from "./stock-effect-utils.js";
import type { StereoChannels } from "./types.js";

export type WaveshaperShape =
  | "hardclip"
  | "cubic"
  | "tanh"
  | "sigmoid"
  | "arctan"
  | "asymmetric";

export class WaveshaperEffect {
  private shape: WaveshaperShape = "tanh";
  private drive = 1;
  private output = 1;
  private mix = 1;

  setCurve(value: string): void {
    const shapes: Record<string, WaveshaperShape> = {
      arctan: "arctan",
      asymmetric: "asymmetric",
      cubicSoft: "cubic",
      hardClip: "hardclip",
      hardclip: "hardclip",
      sigmoid: "sigmoid",
      tanh: "tanh",
    };
    const shape = shapes[value];
    if (shape) {
      this.shape = shape;
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

  private compute(value: number): number {
    switch (this.shape) {
      case "hardclip":
        return clamp(value, -1, 1);
      case "cubic": {
        const x = clamp(value, -1.5, 1.5);
        return x - (x * x * x) / 3;
      }
      case "sigmoid":
        return 2 / (1 + Math.exp(-2 * value)) - 1;
      case "arctan":
        return (2 / Math.PI) * Math.atan(value);
      case "asymmetric":
        return value >= 0 ? Math.tanh(value) : Math.tanh(value * 0.55) * 1.3;
      default:
        return Math.tanh(value);
    }
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    for (let i = fromIndex; i < toIndex; i += 1) {
      const left = input[0][i] ?? 0;
      const right = input[1][i] ?? 0;
      output[0][i] =
        left * (1 - this.mix) +
        this.compute(left * this.drive) * this.output * this.mix;
      output[1][i] =
        right * (1 - this.mix) +
        this.compute(right * this.drive) * this.output * this.mix;
    }
  }
}
