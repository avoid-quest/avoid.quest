/**
 * Multi-band EQ Effect
 *
 * Ported from openDAW RevampDeviceProcessor.
 * 7-band parametric EQ with highpass, lowpass, shelving, and peaking filters.
 */

import {
  BiquadCoeff,
  BiquadMono,
  type BiquadProcessor,
  BiquadStack,
} from "@opendaw/lib-dsp";
import { Arrays } from "@opendaw/lib-std";

export class RevampEffect {
  private readonly sampleRate: number;
  private readonly biquadCoeff: readonly BiquadCoeff[];
  private readonly biquadLowPassProcessors: [BiquadStack, BiquadStack];
  private readonly biquadHighPassProcessors: [BiquadStack, BiquadStack];
  private readonly biquadProcessors: Array<
    [BiquadProcessor, BiquadProcessor] | [BiquadStack, BiquadStack]
  >;
  private readonly enabled: boolean[];

  // Highpass
  private highPassEnabled = true;
  private highPassFrequency = 20;
  private highPassQ = Math.SQRT1_2;
  private highPassOrder = 1;

  // Low shelf
  private lowShelfEnabled = true;
  private lowShelfFrequency = 80;
  private lowShelfGain = 0;

  // Low bell
  private lowBellEnabled = true;
  private lowBellFrequency = 200;
  private lowBellGain = 0;
  private lowBellQ = Math.SQRT1_2;

  // Mid bell
  private midBellEnabled = true;
  private midBellFrequency = 1000;
  private midBellGain = 0;
  private midBellQ = Math.SQRT1_2;

  // High bell
  private highBellEnabled = true;
  private highBellFrequency = 5000;
  private highBellGain = 0;
  private highBellQ = Math.SQRT1_2;

  // High shelf
  private highShelfEnabled = true;
  private highShelfFrequency = 10_000;
  private highShelfGain = 0;

  // Lowpass
  private lowPassEnabled = true;
  private lowPassFrequency = 20_000;
  private lowPassQ = Math.SQRT1_2;
  private lowPassOrder = 1;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.biquadCoeff = Arrays.create(() => new BiquadCoeff(), 7);
    this.biquadLowPassProcessors = [new BiquadStack(4), new BiquadStack(4)];
    this.biquadHighPassProcessors = [new BiquadStack(4), new BiquadStack(4)];
    this.biquadProcessors = [
      this.biquadHighPassProcessors,
      [new BiquadMono(), new BiquadMono()],
      [new BiquadMono(), new BiquadMono()],
      [new BiquadMono(), new BiquadMono()],
      [new BiquadMono(), new BiquadMono()],
      [new BiquadMono(), new BiquadMono()],
      this.biquadLowPassProcessors,
    ];
    this.enabled = Arrays.create(() => true, 7);
    this.updateCoefficients();
  }

  private updateCoefficients(): void {
    // Highpass
    if (this.highPassEnabled) {
      this.biquadCoeff[0]?.setHighpassParams(
        this.highPassFrequency / this.sampleRate,
        this.highPassQ
      );
      this.biquadHighPassProcessors[0].order = this.highPassOrder;
      this.biquadHighPassProcessors[1].order = this.highPassOrder;
    }

    // Low shelf
    if (this.lowShelfEnabled) {
      this.biquadCoeff[1]?.setLowShelfParams(
        this.lowShelfFrequency / this.sampleRate,
        this.lowShelfGain
      );
    }

    // Low bell
    if (this.lowBellEnabled) {
      this.biquadCoeff[2]?.setPeakingParams(
        this.lowBellFrequency / this.sampleRate,
        this.lowBellQ,
        this.lowBellGain
      );
    }

    // Mid bell
    if (this.midBellEnabled) {
      this.biquadCoeff[3]?.setPeakingParams(
        this.midBellFrequency / this.sampleRate,
        this.midBellQ,
        this.midBellGain
      );
    }

    // High bell
    if (this.highBellEnabled) {
      this.biquadCoeff[4]?.setPeakingParams(
        this.highBellFrequency / this.sampleRate,
        this.highBellQ,
        this.highBellGain
      );
    }

    // High shelf
    if (this.highShelfEnabled) {
      this.biquadCoeff[5]?.setHighShelfParams(
        this.highShelfFrequency / this.sampleRate,
        this.highShelfGain
      );
    }

    // Lowpass
    if (this.lowPassEnabled) {
      this.biquadCoeff[6]?.setLowpassParams(
        this.lowPassFrequency / this.sampleRate,
        this.lowPassQ
      );
      this.biquadLowPassProcessors[0].order = this.lowPassOrder;
      this.biquadLowPassProcessors[1].order = this.lowPassOrder;
    }
  }

  // Highpass setters
  setHighPassEnabled(value: boolean): void {
    this.highPassEnabled = value;
    this.enabled[0] = value;
    this.updateCoefficients();
  }

  setHighPassFrequency(value: number): void {
    this.highPassFrequency = value;
    this.updateCoefficients();
  }

  setHighPassQ(value: number): void {
    this.highPassQ = value;
    this.updateCoefficients();
  }

  setHighPassOrder(value: number): void {
    this.highPassOrder = value;
    this.updateCoefficients();
  }

  // Low shelf setters
  setLowShelfEnabled(value: boolean): void {
    this.lowShelfEnabled = value;
    this.enabled[1] = value;
    this.updateCoefficients();
  }

  setLowShelfFrequency(value: number): void {
    this.lowShelfFrequency = value;
    this.updateCoefficients();
  }

  setLowShelfGain(value: number): void {
    this.lowShelfGain = value;
    this.updateCoefficients();
  }

  // Low bell setters
  setLowBellEnabled(value: boolean): void {
    this.lowBellEnabled = value;
    this.enabled[2] = value;
    this.updateCoefficients();
  }

  setLowBellFrequency(value: number): void {
    this.lowBellFrequency = value;
    this.updateCoefficients();
  }

  setLowBellGain(value: number): void {
    this.lowBellGain = value;
    this.updateCoefficients();
  }

  setLowBellQ(value: number): void {
    this.lowBellQ = value;
    this.updateCoefficients();
  }

  // Mid bell setters
  setMidBellEnabled(value: boolean): void {
    this.midBellEnabled = value;
    this.enabled[3] = value;
    this.updateCoefficients();
  }

  setMidBellFrequency(value: number): void {
    this.midBellFrequency = value;
    this.updateCoefficients();
  }

  setMidBellGain(value: number): void {
    this.midBellGain = value;
    this.updateCoefficients();
  }

  setMidBellQ(value: number): void {
    this.midBellQ = value;
    this.updateCoefficients();
  }

  // High bell setters
  setHighBellEnabled(value: boolean): void {
    this.highBellEnabled = value;
    this.enabled[4] = value;
    this.updateCoefficients();
  }

  setHighBellFrequency(value: number): void {
    this.highBellFrequency = value;
    this.updateCoefficients();
  }

  setHighBellGain(value: number): void {
    this.highBellGain = value;
    this.updateCoefficients();
  }

  setHighBellQ(value: number): void {
    this.highBellQ = value;
    this.updateCoefficients();
  }

  // High shelf setters
  setHighShelfEnabled(value: boolean): void {
    this.highShelfEnabled = value;
    this.enabled[5] = value;
    this.updateCoefficients();
  }

  setHighShelfFrequency(value: number): void {
    this.highShelfFrequency = value;
    this.updateCoefficients();
  }

  setHighShelfGain(value: number): void {
    this.highShelfGain = value;
    this.updateCoefficients();
  }

  // Lowpass setters
  setLowPassEnabled(value: boolean): void {
    this.lowPassEnabled = value;
    this.enabled[6] = value;
    this.updateCoefficients();
  }

  setLowPassFrequency(value: number): void {
    this.lowPassFrequency = value;
    this.updateCoefficients();
  }

  setLowPassQ(value: number): void {
    this.lowPassQ = value;
    this.updateCoefficients();
  }

  setLowPassOrder(value: number): void {
    this.lowPassOrder = value;
    this.updateCoefficients();
  }

  reset(): void {
    for (const pair of this.biquadProcessors) {
      for (const processor of pair) {
        processor.reset();
      }
    }
  }

  process(
    input: [Float32Array, Float32Array],
    output: [Float32Array, Float32Array],
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;

    if (this.enabled.some((enabled) => enabled)) {
      let inpL = inputL;
      let inpR = inputR;
      for (const [index, coeff] of this.biquadCoeff.entries()) {
        if (this.enabled[index]) {
          const pair = this.biquadProcessors[index];
          if (pair) {
            const [fltL, fltR] = pair;
            // Both BiquadStack and BiquadMono implement BiquadProcessor interface
            (fltL as BiquadProcessor).process(
              coeff,
              inpL,
              outputL,
              fromIndex,
              toIndex
            );
            (fltR as BiquadProcessor).process(
              coeff,
              inpR,
              outputR,
              fromIndex,
              toIndex
            );
            inpL = outputL;
            inpR = outputR;
          }
        }
      }
    } else {
      // No filters enabled, pass through
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = inputL[i] ?? 0;
        outputR[i] = inputR[i] ?? 0;
      }
    }
  }
}
