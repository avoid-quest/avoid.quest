import { clamp, dbToGain } from "./stock-effect-utils.js";
import type { StereoChannels } from "./types.js";

export class CheapReverbEffect {
  private readonly delays: Float32Array[];
  private readonly indices: number[];
  private readonly preDelayL: Float32Array;
  private readonly preDelayR: Float32Array;
  private preDelayIndex = 0;
  private preDelaySamples = 0;
  private roomSize = 0.72;
  private damping = 0.35;
  private width = 1;
  private filter = 0;
  private dry = 0;
  private wet = 1;
  private filteredL = 0;
  private filteredR = 0;
  private readonly dampState = [0, 0, 0, 0];

  constructor(sampleRate: number) {
    this.delays = [0.0297, 0.0371, 0.0411, 0.0437].map(
      (seconds) =>
        new Float32Array(Math.max(1, Math.round(seconds * sampleRate)))
    );
    this.indices = this.delays.map(() => 0);
    this.preDelayL = new Float32Array(Math.ceil(sampleRate * 0.5) + 1);
    this.preDelayR = new Float32Array(this.preDelayL.length);
  }

  setRoomSize(value: number): void {
    this.roomSize = clamp(value, 0, 0.98);
  }

  setDamping(value: number): void {
    this.damping = clamp(value, 0, 0.99);
  }

  setWidth(value: number): void {
    this.width = clamp(value, 0, 1);
  }

  setDecay(value: number): void {
    this.setRoomSize(value);
  }

  setPreDelay(value: number): void {
    this.preDelaySamples = Math.round(
      clamp(value, 0, 0.5) * (this.preDelayL.length - 1) * 2
    );
  }

  setDamp(value: number): void {
    this.setDamping(value);
  }

  setFilter(value: number): void {
    this.filter = clamp(value, -1, 1);
  }

  setDry(value: number): void {
    this.dry = dbToGain(value);
  }

  setWet(value: number): void {
    this.wet = dbToGain(value);
  }

  reset(): void {
    for (const delay of this.delays) {
      delay.fill(0);
    }
    this.indices.fill(0);
    this.dampState.fill(0);
    this.preDelayL.fill(0);
    this.preDelayR.fill(0);
    this.preDelayIndex = 0;
    this.filteredL = 0;
    this.filteredR = 0;
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;
    for (let i = fromIndex; i < toIndex; i += 1) {
      const inputSampleL = inputL[i] ?? 0;
      const inputSampleR = inputR[i] ?? 0;
      this.preDelayL[this.preDelayIndex] = inputSampleL;
      this.preDelayR[this.preDelayIndex] = inputSampleR;
      const readIndex =
        (this.preDelayIndex -
          Math.min(this.preDelaySamples, this.preDelayL.length - 1) +
          this.preDelayL.length) %
        this.preDelayL.length;
      const mono =
        ((this.preDelayL[readIndex] ?? 0) + (this.preDelayR[readIndex] ?? 0)) *
        0.5;
      this.preDelayIndex = (this.preDelayIndex + 1) % this.preDelayL.length;
      let even = 0;
      let odd = 0;
      for (let line = 0; line < this.delays.length; line += 1) {
        const delay = this.delays[line];
        const index = this.indices[line] ?? 0;
        const delayed = delay?.[index] ?? 0;
        const damped =
          delayed * (1 - this.damping) +
          (this.dampState[line] ?? 0) * this.damping;
        this.dampState[line] = damped;
        if (delay) {
          delay[index] = mono + damped * this.roomSize;
          this.indices[line] = (index + 1) % delay.length;
        }
        if (line % 2 === 0) {
          even += delayed;
        } else {
          odd += delayed;
        }
      }
      const mid = (even + odd) * 0.25;
      const side = (even - odd) * 0.25 * this.width;
      const filterCoefficient = 0.02 + (this.filter + 1) * 0.5 * 0.96;
      this.filteredL += (mid + side - this.filteredL) * filterCoefficient;
      this.filteredR += (mid - side - this.filteredR) * filterCoefficient;
      outputL[i] = inputSampleL * this.dry + this.filteredL * this.wet;
      outputR[i] = inputSampleR * this.dry + this.filteredR * this.wet;
    }
  }
}
