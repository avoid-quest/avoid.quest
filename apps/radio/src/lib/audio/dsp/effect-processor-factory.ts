import { ContainerEffect } from "./effects/container-effects.js";
import { CrusherEffect } from "./effects/crusher.js";
import { CTAGCompressor } from "./effects/ctag-compressor.js";
import { Delay } from "./effects/delay.js";
import { Distortion } from "./effects/distortion.js";
import { FoldEffect } from "./effects/fold.js";
import { Limiter } from "./effects/limiter.js";
import { PhaseVocoder } from "./effects/phase-vocoder.js";
import { RevampEffect } from "./effects/revamp.js";
import { DattorroReverb } from "./effects/reverb.js";
import { StereoToolEffect } from "./effects/stereo-tool.js";
import {
  AutotuneEffect,
  CheapReverbEffect,
  GateEffect,
  MaximizerEffect,
  NeuralAmpEffect,
  VocoderEffect,
  WaveshaperEffect,
  WerkstattEffect,
} from "./effects/stock-effects.js";
import { TidalEffect } from "./effects/tidal.js";
import type {
  EffectConfig,
  EffectProcessor,
  EffectType,
} from "./effects/types.js";

function dbToGain(value: number): number {
  return 10 ** (value / 20);
}

function readBooleanConfig(
  config: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = config[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return;
}

function applyBooleanConfig(
  config: Record<string, unknown>,
  key: string,
  apply: (value: boolean) => void
): void {
  const value = readBooleanConfig(config, key);
  if (value !== undefined) {
    apply(value);
  }
}

/**
 * Effect source - tracks effects and filters for a source
 * Audio comes from Web Audio graph, not from chunks
 */
export function createEffectProcessor(
  type: EffectType,
  sampleRate: number,
  config?: EffectConfig
): EffectProcessor | null {
  switch (type) {
    case "plateReverb":
      return new DattorroReverb(sampleRate);
    case "pitchShifter":
      return new PhaseVocoder();
    case "limiter":
      return new Limiter(sampleRate);
    case "distortion":
      return new Distortion(sampleRate);
    case "compressor":
      return new CTAGCompressor(sampleRate);
    case "crusher":
      return new CrusherEffect(sampleRate);
    case "fold":
      return new FoldEffect(sampleRate);
    case "stereoTool":
      return new StereoToolEffect(sampleRate);
    case "revamp":
      return new RevampEffect(sampleRate);
    case "tidal":
      return new TidalEffect(sampleRate);
    case "delay":
      return new Delay(sampleRate);
    case "cheapReverb":
      return new CheapReverbEffect(sampleRate);
    case "gate":
      return new GateEffect(sampleRate);
    case "waveshaper":
      return new WaveshaperEffect();
    case "maximizer":
      return new MaximizerEffect(sampleRate);
    case "vocoder":
      return new VocoderEffect(sampleRate);
    case "neuralAmp":
      return new NeuralAmpEffect(sampleRate);
    case "werkstatt":
      return new WerkstattEffect(sampleRate);
    case "autotune":
      return new AutotuneEffect(sampleRate);
    case "fxComposite":
    case "stereoSplit":
    case "frequencySplit":
      return config
        ? new ContainerEffect(
            type,
            sampleRate,
            config,
            (child) => {
              const childProcessor = createEffectProcessor(
                child.type,
                sampleRate,
                child
              );
              if (childProcessor) {
                applyEffectConfig(
                  childProcessor,
                  child.type,
                  child as unknown as Record<string, unknown>
                );
              }
              return childProcessor;
            },
            (processor, child) => {
              applyEffectConfig(
                processor,
                child.type,
                child as unknown as Record<string, unknown>
              );
              if (processor instanceof ContainerEffect) {
                processor.configure(child);
              }
            }
          )
        : null;
    default:
      return null;
  }
}

export function applyEffectConfig(
  processor: EffectProcessor,
  type: EffectType,
  config: Record<string, unknown>
): void {
  switch (type) {
    case "crusher": {
      const crusher = processor as CrusherEffect;
      if (typeof config.crush === "number") {
        crusher.setCrush(config.crush);
      }
      if (typeof config.bitDepth === "number") {
        crusher.setBitDepth(config.bitDepth);
      }
      if (typeof config.boost === "number") {
        crusher.setBoost(config.boost);
      }
      applyBooleanConfig(config, "autoGain", (value) =>
        crusher.setAutoGain(value)
      );
      break;
    }
    case "fold": {
      const fold = processor as FoldEffect;
      if (typeof config.amount === "number") {
        fold.setAmount(config.amount);
      }
      if (typeof config.volume === "number") {
        fold.setVolume(config.volume);
      }
      if (typeof config.oversample === "number") {
        const os = config.oversample;
        if (os === 2 || os === 4 || os === 8) {
          fold.setOversample(os);
        }
      }
      applyBooleanConfig(config, "autoGain", (value) =>
        fold.setAutoGain(value)
      );
      break;
    }
    case "stereoTool": {
      const stereo = processor as StereoToolEffect;
      if (typeof config.volume === "number") {
        stereo.setVolume(config.volume);
      }
      if (typeof config.stereo === "number") {
        stereo.setStereoWidth(config.stereo);
      }
      if (typeof config.panning === "number") {
        stereo.setPanning(config.panning);
      }
      if (typeof config.panLaw === "string") {
        stereo.setPanLaw(config.panLaw);
      }
      applyBooleanConfig(config, "invertL", (value) =>
        stereo.setInvertL(value)
      );
      applyBooleanConfig(config, "invertR", (value) =>
        stereo.setInvertR(value)
      );
      applyBooleanConfig(config, "swap", (value) => stereo.setSwap(value));
      break;
    }
    case "tidal": {
      const tidal = processor as TidalEffect;
      if (typeof config.rate === "number") {
        tidal.setRate(config.rate);
      }
      applyBooleanConfig(config, "tempoSync", (value) =>
        tidal.setTempoSync(value)
      );
      if (typeof config.tempoDivision === "string") {
        tidal.setTempoDivision(config.tempoDivision);
      }
      if (typeof config.rateDivision === "string") {
        tidal.setRateDivision(config.rateDivision);
      }
      if (typeof config.depth === "number") {
        tidal.setDepth(config.depth);
      }
      if (typeof config.slope === "number") {
        tidal.setSlope(config.slope);
      }
      if (typeof config.symmetry === "number") {
        tidal.setSymmetry(config.symmetry);
      }
      if (typeof config.offset === "number") {
        tidal.setOffset(config.offset);
      }
      if (typeof config.channelOffset === "number") {
        tidal.setChannelOffset(config.channelOffset);
      }
      break;
    }
    case "plateReverb": {
      const reverb = processor as DattorroReverb;
      if (typeof config.preDelay === "number") {
        reverb.setPreDelay(config.preDelay / 1000);
      }
      if (typeof config.bandwidth === "number") {
        reverb.setBandwidth(config.bandwidth);
      }
      if (typeof config.inputDiffusion1 === "number") {
        reverb.setInputDiffusion1(config.inputDiffusion1);
      }
      if (typeof config.inputDiffusion2 === "number") {
        reverb.setInputDiffusion2(config.inputDiffusion2);
      }
      if (typeof config.decay === "number") {
        reverb.setDecay(config.decay);
      }
      if (typeof config.decayDiffusion1 === "number") {
        reverb.setDecayDiffusion1(config.decayDiffusion1);
      }
      if (typeof config.decayDiffusion2 === "number") {
        reverb.setDecayDiffusion2(config.decayDiffusion2);
      }
      if (typeof config.damping === "number") {
        reverb.setDamping(config.damping);
      }
      if (typeof config.excursionRate === "number") {
        reverb.setExcursionRate(config.excursionRate);
      }
      if (typeof config.excursionDepth === "number") {
        reverb.setExcursionDepth(config.excursionDepth);
      }
      if (typeof config.wet === "number") {
        reverb.setWet(dbToGain(config.wet));
      }
      if (typeof config.dry === "number") {
        reverb.setDry(dbToGain(config.dry));
      }
      break;
    }
    case "distortion": {
      const dist = processor as Distortion;
      if (typeof config.amount === "number") {
        dist.setAmount(config.amount);
      }
      if (typeof config.oversample === "string") {
        const os = config.oversample;
        if (os === "none" || os === "2x" || os === "4x") {
          dist.setOversample(os);
        }
      }
      break;
    }
    case "compressor": {
      const comp = processor as CTAGCompressor;
      if (typeof config.threshold === "number") {
        comp.setThreshold(config.threshold);
      }
      if (typeof config.ratio === "number") {
        comp.setRatio(config.ratio);
      }
      if (typeof config.attack === "number") {
        comp.setAttack(config.attack);
      }
      if (typeof config.release === "number") {
        comp.setRelease(config.release);
      }
      if (typeof config.knee === "number") {
        comp.setKnee(config.knee);
      }
      if (typeof config.makeup === "number") {
        comp.setMakeup(config.makeup);
      }
      if (typeof config.mix === "number") {
        comp.setMix(config.mix);
      }
      if (typeof config.inputgain === "number") {
        comp.setInputGain(config.inputgain);
      }
      applyBooleanConfig(config, "lookahead", (value) =>
        comp.setLookahead(value)
      );
      applyBooleanConfig(config, "autoAttack", (value) =>
        comp.setAutoAttack(value)
      );
      applyBooleanConfig(config, "autoattack", (value) =>
        comp.setAutoAttack(value)
      );
      applyBooleanConfig(config, "autoRelease", (value) =>
        comp.setAutoRelease(value)
      );
      applyBooleanConfig(config, "autorelease", (value) =>
        comp.setAutoRelease(value)
      );
      applyBooleanConfig(config, "autoMakeup", (value) =>
        comp.setAutoMakeup(value)
      );
      applyBooleanConfig(config, "automakeup", (value) =>
        comp.setAutoMakeup(value)
      );
      break;
    }
    case "pitchShifter": {
      const pv = processor as PhaseVocoder;
      if (typeof config.pitchFactor === "number") {
        pv.setPitchFactor(config.pitchFactor);
      }
      break;
    }
    case "limiter": {
      const limiter = processor as Limiter;
      if (typeof config.threshold === "number") {
        limiter.setThreshold(config.threshold);
      }
      break;
    }
    case "revamp": {
      const revamp = processor as RevampEffect;
      applyBooleanConfig(config, "highPassEnabled", (value) =>
        revamp.setHighPassEnabled(value)
      );
      if (typeof config.highPassFrequency === "number") {
        revamp.setHighPassFrequency(config.highPassFrequency);
      }
      if (typeof config.highPassQ === "number") {
        revamp.setHighPassQ(config.highPassQ);
      }
      if (typeof config.highPassOrder === "number") {
        revamp.setHighPassOrder(config.highPassOrder);
      }
      applyBooleanConfig(config, "lowShelfEnabled", (value) =>
        revamp.setLowShelfEnabled(value)
      );
      if (typeof config.lowShelfFrequency === "number") {
        revamp.setLowShelfFrequency(config.lowShelfFrequency);
      }
      if (typeof config.lowShelfGain === "number") {
        revamp.setLowShelfGain(config.lowShelfGain);
      }
      applyBooleanConfig(config, "lowBellEnabled", (value) =>
        revamp.setLowBellEnabled(value)
      );
      if (typeof config.lowBellFrequency === "number") {
        revamp.setLowBellFrequency(config.lowBellFrequency);
      }
      if (typeof config.lowBellGain === "number") {
        revamp.setLowBellGain(config.lowBellGain);
      }
      if (typeof config.lowBellQ === "number") {
        revamp.setLowBellQ(config.lowBellQ);
      }
      applyBooleanConfig(config, "midBellEnabled", (value) =>
        revamp.setMidBellEnabled(value)
      );
      if (typeof config.midBellFrequency === "number") {
        revamp.setMidBellFrequency(config.midBellFrequency);
      }
      if (typeof config.midBellGain === "number") {
        revamp.setMidBellGain(config.midBellGain);
      }
      if (typeof config.midBellQ === "number") {
        revamp.setMidBellQ(config.midBellQ);
      }
      applyBooleanConfig(config, "highBellEnabled", (value) =>
        revamp.setHighBellEnabled(value)
      );
      if (typeof config.highBellFrequency === "number") {
        revamp.setHighBellFrequency(config.highBellFrequency);
      }
      if (typeof config.highBellGain === "number") {
        revamp.setHighBellGain(config.highBellGain);
      }
      if (typeof config.highBellQ === "number") {
        revamp.setHighBellQ(config.highBellQ);
      }
      applyBooleanConfig(config, "highShelfEnabled", (value) =>
        revamp.setHighShelfEnabled(value)
      );
      if (typeof config.highShelfFrequency === "number") {
        revamp.setHighShelfFrequency(config.highShelfFrequency);
      }
      if (typeof config.highShelfGain === "number") {
        revamp.setHighShelfGain(config.highShelfGain);
      }
      applyBooleanConfig(config, "lowPassEnabled", (value) =>
        revamp.setLowPassEnabled(value)
      );
      if (typeof config.lowPassFrequency === "number") {
        revamp.setLowPassFrequency(config.lowPassFrequency);
      }
      if (typeof config.lowPassQ === "number") {
        revamp.setLowPassQ(config.lowPassQ);
      }
      if (typeof config.lowPassOrder === "number") {
        revamp.setLowPassOrder(config.lowPassOrder);
      }
      break;
    }
    case "delay": {
      const delay = processor as Delay;
      if (typeof config.delayTime === "number") {
        delay.setDelayTime(config.delayTime);
      }
      if (typeof config.delayMusical === "string") {
        delay.setDelayMusical(config.delayMusical);
      }
      if (typeof config.delayMillis === "number") {
        delay.setDelayMillis(config.delayMillis);
      }
      if (typeof config.feedback === "number") {
        delay.setFeedback(config.feedback);
      }
      applyBooleanConfig(config, "tempoSync", (value) =>
        delay.setTempoSync(value)
      );
      if (typeof config.tempoDivision === "string") {
        delay.setTempoDivision(config.tempoDivision);
      }
      if (typeof config.preDelay === "number") {
        delay.setPreDelay(config.preDelay);
      }
      if (typeof config.preSyncTimeLeft === "string") {
        delay.setPreSyncTimeLeft(config.preSyncTimeLeft);
      }
      if (typeof config.preMillisTimeLeft === "number") {
        delay.setPreMillisTimeLeft(config.preMillisTimeLeft);
      }
      if (typeof config.preSyncTimeRight === "string") {
        delay.setPreSyncTimeRight(config.preSyncTimeRight);
      }
      if (typeof config.preMillisTimeRight === "number") {
        delay.setPreMillisTimeRight(config.preMillisTimeRight);
      }
      if (typeof config.crossFeedback === "number") {
        delay.setCrossFeedback(config.crossFeedback);
      }
      if (typeof config.cross === "number") {
        delay.setCrossFeedback(config.cross);
      }
      if (typeof config.filterFrequency === "number") {
        delay.setFilterFrequency(config.filterFrequency);
      }
      if (typeof config.filter === "number") {
        delay.setFilter(config.filter);
      }
      if (typeof config.lfoRate === "number") {
        delay.setLfoRate(config.lfoRate);
      }
      if (typeof config.lfoSpeed === "number") {
        delay.setLfoRate(config.lfoSpeed);
      }
      if (typeof config.lfoDepth === "number") {
        delay.setLfoDepth(config.lfoDepth);
      }
      if (typeof config.dry === "number") {
        delay.setDry(config.dry);
      }
      if (typeof config.wet === "number") {
        delay.setWet(config.wet);
      }
      break;
    }
    case "cheapReverb": {
      const reverb = processor as CheapReverbEffect;
      if (typeof config.roomSize === "number") {
        reverb.setRoomSize(config.roomSize);
      }
      if (typeof config.damping === "number") {
        reverb.setDamping(config.damping);
      }
      if (typeof config.width === "number") {
        reverb.setWidth(config.width);
      }
      if (typeof config.decay === "number") {
        reverb.setDecay(config.decay);
      }
      if (typeof config.preDelay === "number") {
        reverb.setPreDelay(config.preDelay);
      }
      if (typeof config.damp === "number") {
        reverb.setDamp(config.damp);
      }
      if (typeof config.filter === "number") {
        reverb.setFilter(config.filter);
      }
      if (typeof config.dry === "number") {
        reverb.setDry(config.dry);
      }
      if (typeof config.wet === "number") {
        reverb.setWet(config.wet);
      }
      break;
    }
    case "gate": {
      const gate = processor as GateEffect;
      if (typeof config.threshold === "number") {
        gate.setThreshold(config.threshold);
      }
      if (typeof config.attack === "number") {
        gate.setAttack(config.attack);
      }
      if (typeof config.hold === "number") {
        gate.setHold(config.hold);
      }
      if (typeof config.release === "number") {
        gate.setRelease(config.release);
      }
      if (typeof config.floor === "number") {
        gate.setFloor(config.floor);
      }
      if (typeof config.return === "number") {
        gate.setReturn(config.return);
      }
      applyBooleanConfig(config, "inverse", (value) => gate.setInverse(value));
      break;
    }
    case "waveshaper": {
      const waveshaper = processor as WaveshaperEffect;
      if (typeof config.curve === "string") {
        waveshaper.setCurve(config.curve);
      }
      if (typeof config.equation === "string") {
        waveshaper.setCurve(config.equation);
      }
      if (typeof config.drive === "number") {
        waveshaper.setDrive(config.drive);
      }
      if (typeof config.deviceInputGain === "number") {
        waveshaper.setDrive(config.deviceInputGain);
      }
      if (typeof config.output === "number") {
        waveshaper.setOutput(config.output);
      }
      if (typeof config.deviceOutputGain === "number") {
        waveshaper.setOutput(config.deviceOutputGain);
      }
      if (typeof config.mix === "number") {
        waveshaper.setMix(config.mix);
      }
      break;
    }
    case "maximizer": {
      const maximizer = processor as MaximizerEffect;
      if (typeof config.threshold === "number") {
        maximizer.setThreshold(config.threshold);
      }
      if (typeof config.ceiling === "number") {
        maximizer.setCeiling(config.ceiling);
      }
      if (typeof config.release === "number") {
        maximizer.setRelease(config.release);
      }
      if (typeof config.lookahead === "number") {
        maximizer.setLookahead(config.lookahead);
      }
      applyBooleanConfig(config, "lookaheadEnabled", (value) =>
        maximizer.setLookaheadEnabled(value)
      );
      break;
    }
    case "vocoder": {
      const vocoder = processor as VocoderEffect;
      if (typeof config.bands === "number") {
        vocoder.setBands(config.bands);
      }
      if (typeof config.bandCount === "number") {
        vocoder.setBands(config.bandCount);
      }
      if (typeof config.modulator === "string") {
        vocoder.setModulator(config.modulator);
      }
      if (typeof config.modulatorSource === "string") {
        vocoder.setModulatorSource(config.modulatorSource);
      }
      if (typeof config.carrierGain === "number") {
        vocoder.setCarrierGain(config.carrierGain);
      }
      if (typeof config.modulatorGain === "number") {
        vocoder.setModulatorGain(config.modulatorGain);
      }
      if (typeof config.noise === "number") {
        vocoder.setNoise(config.noise);
      }
      if (typeof config.carrierMinFreq === "number") {
        vocoder.setCarrierMinFreq(config.carrierMinFreq);
      }
      if (typeof config.carrierMaxFreq === "number") {
        vocoder.setCarrierMaxFreq(config.carrierMaxFreq);
      }
      if (typeof config.modulatorMinFreq === "number") {
        vocoder.setModulatorMinFreq(config.modulatorMinFreq);
      }
      if (typeof config.modulatorMaxFreq === "number") {
        vocoder.setModulatorMaxFreq(config.modulatorMaxFreq);
      }
      if (typeof config.qStart === "number") {
        vocoder.setQStart(config.qStart);
      }
      if (typeof config.qEnd === "number") {
        vocoder.setQEnd(config.qEnd);
      }
      if (typeof config.envAttack === "number") {
        vocoder.setAttack(config.envAttack);
      }
      if (typeof config.envRelease === "number") {
        vocoder.setRelease(config.envRelease);
      }
      if (typeof config.gain === "number") {
        vocoder.setGain(config.gain);
      }
      if (typeof config.mix === "number") {
        vocoder.setMix(config.mix);
      }
      break;
    }
    case "neuralAmp": {
      const amp = processor as NeuralAmpEffect;
      if (
        "modelData" in config ||
        "modelId" in config ||
        "modelUrl" in config
      ) {
        amp.setModelAvailable(
          [config.modelData, config.modelId, config.modelUrl].some(
            (value) => typeof value === "string" && value.length > 0
          )
        );
      }
      if (typeof config.input === "number") {
        amp.setInput(config.input);
      }
      if (typeof config.output === "number") {
        amp.setOutput(config.output);
      }
      applyBooleanConfig(config, "cabinetEnabled", (value) =>
        amp.setCabinetEnabled(value)
      );
      applyBooleanConfig(config, "mono", (value) => amp.setMono(value));
      if (typeof config.mix === "number") {
        amp.setMix(config.mix);
      }
      break;
    }
    case "werkstatt": {
      const werkstatt = processor as WerkstattEffect;
      if (typeof config.code === "string") {
        werkstatt.setSource(config.code);
      } else if (typeof config.source === "string") {
        werkstatt.setSource(config.source);
      }
      if (typeof config.parameters === "object" && config.parameters !== null) {
        werkstatt.setParameters(config.parameters as Record<string, number>);
      }
      break;
    }
    case "autotune": {
      const autotune = processor as AutotuneEffect;
      if (typeof config.key === "string") {
        autotune.setKey(config.key);
      }
      if (typeof config.scale === "string") {
        autotune.setScale(config.scale);
      }
      if (typeof config.amount === "number") {
        autotune.setAmount(config.amount);
      }
      if (typeof config.retune === "number") {
        autotune.setRetune(config.retune);
      }
      if (typeof config.retuneAmount === "number") {
        autotune.setRetune(config.retuneAmount * 80);
      }
      if (typeof config.shift === "number") {
        autotune.setShift(config.shift);
      }
      if (typeof config.smoothing === "number") {
        autotune.setSmoothing(config.smoothing);
      }
      if (typeof config.smooth === "number") {
        autotune.setSmoothing(config.smooth);
      }
      break;
    }
    case "fxComposite":
    case "stereoSplit":
    case "frequencySplit": {
      if (
        processor instanceof ContainerEffect &&
        typeof config.type === "string"
      ) {
        processor.configure(config as unknown as EffectConfig);
      }
      break;
    }
    default:
      break;
  }
}
