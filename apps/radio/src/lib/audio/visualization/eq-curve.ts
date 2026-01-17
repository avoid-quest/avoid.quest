/**
 * EQ Frequency Response Calculator
 *
 * Computes combined frequency response for the 7-band Revamp EQ.
 * Uses biquad filter coefficient math from the Audio EQ Cookbook.
 */

import type { RevampConfig } from "../dsp/effects/types.js";

const TAU = 2 * Math.PI;

type BiquadCoeffs = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

function normalizeCoeffs(
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number
): BiquadCoeffs {
  const inv = 1 / a0;
  return {
    b0: b0 * inv,
    b1: b1 * inv,
    b2: b2 * inv,
    a1: a1 * inv,
    a2: a2 * inv,
  };
}

function lowpassCoeffs(
  frequency: number,
  q: number,
  sampleRate: number
): BiquadCoeffs {
  const cutoff = frequency / sampleRate;
  if (cutoff >= 0.5) {
    return normalizeCoeffs(1, 0, 0, 1, 0, 0);
  }
  if (cutoff <= 0) {
    return normalizeCoeffs(0, 0, 0, 1, 0, 0);
  }
  const theta = TAU * cutoff;
  const alpha = Math.sin(theta) / (2 * q);
  const cosw = Math.cos(theta);
  const beta = (1 - cosw) / 2;
  return normalizeCoeffs(beta, 2 * beta, beta, 1 + alpha, -2 * cosw, 1 - alpha);
}

function highpassCoeffs(
  frequency: number,
  q: number,
  sampleRate: number
): BiquadCoeffs {
  const cutoff = frequency / sampleRate;
  if (cutoff >= 0.5) {
    return normalizeCoeffs(0, 0, 0, 1, 0, 0);
  }
  if (cutoff <= 0) {
    return normalizeCoeffs(1, 0, 0, 1, 0, 0);
  }
  const theta = TAU * cutoff;
  const alpha = Math.sin(theta) / (2 * q);
  const cosw = Math.cos(theta);
  const beta = (1 + cosw) / 2;
  return normalizeCoeffs(
    beta,
    -2 * beta,
    beta,
    1 + alpha,
    -2 * cosw,
    1 - alpha
  );
}

function lowShelfCoeffs(
  frequency: number,
  gainDb: number,
  sampleRate: number
): BiquadCoeffs {
  const cutoff = frequency / sampleRate;
  const a = 10 ** (gainDb / 40);
  if (cutoff >= 0.5) {
    return normalizeCoeffs(a * a, 0, 0, 1, 0, 0);
  }
  if (cutoff <= 0) {
    return normalizeCoeffs(1, 0, 0, 1, 0, 0);
  }
  const w0 = TAU * cutoff;
  const alpha = 0.5 * Math.sin(w0) * Math.sqrt((a + 1 / a) * (1 - 1) + 2);
  const k = Math.cos(w0);
  const k2 = 2 * Math.sqrt(a) * alpha;
  const aPlusOne = a + 1;
  const aMinusOne = a - 1;
  return normalizeCoeffs(
    a * (aPlusOne - aMinusOne * k + k2),
    2 * a * (aMinusOne - aPlusOne * k),
    a * (aPlusOne - aMinusOne * k - k2),
    aPlusOne + aMinusOne * k + k2,
    -2 * (aMinusOne + aPlusOne * k),
    aPlusOne + aMinusOne * k - k2
  );
}

function highShelfCoeffs(
  frequency: number,
  gainDb: number,
  sampleRate: number
): BiquadCoeffs {
  const cutoff = frequency / sampleRate;
  const a = 10 ** (gainDb / 40);
  if (cutoff >= 0.5) {
    return normalizeCoeffs(1, 0, 0, 1, 0, 0);
  }
  if (cutoff <= 0) {
    return normalizeCoeffs(a * a, 0, 0, 1, 0, 0);
  }
  const w0 = TAU * cutoff;
  const alpha = 0.5 * Math.sin(w0) * Math.sqrt((a + 1 / a) * (1 - 1) + 2);
  const k = Math.cos(w0);
  const k2 = 2 * Math.sqrt(a) * alpha;
  const aPlusOne = a + 1;
  const aMinusOne = a - 1;
  return normalizeCoeffs(
    a * (aPlusOne + aMinusOne * k + k2),
    -2 * a * (aMinusOne + aPlusOne * k),
    a * (aPlusOne + aMinusOne * k - k2),
    aPlusOne - aMinusOne * k + k2,
    2 * (aMinusOne - aPlusOne * k),
    aPlusOne - aMinusOne * k - k2
  );
}

function peakingCoeffs(
  frequency: number,
  q: number,
  gainDb: number,
  sampleRate: number
): BiquadCoeffs {
  const cutoff = frequency / sampleRate;
  if (cutoff <= 0 || cutoff >= 0.5 || q <= 0) {
    return normalizeCoeffs(1, 0, 0, 1, 0, 0);
  }
  const a = 10 ** (gainDb / 40);
  const w0 = TAU * cutoff;
  const alpha = Math.sin(w0) / (2 * q);
  const k = Math.cos(w0);
  return normalizeCoeffs(
    1 + alpha * a,
    -2 * k,
    1 - alpha * a,
    1 + alpha / a,
    -2 * k,
    1 - alpha / a
  );
}

/**
 * Compute frequency response magnitude for a single biquad filter.
 * Returns magnitude in linear scale.
 */
function getFrequencyResponse(
  coeffs: BiquadCoeffs,
  normalizedFreq: number
): number {
  const { b0, b1, b2, a1, a2 } = coeffs;
  const omega = -TAU * normalizedFreq;
  const zReal = Math.cos(omega);
  const zImag = Math.sin(omega);

  const numReal = b0 + (b1 + b2 * zReal) * zReal - b2 * zImag * zImag;
  const numImag = (b1 + b2 * zReal) * zImag + b2 * zImag * zReal;
  const denReal = 1 + (a1 + a2 * zReal) * zReal - a2 * zImag * zImag;
  const denImag = (a1 + a2 * zReal) * zImag + a2 * zImag * zReal;

  const denom = denReal * denReal + denImag * denImag;
  const respReal = (numReal * denReal + numImag * denImag) / denom;
  const respImag = (numImag * denReal - numReal * denImag) / denom;

  return Math.sqrt(respReal * respReal + respImag * respImag);
}

/**
 * Convert linear gain to decibels
 */
function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(gain, 1e-10));
}

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
  const numPoints = frequencies.length;
  const totalDb = new Float32Array(numPoints);

  // Create response arrays for each band
  const highPassDb = new Float32Array(numPoints);
  const lowShelfDb = new Float32Array(numPoints);
  const lowBellDb = new Float32Array(numPoints);
  const midBellDb = new Float32Array(numPoints);
  const highBellDb = new Float32Array(numPoints);
  const highShelfDb = new Float32Array(numPoints);
  const lowPassDb = new Float32Array(numPoints);

  for (let i = 0; i < numPoints; i++) {
    const freq = frequencies[i];
    if (freq === undefined) {
      continue;
    }
    const normalizedFreq = freq / sampleRate;
    let totalGain = 1;

    // High Pass
    if (config.highPassEnabled) {
      const coeffs = highpassCoeffs(
        config.highPassFrequency,
        config.highPassQ,
        sampleRate
      );
      const gain = getFrequencyResponse(coeffs, normalizedFreq);
      // Apply filter order (cascaded filters)
      const orderGain = gain ** config.highPassOrder;
      highPassDb[i] = gainToDb(orderGain);
      totalGain *= orderGain;
    }

    // Low Shelf
    if (config.lowShelfEnabled) {
      const coeffs = lowShelfCoeffs(
        config.lowShelfFrequency,
        config.lowShelfGain,
        sampleRate
      );
      const gain = getFrequencyResponse(coeffs, normalizedFreq);
      lowShelfDb[i] = gainToDb(gain);
      totalGain *= gain;
    }

    // Low Bell
    if (config.lowBellEnabled) {
      const coeffs = peakingCoeffs(
        config.lowBellFrequency,
        config.lowBellQ,
        config.lowBellGain,
        sampleRate
      );
      const gain = getFrequencyResponse(coeffs, normalizedFreq);
      lowBellDb[i] = gainToDb(gain);
      totalGain *= gain;
    }

    // Mid Bell
    if (config.midBellEnabled) {
      const coeffs = peakingCoeffs(
        config.midBellFrequency,
        config.midBellQ,
        config.midBellGain,
        sampleRate
      );
      const gain = getFrequencyResponse(coeffs, normalizedFreq);
      midBellDb[i] = gainToDb(gain);
      totalGain *= gain;
    }

    // High Bell
    if (config.highBellEnabled) {
      const coeffs = peakingCoeffs(
        config.highBellFrequency,
        config.highBellQ,
        config.highBellGain,
        sampleRate
      );
      const gain = getFrequencyResponse(coeffs, normalizedFreq);
      highBellDb[i] = gainToDb(gain);
      totalGain *= gain;
    }

    // High Shelf
    if (config.highShelfEnabled) {
      const coeffs = highShelfCoeffs(
        config.highShelfFrequency,
        config.highShelfGain,
        sampleRate
      );
      const gain = getFrequencyResponse(coeffs, normalizedFreq);
      highShelfDb[i] = gainToDb(gain);
      totalGain *= gain;
    }

    // Low Pass
    if (config.lowPassEnabled) {
      const coeffs = lowpassCoeffs(
        config.lowPassFrequency,
        config.lowPassQ,
        sampleRate
      );
      const gain = getFrequencyResponse(coeffs, normalizedFreq);
      // Apply filter order (cascaded filters)
      const orderGain = gain ** config.lowPassOrder;
      lowPassDb[i] = gainToDb(orderGain);
      totalGain *= orderGain;
    }

    totalDb[i] = gainToDb(totalGain);
  }

  return {
    totalDb,
    bands: {
      highPass: { enabled: config.highPassEnabled, dbResponse: highPassDb },
      lowShelf: { enabled: config.lowShelfEnabled, dbResponse: lowShelfDb },
      lowBell: { enabled: config.lowBellEnabled, dbResponse: lowBellDb },
      midBell: { enabled: config.midBellEnabled, dbResponse: midBellDb },
      highBell: { enabled: config.highBellEnabled, dbResponse: highBellDb },
      highShelf: { enabled: config.highShelfEnabled, dbResponse: highShelfDb },
      lowPass: { enabled: config.lowPassEnabled, dbResponse: lowPassDb },
    },
  };
}
