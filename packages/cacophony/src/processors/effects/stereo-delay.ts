import { type int, type unitValue } from "@opendaw/lib-std";
import { Delay } from "./delay.js";

export class StereoDelay {
  private delayL: Delay;
  private delayR: Delay;

  constructor(maxFrames: int, interpolationLength: int) {
    this.delayL = new Delay(maxFrames, interpolationLength);
    this.delayR = new Delay(maxFrames, interpolationLength);
  }

  reset(): void {
    this.delayL.reset();
    this.delayR.reset();
  }

  set offset(value: number) {
    this.delayL.offset = value;
    this.delayR.offset = value;
  }

  get offset(): number {
    return this.delayL.offset;
  }

  set feedback(value: unitValue) {
    this.delayL.feedback = value;
    this.delayR.feedback = value;
  }

  get feedback(): unitValue {
    return this.delayL.feedback;
  }

  mix(wet: unitValue, dry: unitValue): void {
    this.delayL.mix(wet, dry);
    this.delayR.mix(wet, dry);
  }

  process(
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): void {
    this.delayL.process(inputL, outputL, fromIndex, toIndex);
    this.delayR.process(inputR, outputR, fromIndex, toIndex);
  }
}
