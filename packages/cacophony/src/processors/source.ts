import { type int } from "@opendaw/lib-std";
import { BiquadFilter, type BiquadFilterType } from "./effects/biquad-filter.js";
import { DattorroReverb } from "./effects/reverb.js";
import { FreeVerbReverb } from "./effects/freeverb-reverb.js";
import { PhaseVocoder } from "./effects/phase-vocoder.js";
import { Distortion } from "./effects/distortion.js";
import { Compressor } from "./effects/compressor.js";
import { StereoDelay } from "./effects/stereo-delay.js";
import { CrusherEffect } from "./effects/crusher.js";
import { FoldEffect } from "./effects/fold.js";
import { StereoToolEffect } from "./effects/stereo-tool.js";
import { RevampEffect } from "./effects/revamp.js";
import { TidalEffect } from "./effects/tidal.js";
import type { EffectType } from "../protocol.js";

type Effect =
  | BiquadFilter
  | DattorroReverb
  | FreeVerbReverb
  | PhaseVocoder
  | Distortion
  | Compressor
  | StereoDelay
  | CrusherEffect
  | FoldEffect
  | StereoToolEffect
  | RevampEffect
  | TidalEffect;

export abstract class Source {
  protected filters: Map<string, BiquadFilter> = new Map();
  // Filter chain order - array of IDs
  protected filterOrder: string[] = [];
  
  protected effects: Map<string, Effect> = new Map();
  // Effect chain order - array of IDs
  protected effectOrder: string[] = [];
  // Track order for each effect
  private effectOrders: Map<string, number> = new Map();

  abstract process(
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): boolean; // Returns false if finished

  addFilter(id: string, type: BiquadFilterType, freq: number, Q: number, gain: number) {
    const filter = new BiquadFilter(globalThis.sampleRate);
    filter.type = type;
    filter.frequency = freq;
    filter.Q = Q;
    filter.gain = gain;
    this.filters.set(id, filter);
    this.filterOrder.push(id);
  }

  removeFilter(id: string) {
    this.filters.delete(id);
    this.filterOrder = this.filterOrder.filter(fid => fid !== id);
  }

  setFilterParam(id: string, param: string, value: number | string) {
    const filter = this.filters.get(id);
    if (!filter) return;

    switch (param) {
      case 'frequency': filter.frequency = value as number; break;
      case 'Q': filter.Q = value as number; break;
      case 'gain': filter.gain = value as number; break;
      case 'type': filter.type = value as BiquadFilterType; break;
    }
  }

  /**
   * Applies filters in chain order to the input buffers (in-place)
   */
  protected applyFilters(
    bufferL: Float32Array,
    bufferR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): void {
    if (this.filterOrder.length === 0) return;

    for (const id of this.filterOrder) {
      const filter = this.filters.get(id);
      if (filter) {
        // Process in-place: input and output are same arrays
        filter.process(bufferL, bufferR, bufferL, bufferR, fromIndex, toIndex);
      }
    }
  }

  addEffect(id: string, type: EffectType, config: Record<string, number>, order: number): void {
    const sampleRate = globalThis.sampleRate;
    let effect: Effect;

    switch (type) {
      case "biquadFilter": {
        const filter = new BiquadFilter(sampleRate);
        if (config.filterType !== undefined) {
          const filterTypes: BiquadFilterType[] = [
            "lowpass", "highpass", "bandpass", "lowshelf",
            "highshelf", "peaking", "notch", "allpass"
          ];
          filter.type = filterTypes[config.filterType] ?? "lowpass";
        }
        if (config.frequency !== undefined) filter.frequency = config.frequency;
        if (config.Q !== undefined) filter.Q = config.Q;
        if (config.gain !== undefined) filter.gain = config.gain;
        effect = filter;
        break;
      }
      case "reverb": {
        const reverb = new DattorroReverb(sampleRate);
        if (config.preDelay !== undefined) reverb.setPreDelay(config.preDelay);
        if (config.bandwidth !== undefined) reverb.setBandwidth(config.bandwidth);
        if (config.inputDiffusion1 !== undefined) reverb.setInputDiffusion1(config.inputDiffusion1);
        if (config.inputDiffusion2 !== undefined) reverb.setInputDiffusion2(config.inputDiffusion2);
        if (config.decay !== undefined) reverb.setDecay(config.decay);
        if (config.decayDiffusion1 !== undefined) reverb.setDecayDiffusion1(config.decayDiffusion1);
        if (config.decayDiffusion2 !== undefined) reverb.setDecayDiffusion2(config.decayDiffusion2);
        if (config.damping !== undefined) reverb.setDamping(config.damping);
        if (config.excursionRate !== undefined) reverb.setExcursionRate(config.excursionRate);
        if (config.excursionDepth !== undefined) reverb.setExcursionDepth(config.excursionDepth);
        if (config.wet !== undefined) reverb.setWet(config.wet);
        if (config.dry !== undefined) reverb.setDry(config.dry);
        effect = reverb;
        break;
      }
      case "phaseVocoder": {
        const vocoder = new PhaseVocoder(sampleRate);
        if (config.pitchFactor !== undefined) vocoder.setPitchFactor(config.pitchFactor);
        effect = vocoder;
        break;
      }
      case "distortion": {
        const distortion = new Distortion(sampleRate);
        if (config.amount !== undefined) distortion.setAmount(config.amount);
        effect = distortion;
        break;
      }
      case "compressor": {
        const compressor = new Compressor(sampleRate);
        if (config.threshold !== undefined) compressor.setThreshold(config.threshold);
        if (config.ratio !== undefined) compressor.setRatio(config.ratio);
        if (config.attack !== undefined) compressor.setAttack(config.attack);
        if (config.release !== undefined) compressor.setRelease(config.release);
        if (config.knee !== undefined) compressor.setKnee(config.knee);
        effect = compressor;
        break;
      }
      case "delay": {
        const delay = new StereoDelay(sampleRate * 2, 128);
        if (config.delayTime !== undefined) delay.offset = config.delayTime * sampleRate;
        if (config.feedback !== undefined) delay.feedback = config.feedback;
        if (config.wet !== undefined && config.dry !== undefined) {
          delay.mix(config.wet, config.dry);
        }
        effect = delay;
        break;
      }
      case "standardReverb": {
        const reverb = new FreeVerbReverb(sampleRate);
        if (config.roomSize !== undefined) reverb.setRoomSize(config.roomSize);
        if (config.damp !== undefined) reverb.setDamp(config.damp);
        if (config.preDelay !== undefined) reverb.setPreDelay(config.preDelay);
        if (config.wet !== undefined) reverb.setWet(config.wet);
        if (config.dry !== undefined) reverb.setDry(config.dry);
        effect = reverb;
        break;
      }
      case "crusher": {
        const crusher = new CrusherEffect(sampleRate);
        if (config.crush !== undefined) crusher.setCrush(config.crush);
        if (config.bitDepth !== undefined) crusher.setBitDepth(config.bitDepth);
        if (config.boost !== undefined) crusher.setBoost(config.boost);
        if (config.mix !== undefined) crusher.setMix(config.mix);
        effect = crusher;
        break;
      }
      case "fold": {
        const fold = new FoldEffect(sampleRate);
        if (config.amount !== undefined) fold.setAmount(config.amount);
        if (config.volume !== undefined) fold.setVolume(config.volume);
        if (config.oversample !== undefined) {
          const factor = config.oversample === 2 ? 2 : config.oversample === 4 ? 4 : 8;
          fold.setOversample(factor);
        }
        effect = fold;
        break;
      }
      case "stereoTool": {
        const stereoTool = new StereoToolEffect(sampleRate);
        if (config.volume !== undefined) stereoTool.setVolume(config.volume);
        if (config.panning !== undefined) stereoTool.setPanning(config.panning);
        if (config.stereo !== undefined) stereoTool.setStereoWidth(config.stereo);
        if (config.invertL !== undefined) stereoTool.setInvertL(config.invertL !== 0);
        if (config.invertR !== undefined) stereoTool.setInvertR(config.invertR !== 0);
        if (config.swap !== undefined) stereoTool.setSwap(config.swap !== 0);
        effect = stereoTool;
        break;
      }
      case "revamp": {
        const revamp = new RevampEffect(sampleRate);
        // Highpass
        if (config.highPassEnabled !== undefined) revamp.setHighPassEnabled(config.highPassEnabled !== 0);
        if (config.highPassFrequency !== undefined) revamp.setHighPassFrequency(config.highPassFrequency);
        if (config.highPassQ !== undefined) revamp.setHighPassQ(config.highPassQ);
        if (config.highPassOrder !== undefined) revamp.setHighPassOrder(config.highPassOrder);
        // Low shelf
        if (config.lowShelfEnabled !== undefined) revamp.setLowShelfEnabled(config.lowShelfEnabled !== 0);
        if (config.lowShelfFrequency !== undefined) revamp.setLowShelfFrequency(config.lowShelfFrequency);
        if (config.lowShelfGain !== undefined) revamp.setLowShelfGain(config.lowShelfGain);
        // Low bell
        if (config.lowBellEnabled !== undefined) revamp.setLowBellEnabled(config.lowBellEnabled !== 0);
        if (config.lowBellFrequency !== undefined) revamp.setLowBellFrequency(config.lowBellFrequency);
        if (config.lowBellGain !== undefined) revamp.setLowBellGain(config.lowBellGain);
        if (config.lowBellQ !== undefined) revamp.setLowBellQ(config.lowBellQ);
        // Mid bell
        if (config.midBellEnabled !== undefined) revamp.setMidBellEnabled(config.midBellEnabled !== 0);
        if (config.midBellFrequency !== undefined) revamp.setMidBellFrequency(config.midBellFrequency);
        if (config.midBellGain !== undefined) revamp.setMidBellGain(config.midBellGain);
        if (config.midBellQ !== undefined) revamp.setMidBellQ(config.midBellQ);
        // High bell
        if (config.highBellEnabled !== undefined) revamp.setHighBellEnabled(config.highBellEnabled !== 0);
        if (config.highBellFrequency !== undefined) revamp.setHighBellFrequency(config.highBellFrequency);
        if (config.highBellGain !== undefined) revamp.setHighBellGain(config.highBellGain);
        if (config.highBellQ !== undefined) revamp.setHighBellQ(config.highBellQ);
        // High shelf
        if (config.highShelfEnabled !== undefined) revamp.setHighShelfEnabled(config.highShelfEnabled !== 0);
        if (config.highShelfFrequency !== undefined) revamp.setHighShelfFrequency(config.highShelfFrequency);
        if (config.highShelfGain !== undefined) revamp.setHighShelfGain(config.highShelfGain);
        // Lowpass
        if (config.lowPassEnabled !== undefined) revamp.setLowPassEnabled(config.lowPassEnabled !== 0);
        if (config.lowPassFrequency !== undefined) revamp.setLowPassFrequency(config.lowPassFrequency);
        if (config.lowPassQ !== undefined) revamp.setLowPassQ(config.lowPassQ);
        if (config.lowPassOrder !== undefined) revamp.setLowPassOrder(config.lowPassOrder);
        effect = revamp;
        break;
      }
      case "tidal": {
        const tidal = new TidalEffect(sampleRate);
        if (config.rate !== undefined) tidal.setRate(config.rate);
        if (config.depth !== undefined) tidal.setDepth(config.depth);
        if (config.slope !== undefined) tidal.setSlope(config.slope);
        if (config.symmetry !== undefined) tidal.setSymmetry(config.symmetry);
        if (config.offset !== undefined) tidal.setOffset(config.offset);
        if (config.channelOffset !== undefined) tidal.setChannelOffset(config.channelOffset);
        effect = tidal;
        break;
      }
      default:
        return;
    }

    this.effects.set(id, effect);
    this.effectOrders.set(id, order);
    
    // Insert at correct position based on order
    // Find the first effect with order greater than this one
    let insertIndex = -1;
    for (let i = 0; i < this.effectOrder.length; i++) {
      const existingOrder = this.effectOrders.get(this.effectOrder[i] ?? "");
      if (existingOrder !== undefined && existingOrder > order) {
        insertIndex = i;
        break;
      }
    }
    
    if (insertIndex === -1) {
      this.effectOrder.push(id);
    } else {
      this.effectOrder.splice(insertIndex, 0, id);
    }
  }

  removeEffect(id: string): void {
    this.effects.delete(id);
    this.effectOrders.delete(id);
    this.effectOrder = this.effectOrder.filter(eid => eid !== id);
  }

  updateEffect(id: string, config: Partial<Record<string, number>>): void {
    const effect = this.effects.get(id);
    if (!effect) return;

    if (effect instanceof BiquadFilter) {
      if (config.filterType !== undefined) {
        const filterTypes: BiquadFilterType[] = [
          "lowpass", "highpass", "bandpass", "lowshelf",
          "highshelf", "peaking", "notch", "allpass"
        ];
        effect.type = filterTypes[config.filterType] ?? "lowpass";
      }
      if (config.frequency !== undefined) effect.frequency = config.frequency;
      if (config.Q !== undefined) effect.Q = config.Q;
      if (config.gain !== undefined) effect.gain = config.gain;
    } else if (effect instanceof DattorroReverb) {
      if (config.preDelay !== undefined) effect.setPreDelay(config.preDelay);
      if (config.bandwidth !== undefined) effect.setBandwidth(config.bandwidth);
      if (config.inputDiffusion1 !== undefined) effect.setInputDiffusion1(config.inputDiffusion1);
      if (config.inputDiffusion2 !== undefined) effect.setInputDiffusion2(config.inputDiffusion2);
      if (config.decay !== undefined) effect.setDecay(config.decay);
      if (config.decayDiffusion1 !== undefined) effect.setDecayDiffusion1(config.decayDiffusion1);
      if (config.decayDiffusion2 !== undefined) effect.setDecayDiffusion2(config.decayDiffusion2);
      if (config.damping !== undefined) effect.setDamping(config.damping);
      if (config.excursionRate !== undefined) effect.setExcursionRate(config.excursionRate);
      if (config.excursionDepth !== undefined) effect.setExcursionDepth(config.excursionDepth);
      if (config.wet !== undefined) effect.setWet(config.wet);
      if (config.dry !== undefined) effect.setDry(config.dry);
    } else if (effect instanceof PhaseVocoder) {
      if (config.pitchFactor !== undefined) effect.setPitchFactor(config.pitchFactor);
    } else if (effect instanceof Distortion) {
      if (config.amount !== undefined) effect.setAmount(config.amount);
    } else if (effect instanceof Compressor) {
      if (config.threshold !== undefined) effect.setThreshold(config.threshold);
      if (config.ratio !== undefined) effect.setRatio(config.ratio);
      if (config.attack !== undefined) effect.setAttack(config.attack);
      if (config.release !== undefined) effect.setRelease(config.release);
      if (config.knee !== undefined) effect.setKnee(config.knee);
    } else if (effect instanceof StereoDelay) {
      if (config.delayTime !== undefined) effect.offset = config.delayTime * globalThis.sampleRate;
      if (config.feedback !== undefined) effect.feedback = config.feedback;
      if (config.wet !== undefined && config.dry !== undefined) {
        effect.mix(config.wet, config.dry);
      }
    } else if (effect instanceof FreeVerbReverb) {
      if (config.roomSize !== undefined) effect.setRoomSize(config.roomSize);
      if (config.damp !== undefined) effect.setDamp(config.damp);
      if (config.preDelay !== undefined) effect.setPreDelay(config.preDelay);
      if (config.wet !== undefined) effect.setWet(config.wet);
      if (config.dry !== undefined) effect.setDry(config.dry);
    } else if (effect instanceof CrusherEffect) {
      if (config.crush !== undefined) effect.setCrush(config.crush);
      if (config.bitDepth !== undefined) effect.setBitDepth(config.bitDepth);
      if (config.boost !== undefined) effect.setBoost(config.boost);
      if (config.mix !== undefined) effect.setMix(config.mix);
    } else if (effect instanceof FoldEffect) {
      if (config.amount !== undefined) effect.setAmount(config.amount);
      if (config.volume !== undefined) effect.setVolume(config.volume);
      if (config.oversample !== undefined) {
        const factor = config.oversample === 2 ? 2 : config.oversample === 4 ? 4 : 8;
        effect.setOversample(factor);
      }
    } else if (effect instanceof StereoToolEffect) {
      if (config.volume !== undefined) effect.setVolume(config.volume);
      if (config.panning !== undefined) effect.setPanning(config.panning);
      if (config.stereo !== undefined) effect.setStereoWidth(config.stereo);
      if (config.invertL !== undefined) effect.setInvertL(config.invertL !== 0);
      if (config.invertR !== undefined) effect.setInvertR(config.invertR !== 0);
      if (config.swap !== undefined) effect.setSwap(config.swap !== 0);
    } else if (effect instanceof RevampEffect) {
      // Highpass
      if (config.highPassEnabled !== undefined) effect.setHighPassEnabled(config.highPassEnabled !== 0);
      if (config.highPassFrequency !== undefined) effect.setHighPassFrequency(config.highPassFrequency);
      if (config.highPassQ !== undefined) effect.setHighPassQ(config.highPassQ);
      if (config.highPassOrder !== undefined) effect.setHighPassOrder(config.highPassOrder);
      // Low shelf
      if (config.lowShelfEnabled !== undefined) effect.setLowShelfEnabled(config.lowShelfEnabled !== 0);
      if (config.lowShelfFrequency !== undefined) effect.setLowShelfFrequency(config.lowShelfFrequency);
      if (config.lowShelfGain !== undefined) effect.setLowShelfGain(config.lowShelfGain);
      // Low bell
      if (config.lowBellEnabled !== undefined) effect.setLowBellEnabled(config.lowBellEnabled !== 0);
      if (config.lowBellFrequency !== undefined) effect.setLowBellFrequency(config.lowBellFrequency);
      if (config.lowBellGain !== undefined) effect.setLowBellGain(config.lowBellGain);
      if (config.lowBellQ !== undefined) effect.setLowBellQ(config.lowBellQ);
      // Mid bell
      if (config.midBellEnabled !== undefined) effect.setMidBellEnabled(config.midBellEnabled !== 0);
      if (config.midBellFrequency !== undefined) effect.setMidBellFrequency(config.midBellFrequency);
      if (config.midBellGain !== undefined) effect.setMidBellGain(config.midBellGain);
      if (config.midBellQ !== undefined) effect.setMidBellQ(config.midBellQ);
      // High bell
      if (config.highBellEnabled !== undefined) effect.setHighBellEnabled(config.highBellEnabled !== 0);
      if (config.highBellFrequency !== undefined) effect.setHighBellFrequency(config.highBellFrequency);
      if (config.highBellGain !== undefined) effect.setHighBellGain(config.highBellGain);
      if (config.highBellQ !== undefined) effect.setHighBellQ(config.highBellQ);
      // High shelf
      if (config.highShelfEnabled !== undefined) effect.setHighShelfEnabled(config.highShelfEnabled !== 0);
      if (config.highShelfFrequency !== undefined) effect.setHighShelfFrequency(config.highShelfFrequency);
      if (config.highShelfGain !== undefined) effect.setHighShelfGain(config.highShelfGain);
      // Lowpass
      if (config.lowPassEnabled !== undefined) effect.setLowPassEnabled(config.lowPassEnabled !== 0);
      if (config.lowPassFrequency !== undefined) effect.setLowPassFrequency(config.lowPassFrequency);
      if (config.lowPassQ !== undefined) effect.setLowPassQ(config.lowPassQ);
      if (config.lowPassOrder !== undefined) effect.setLowPassOrder(config.lowPassOrder);
    } else if (effect instanceof TidalEffect) {
      if (config.rate !== undefined) effect.setRate(config.rate);
      if (config.depth !== undefined) effect.setDepth(config.depth);
      if (config.slope !== undefined) effect.setSlope(config.slope);
      if (config.symmetry !== undefined) effect.setSymmetry(config.symmetry);
      if (config.offset !== undefined) effect.setOffset(config.offset);
      if (config.channelOffset !== undefined) effect.setChannelOffset(config.channelOffset);
    }
  }

  reorderEffects(effectIds: string[]): void {
    // Update order based on provided array
    this.effectOrder = effectIds.filter(id => this.effects.has(id));
    // Add any effects not in the list at the end
    for (const [id] of this.effects) {
      if (!this.effectOrder.includes(id)) {
        this.effectOrder.push(id);
      }
    }
  }

  /**
   * Applies effects in chain order to the input buffers
   * Effects process in-place (input and output are same arrays)
   */
  protected applyEffects(
    bufferL: Float32Array,
    bufferR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): void {
    if (this.effectOrder.length === 0) return;

    for (const id of this.effectOrder) {
      const effect = this.effects.get(id);
      if (effect) {
        // Process in-place: input and output are same arrays
        effect.process(bufferL, bufferR, bufferL, bufferR, fromIndex, toIndex);
      }
    }
  }
}

export class BufferSource extends Source {
  private buffer: Float32Array[];
  private position: number = 0;
  private loop: boolean = false;
  private playbackRate: number = 1.0;
  private isPlaying: boolean = false; 
  private isPaused: boolean = false;
  private pausePosition: number = 0;
  
  // Internal buffers for processing before mixing
  private tempL: Float32Array | null = null;
  private tempR: Float32Array | null = null;

  constructor(buffer: Float32Array[], options: { loop?: boolean; playbackRate?: number } = {}) {
    super();
    this.buffer = buffer;
    this.loop = options.loop ?? false;
    this.playbackRate = options.playbackRate ?? 1.0;
  }

  // Lifecycle methods
  start(when?: number, offset?: number, duration?: number) {
    this.isPlaying = true;
    this.isPaused = false;
    this.position = (offset ?? 0) * globalThis.sampleRate;
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.position = 0;
    // Reset filters
    for (const filter of this.filters.values()) filter.reset();
    // Reset effects
    for (const effect of this.effects.values()) effect.reset();
  }

  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.isPaused = true;
      this.pausePosition = this.position;
    }
  }

  resume() {
    if (this.isPaused) {
      this.isPaused = false;
      this.position = this.pausePosition;
    }
  }

  seek(positionInSeconds: number) {
    this.position = positionInSeconds * globalThis.sampleRate;
    this.pausePosition = this.position;
  }

  volume = 1.0;
  pan = 0.0; // -1 (left) to 1 (right)

  process(
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): boolean {
    // If paused, stay active but don't produce audio
    if (this.isPaused) return true;
    
    // If not playing, source is finished
    if (!this.isPlaying) return false;
    
    if (!outputL || !outputR) return false;

    // Initialize temp buffers if needed
    if (!this.tempL || this.tempL.length < outputL.length) {
      this.tempL = new Float32Array(outputL.length);
      this.tempR = new Float32Array(outputR.length);
    }
    
    // Clear temp buffers for this block
    this.tempL!.fill(0, fromIndex, toIndex);
    this.tempR!.fill(0, fromIndex, toIndex);

    const bufferL = this.buffer[0];
    if (!bufferL) return false;
    const bufferR = this.buffer[1] || bufferL; // Mono fallback
    const bufferLength = bufferL.length;

    // Generate audio into temp buffers
    for (let i = fromIndex; i < toIndex; i++) {
        if (this.position >= bufferLength) {
            if (this.loop) {
              this.position = 0;
            } else {
              this.isPlaying = false;
              // If stopped mid-block, we still process what we have so far
              // But we can break generation here.
              // We should still process filters on the silence? Or just break.
              // Breaking is fine.
              break; 
            }
        }
        
        const readIndex = Math.floor(this.position);
        this.tempL![i] = bufferL[readIndex] ?? 0;
        this.tempR![i] = bufferR[readIndex] ?? 0;
        
        this.position += this.playbackRate;
    }

    // Apply filters to temp buffers
    this.applyFilters(this.tempL!, this.tempR!, fromIndex, toIndex);

    // Apply effects to temp buffers
    this.applyEffects(this.tempL!, this.tempR!, fromIndex, toIndex);

    // Apply volume/pan and mix to output
    let gainL = this.volume;
    let gainR = this.volume;
    
    if (this.pan < 0) {
      gainR *= (1 + this.pan);
    } else if (this.pan > 0) {
      gainL *= (1 - this.pan);
    }

    for (let i = fromIndex; i < toIndex; i++) {
      outputL[i]! += this.tempL![i]! * gainL;
      outputR[i]! += this.tempR![i]! * gainR;
    }

    return true;
  }
}


export class StreamSource extends Source {
  private chunks: Float32Array[][] = [];
  private currentChunkIndex: number = 0;
  private currentSampleIndex: number = 0;
  private isPlaying: boolean = false; // Start paused, consistent with BufferSource
  private isPaused: boolean = false;

  // Volume and pan for per-source control
  volume = 1.0;
  pan = 0.0; // -1 (left) to 1 (right)
  
  // Internal buffers
  private tempL: Float32Array | null = null;
  private tempR: Float32Array | null = null;

  constructor() {
    super();
  }

  // Lifecycle methods - consistent with BufferSource
  start() {
    this.isPlaying = true;
    this.isPaused = false;
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.chunks = [];
    this.currentChunkIndex = 0;
    this.currentSampleIndex = 0;
    // Reset filters
    for (const filter of this.filters.values()) filter.reset();
    // Reset effects
    for (const effect of this.effects.values()) effect.reset();
  }

  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.isPaused = true;
    }
  }

  resume() {
    if (this.isPaused) {
      this.isPaused = false;
    }
  }

  addChunk(chunk: Float32Array[]) {
    this.chunks.push(chunk);
  }

  process(
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): boolean {
    // If paused, stay active but don't produce audio
    if (this.isPaused) return true;
    
    // If not playing, keep alive to receive chunks (streams can restart)
    if (!this.isPlaying) return true;
    
    if (!outputL || !outputR) return false;

    // Initialize temp buffers if needed
    if (!this.tempL || this.tempL.length < outputL.length) {
      this.tempL = new Float32Array(outputL.length);
      this.tempR = new Float32Array(outputR.length);
    }
    
    // Clear temp buffers for this block
    this.tempL!.fill(0, fromIndex, toIndex);
    this.tempR!.fill(0, fromIndex, toIndex);

    for (let i = fromIndex; i < toIndex; i++) {
      if (this.currentChunkIndex >= this.chunks.length) {
        // Underrun - can't fetch more data
        // We still process what we have written so far to temp buffers (which is nothing for the remaining part)
        // Actually we initialized to 0, so it's silence.
        break; 
      }

      const chunk = this.chunks[this.currentChunkIndex];
      if (!chunk) break; 

      const chunkL = chunk[0];
      if (!chunkL) break;
      const chunkR = chunk[1] || chunkL;

      // Copy audio to temp buffers
      this.tempL![i] = chunkL[this.currentSampleIndex] ?? 0;
      this.tempR![i] = (chunkR ? chunkR[this.currentSampleIndex] : chunkL[this.currentSampleIndex]) ?? 0;

      this.currentSampleIndex++;

      if (this.currentSampleIndex >= chunkL.length) {
        this.currentChunkIndex++;
        this.currentSampleIndex = 0;
        // Clean up old chunks to save memory
        if (this.currentChunkIndex > 10) {
            this.chunks.splice(0, 5);
            this.currentChunkIndex -= 5;
        }
      }
    }
    
    // Apply filters
    this.applyFilters(this.tempL!, this.tempR!, fromIndex, toIndex);

    // Apply effects
    this.applyEffects(this.tempL!, this.tempR!, fromIndex, toIndex);

    // Calculate pan gains (simple linear balance)
    let gainL = this.volume;
    let gainR = this.volume;
    
    if (this.pan < 0) {
      gainR *= (1 + this.pan); // Pan left: reduce right
    } else if (this.pan > 0) {
      gainL *= (1 - this.pan); // Pan right: reduce left
    }

    // Mix to output
    for (let i = fromIndex; i < toIndex; i++) {
        outputL[i]! += this.tempL![i]! * gainL;
        outputR[i]! += this.tempR![i]! * gainR;
    }

    return true;
  }
}
