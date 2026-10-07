/**
 * EQ Frequency Response Calculator
 *
 * Computes combined frequency response for the 7-band Revamp EQ with
 * openDAW's lib-dsp biquads, configured the way the Revamp processor does.
 */

import { BiquadCoeff, gainToDb } from "@opendaw/lib-dsp";
import type { RevampConfig } from "../dsp/effects/types.js";

// Floor for silent bins, so the curve stays finite (-200 dB).
const MIN_GAIN = 1e-10;

export type EQBandResponse = {
  enabled: boolean;
  dbResponse: Float32Array;
};

export type EQCurveResult = {
  /** Combined frequency response in dB */
  totalDb: Float32Array;
  /** Individual band responses (for visualization) */
  bands: {
    highPass: EQBandResponse;
    lowShelf: EQBandResponse;
    lowBell: EQBandResponse;
    midBell: EQBandResponse;
    highBell: EQBandResponse;
    highShelf: EQBandResponse;
    lowPass: EQBandResponse;
  };
};

/**
 * Compute frequency response for the 7-band Revamp EQ.
 *
 * @param config - The RevampConfig with all band parameters
 * @param frequencies - Array of frequencies in Hz to compute response at
 * @param sampleRate - Audio sample rate (default 48000)
 * @returns Combined and individual band responses in dB
 */
export function computeEQCurve(
  config: RevampConfig,
  frequencies: Float32Array,
  sampleRate = 48_000
): EQCurveResult {
  const normalized = frequencies.map((frequency) => frequency / sampleRate);
  const magnitude = new Float32Array(frequencies.length);
  const phase = new Float32Array(frequencies.length);

  // Pass filters cascade `order` identical biquads, as BiquadStack does.
  const respond = (
    enabled: boolean,
    coeff: BiquadCoeff,
    order = 1
  ): EQBandResponse => {
    const dbResponse = new Float32Array(frequencies.length);
    if (enabled) {
      coeff.getFrequencyResponse(normalized, magnitude, phase);
      for (let i = 0; i < dbResponse.length; i += 1) {
        dbResponse[i] = order * gainToDb(Math.max(magnitude[i] ?? 0, MIN_GAIN));
      }
    }
    return { dbResponse, enabled };
  };

  const bands: EQCurveResult["bands"] = {
    highBell: respond(
      config.highBellEnabled,
      new BiquadCoeff().setPeakingParams(
        config.highBellFrequency / sampleRate,
        config.highBellQ,
        config.highBellGain
      )
    ),
    highPass: respond(
      config.highPassEnabled,
      new BiquadCoeff().setHighpassParams(
        config.highPassFrequency / sampleRate,
        config.highPassQ
      ),
      config.highPassOrder
    ),
    highShelf: respond(
      config.highShelfEnabled,
      new BiquadCoeff().setHighShelfParams(
        config.highShelfFrequency / sampleRate,
        config.highShelfGain
      )
    ),
    lowBell: respond(
      config.lowBellEnabled,
      new BiquadCoeff().setPeakingParams(
        config.lowBellFrequency / sampleRate,
        config.lowBellQ,
        config.lowBellGain
      )
    ),
    lowPass: respond(
      config.lowPassEnabled,
      new BiquadCoeff().setLowpassParams(
        config.lowPassFrequency / sampleRate,
        config.lowPassQ
      ),
      config.lowPassOrder
    ),
    lowShelf: respond(
      config.lowShelfEnabled,
      new BiquadCoeff().setLowShelfParams(
        config.lowShelfFrequency / sampleRate,
        config.lowShelfGain
      )
    ),
    midBell: respond(
      config.midBellEnabled,
      new BiquadCoeff().setPeakingParams(
        config.midBellFrequency / sampleRate,
        config.midBellQ,
        config.midBellGain
      )
    ),
  };

  const totalDb = new Float32Array(frequencies.length);
  for (const band of Object.values(bands)) {
    if (band.enabled) {
      for (let i = 0; i < totalDb.length; i += 1) {
        totalDb[i] = (totalDb[i] ?? 0) + (band.dbResponse[i] ?? 0);
      }
    }
  }

  return { bands, totalDb };
}
