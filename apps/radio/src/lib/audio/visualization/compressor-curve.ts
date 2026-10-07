/**
 * Compressor Transfer Curve Calculator
 *
 * Computes the static input/output curve with openDAW's CTAG gain computer,
 * the same one the compressor runs. Auto makeup follows the programme's
 * average reduction over time rather than the input level, so it has no
 * place on a static curve.
 */

import { dbToGain, gainToDb } from "@opendaw/lib-dsp";
import { GainComputer } from "@opendaw/lib-dsp/ctagdrc";
import type { CompressorConfig } from "../dsp/effects/types.js";

/**
 * Compute the compressor's output level for each input level.
 *
 * @param config - Input gain, threshold, ratio, knee and makeup (dB) and the
 *   device's dry/wet mix
 * @param inputDb - Input levels in dB
 * @returns Output levels in dB
 */
export function computeCompressorCurve(
  config: Pick<
    CompressorConfig,
    "threshold" | "ratio" | "knee" | "makeup" | "mix" | "inputgain"
  >,
  inputDb: Float32Array
): Float32Array {
  const gainComputer = new GainComputer();
  gainComputer.setThreshold(config.threshold);
  gainComputer.setRatio(config.ratio);
  gainComputer.setKnee(config.knee);
  return inputDb.map((level) => {
    const driven = level + (config.inputgain ?? 0);
    const wet = driven + gainComputer.applyCompression(driven) + config.makeup;
    return gainToDb(
      config.mix * dbToGain(wet) + (1 - config.mix) * dbToGain(driven)
    );
  });
}
