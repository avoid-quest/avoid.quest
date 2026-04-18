import type { EffectConfig } from "../dsp/effects/types.js";

function applyReverbAndTimeConfig(
  base: Record<string, number>,
  config: EffectConfig
): void {
  switch (config.type) {
    case "plateReverb":
      base.preDelay = config.preDelay;
      base.bandwidth = config.bandwidth;
      base.inputDiffusion1 = config.inputDiffusion1;
      base.inputDiffusion2 = config.inputDiffusion2;
      base.decay = config.decay;
      base.decayDiffusion1 = config.decayDiffusion1;
      base.decayDiffusion2 = config.decayDiffusion2;
      base.damping = config.damping;
      base.excursionRate = config.excursionRate;
      base.excursionDepth = config.excursionDepth;
      break;
    case "pitchShifter":
      base.pitchFactor = config.pitchFactor;
      break;
    case "limiter":
      base.threshold = config.threshold;
      break;
    case "delay":
      base.delayTime = config.delayTime;
      base.feedback = config.feedback;
      break;
    case "distortion":
      base.amount = config.amount;
      break;
    default:
      break;
  }
}

function applyDynamicsAndColorConfig(
  base: Record<string, number>,
  config: EffectConfig
): void {
  switch (config.type) {
    case "compressor":
      base.threshold = config.threshold;
      base.ratio = config.ratio;
      base.attack = config.attack;
      base.release = config.release;
      base.knee = config.knee;
      break;
    case "crusher":
      base.crush = config.crush;
      base.bitDepth = config.bitDepth;
      base.boost = config.boost;
      base.mix = config.dryWet;
      break;
    case "fold":
      base.amount = config.amount;
      base.volume = config.volume;
      base.oversample = config.oversample;
      break;
    case "stereoTool":
      base.volume = config.volume;
      base.stereo = config.stereo;
      base.invertL = config.invertL ? 1 : 0;
      base.invertR = config.invertR ? 1 : 0;
      base.swap = config.swap ? 1 : 0;
      break;
    default:
      break;
  }
}

function applyEqAndModulationConfig(
  base: Record<string, number>,
  config: EffectConfig
): void {
  switch (config.type) {
    case "revamp":
      base.highPassEnabled = config.highPassEnabled ? 1 : 0;
      base.highPassFrequency = config.highPassFrequency;
      base.highPassQ = config.highPassQ;
      base.highPassOrder = config.highPassOrder;
      base.lowShelfEnabled = config.lowShelfEnabled ? 1 : 0;
      base.lowShelfFrequency = config.lowShelfFrequency;
      base.lowShelfGain = config.lowShelfGain;
      base.lowBellEnabled = config.lowBellEnabled ? 1 : 0;
      base.lowBellFrequency = config.lowBellFrequency;
      base.lowBellGain = config.lowBellGain;
      base.lowBellQ = config.lowBellQ;
      base.midBellEnabled = config.midBellEnabled ? 1 : 0;
      base.midBellFrequency = config.midBellFrequency;
      base.midBellGain = config.midBellGain;
      base.midBellQ = config.midBellQ;
      base.highBellEnabled = config.highBellEnabled ? 1 : 0;
      base.highBellFrequency = config.highBellFrequency;
      base.highBellGain = config.highBellGain;
      base.highBellQ = config.highBellQ;
      base.highShelfEnabled = config.highShelfEnabled ? 1 : 0;
      base.highShelfFrequency = config.highShelfFrequency;
      base.highShelfGain = config.highShelfGain;
      base.lowPassEnabled = config.lowPassEnabled ? 1 : 0;
      base.lowPassFrequency = config.lowPassFrequency;
      base.lowPassQ = config.lowPassQ;
      base.lowPassOrder = config.lowPassOrder;
      break;
    case "tidal":
      base.rate = config.rate;
      base.depth = config.depth;
      base.slope = config.slope;
      base.symmetry = config.symmetry;
      base.offset = config.offset;
      base.channelOffset = config.channelOffset;
      break;
    default:
      break;
  }
}

function convertEffectConfig(config: EffectConfig): Record<string, number> {
  const base: Record<string, number> = {
    enabled: config.enabled ? 1 : 0,
    inputGain: config.inputGain ?? 1.0,
    outputGain: config.outputGain ?? 1.0,
  };

  if (config.dryWet !== undefined) {
    base.wet = config.dryWet;
    base.dry = 1 - config.dryWet;
    base.dryWet = config.dryWet;
  }

  applyReverbAndTimeConfig(base, config);
  applyDynamicsAndColorConfig(base, config);
  applyEqAndModulationConfig(base, config);

  return base;
}

function convertPartialEffectConfig(
  config: Partial<EffectConfig>
): Record<string, number> {
  const result: Record<string, number> = {};

  if (config.dryWet !== undefined) {
    result.wet = config.dryWet;
    result.dry = 1 - config.dryWet;
    result.mix = config.dryWet;
  }

  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "number" && key !== "order") {
      result[key] = value;
    } else if (typeof value === "boolean") {
      result[key] = value ? 1 : 0;
    }
  }

  return result;
}

export { convertEffectConfig, convertPartialEffectConfig };
