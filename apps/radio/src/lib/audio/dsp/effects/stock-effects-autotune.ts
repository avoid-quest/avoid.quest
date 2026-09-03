import { PhaseVocoder } from "./phase-vocoder.js";
import { clamp } from "./stock-effect-utils.js";
import { AUTOTUNE_KEYS, type StereoChannels } from "./types.js";

const SCALE_INTERVALS: Record<string, readonly number[]> = {
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  majorPentatonic: [0, 2, 4, 7, 9],
  minor: [0, 2, 3, 5, 7, 8, 10],
  minorPentatonic: [0, 3, 5, 7, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
const LEGACY_SCALE_ALIASES: Record<string, string> = {
  pentatonicMajor: "majorPentatonic",
  pentatonicMinor: "minorPentatonic",
};
const DETECTOR_SIZE = 2048;

export class AutotunePitchDetector {
  private readonly correlations = new Float64Array(DETECTOR_SIZE / 2 + 1);
  private readonly detector = new Float32Array(DETECTOR_SIZE);
  private readonly maximumLag: number;
  private readonly minimumLag: number;
  private readonly sampleRate: number;
  private detectorIndex = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.minimumLag = Math.floor(sampleRate / 1000);
    this.maximumLag = Math.min(DETECTOR_SIZE / 2, Math.ceil(sampleRate / 65));
  }

  push(sample: number): number | null {
    const index = this.detectorIndex;
    this.detector[index] = sample;

    if (index >= this.minimumLag && (index - this.minimumLag) % 2 === 0) {
      const detectorSample = this.detector[index] ?? 0;
      const firstLag = this.minimumLag + ((index - this.minimumLag) & 3);
      const maximumLag = Math.min(this.maximumLag, index);
      for (let lag = firstLag; lag <= maximumLag; lag += 4) {
        this.correlations[lag] =
          (this.correlations[lag] ?? 0) +
          detectorSample * (this.detector[index - lag] ?? 0);
      }
    }

    this.detectorIndex = index + 1;
    if (this.detectorIndex < DETECTOR_SIZE) {
      return null;
    }

    let bestLag = 0;
    let bestCorrelation = 0;
    for (let lag = this.minimumLag; lag <= this.maximumLag; lag += 2) {
      const correlation = this.correlations[lag] ?? 0;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }
    this.correlations.fill(0);
    this.detectorIndex = 0;
    return bestLag > 0 && bestCorrelation > 0.001
      ? this.sampleRate / bestLag
      : null;
  }

  reset(): void {
    this.correlations.fill(0);
    this.detector.fill(0);
    this.detectorIndex = 0;
  }
}

export class AutotuneEffect {
  private readonly sampleRate: number;
  private readonly shifter = new PhaseVocoder();
  private readonly detector: AutotunePitchDetector;
  private key = 0;
  private scale = "chromatic";
  private amount = 1;
  private retune = 40;
  private shift = 0;
  private smoothing = 0.25;
  private factor = 1;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.detector = new AutotunePitchDetector(sampleRate);
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
    this.detector.reset();
    this.factor = 1;
    this.shifter.reset();
  }

  private updateFactor(frequency: number): void {
    const midi = 69 + 12 * Math.log2(frequency / 440);
    const allowed = SCALE_INTERVALS[this.scale] ?? SCALE_INTERVALS.chromatic;
    let target = Math.round(midi);
    let distance = Number.POSITIVE_INFINITY;
    for (let octave = -1; octave <= 1; octave += 1) {
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
          Math.exp(-(DETECTOR_SIZE / this.sampleRate) / (this.retune * 0.001));
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
    for (let i = fromIndex; i < toIndex; i += 1) {
      const frequency = this.detector.push(
        ((input[0][i] ?? 0) + (input[1][i] ?? 0)) * 0.5
      );
      if (frequency !== null) {
        this.updateFactor(frequency);
      }
    }
    this.shifter.process(input, output, fromIndex, toIndex);
  }
}
