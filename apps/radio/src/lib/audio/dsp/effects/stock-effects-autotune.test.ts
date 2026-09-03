import { expect, test } from "bun:test";
import { AutotunePitchDetector } from "./stock-effects-autotune";

const DETECTOR_SIZE = 2048;
const SAMPLE_RATE = 48_000;

function legacyDetectFrequency(detector: Float32Array): number | null {
  let bestLag = 0;
  let bestCorrelation = 0;
  const minimumLag = Math.floor(SAMPLE_RATE / 1000);
  const maximumLag = Math.min(detector.length / 2, Math.ceil(SAMPLE_RATE / 65));
  for (let lag = minimumLag; lag <= maximumLag; lag += 2) {
    let correlation = 0;
    for (let index = lag; index < detector.length; index += 4) {
      correlation += (detector[index] ?? 0) * (detector[index - lag] ?? 0);
    }
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }
  return bestLag > 0 && bestCorrelation > 0.001 ? SAMPLE_RATE / bestLag : null;
}

function detectorWindow(
  fundamental: number,
  harmonic: number,
  phase: number
): Float32Array {
  return Float32Array.from({ length: DETECTOR_SIZE }, (_, index) => {
    const time = index / SAMPLE_RATE;
    return (
      0.65 * Math.sin(2 * Math.PI * fundamental * time + phase) +
      0.2 * Math.sin(2 * Math.PI * harmonic * time) +
      0.03 * Math.sin(2 * Math.PI * 137 * time)
    );
  });
}

test("autotune streams detector work without changing legacy pitch results", () => {
  const detector = new AutotunePitchDetector(SAMPLE_RATE);
  const windows = [
    detectorWindow(110, 220, 0.1),
    detectorWindow(220, 660, 0.3),
    detectorWindow(450, 900, 0.5),
    detectorWindow(880, 1760, 0.7),
    new Float32Array(DETECTOR_SIZE),
  ];

  for (const window of windows) {
    let actual: number | null = null;
    for (const sample of window) {
      actual = detector.push(sample);
    }
    expect(actual).toBe(legacyDetectFrequency(window));
  }
});
