import { PhaseVocoder } from "./phase-vocoder.js";
import { clamp } from "./stock-effect-utils.js";
import { AUTOTUNE_KEYS, type StereoChannels } from "./types.js";

const SCALE_INTERVALS: Record<string, readonly number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
const LEGACY_SCALE_ALIASES: Record<string, string> = {
  pentatonicMajor: "majorPentatonic",
  pentatonicMinor: "minorPentatonic",
};

export class AutotuneEffect {
  private readonly sampleRate: number;
  private readonly shifter = new PhaseVocoder();
  private readonly detector = new Float32Array(2048);
  private detectorIndex = 0;
  private key = 0;
  private scale = "chromatic";
  private amount = 1;
  private retune = 40;
  private shift = 0;
  private smoothing = 0.25;
  private factor = 1;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  setKey(value: string): void {
    const index = AUTOTUNE_KEYS.indexOf(
      value as (typeof AUTOTUNE_KEYS)[number]
    );
    this.key = index >= 0 ? index : 0;
  }

  setScale(value: string): void {
    const normalized = LEGACY_SCALE_ALIASES[value] ?? value;
    if (SCALE_INTERVALS[normalized]) {
      this.scale = normalized;
    }
  }

  setAmount(value: number): void {
    this.amount = clamp(value, 0, 1);
  }

  setRetune(value: number): void {
    this.retune = clamp(value, 0, 500);
  }

  setShift(value: number): void {
    this.shift = clamp(value, -12, 12);
  }

  setSmoothing(value: number): void {
    this.smoothing = clamp(value, 0, 1);
  }

  reset(): void {
    this.detector.fill(0);
    this.detectorIndex = 0;
    this.factor = 1;
    this.shifter.reset();
  }

  private detectFrequency(): number | null {
    let bestLag = 0;
    let bestCorrelation = 0;
    const minimumLag = Math.floor(this.sampleRate / 1000);
    const maximumLag = Math.min(
      this.detector.length / 2,
      Math.ceil(this.sampleRate / 65)
    );
    for (let lag = minimumLag; lag <= maximumLag; lag += 2) {
      let correlation = 0;
      for (let index = lag; index < this.detector.length; index += 4) {
        correlation +=
          (this.detector[index] ?? 0) * (this.detector[index - lag] ?? 0);
      }
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }
    return bestLag > 0 && bestCorrelation > 0.001
      ? this.sampleRate / bestLag
      : null;
  }

  private updateFactor(): void {
    const frequency = this.detectFrequency();
    if (!frequency) {
      return;
    }
    const midi = 69 + 12 * Math.log2(frequency / 440);
    const allowed = SCALE_INTERVALS[this.scale] ?? SCALE_INTERVALS.chromatic;
    let target = Math.round(midi);
    let distance = Number.POSITIVE_INFINITY;
    for (let octave = -1; octave <= 1; octave++) {
      for (const interval of allowed ?? []) {
        const candidate =
          Math.floor(midi / 12) * 12 + octave * 12 + this.key + interval;
        if (Math.abs(candidate - midi) < distance) {
          distance = Math.abs(candidate - midi);
          target = candidate;
        }
      }
    }
    const correction = (target - midi) * this.amount + this.shift;
    const desired = 2 ** (correction / 12);
    const response =
      this.retune === 0
        ? 1
        : 1 -
          Math.exp(
            -(this.detector.length / this.sampleRate) / (this.retune * 0.001)
          );
    this.factor +=
      (desired - this.factor) * response * (1 - this.smoothing * 0.9);
    this.shifter.setPitchFactor(this.factor);
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    for (let i = fromIndex; i < toIndex; i++) {
      this.detector[this.detectorIndex] =
        ((input[0][i] ?? 0) + (input[1][i] ?? 0)) * 0.5;
      this.detectorIndex++;
      if (this.detectorIndex >= this.detector.length) {
        this.detectorIndex = 0;
        this.updateFactor();
      }
    }
    this.shifter.process(input, output, fromIndex, toIndex);
  }
}
