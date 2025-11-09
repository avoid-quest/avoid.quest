import type {
  AudioContext,
  AudioNode,
  BiquadFilterNode,
  Cacophony,
  ConvolverNode,
  Playback,
  Sound,
  StereoPannerNode,
} from "@avoid.quest/cacophony";
import type {
  BiquadFilterConfig,
  CompressorConfig,
  DelayConfig,
  DelayNode,
  DistortionConfig,
  DynamicsCompressorNode,
  EffectConfig,
  EffectInstance,
  EffectNode,
  PannerConfig,
  ReverbConfig,
  WaveShaperNode,
} from "./types";

export class EffectManager {
  private readonly cacophony: Cacophony;
  private effects: EffectInstance[] = [];
  private inputNode: AudioNode | null = null;
  private defaultDestination: AudioNode | null = null;

  constructor(
    cacophony: Cacophony,
    _sound: Sound,
    _playback: Playback | null = null
  ) {
    this.cacophony = cacophony;
    this.defaultDestination = cacophony.globalGainNode as unknown as AudioNode;
  }

  /**
   * Set the input node (usually the playback outputNode)
   */
  setInputNode(node: AudioNode): void {
    this.inputNode = node;
    this.rebuildChain();
  }

  /**
   * Set the output node (usually the globalGainNode)
   */
  setOutputNode(node: AudioNode): void {
    this.defaultDestination = node;
    this.rebuildChain();
  }

  /**
   * Add an effect to the chain
   */
  addEffect(config: EffectConfig): void {
    const instance: EffectInstance = {
      config,
      node: null,
    };

    // Insert at the correct position based on order
    const insertIndex = this.effects.findIndex(
      (e) => e.config.order > config.order
    );
    if (insertIndex === -1) {
      this.effects.push(instance);
    } else {
      this.effects.splice(insertIndex, 0, instance);
    }

    this.rebuildChain();
  }

  /**
   * Remove an effect from the chain
   */
  removeEffect(effectId: string): void {
    const index = this.effects.findIndex((e) => e.config.id === effectId);
    if (index === -1) {
      return;
    }

    const effect = this.effects[index];
    if (effect) {
      this.cleanupEffect(effect);
    }
    this.effects.splice(index, 1);

    // Reorder remaining effects
    this.effects.forEach((e, i) => {
      e.config.order = i;
    });

    this.rebuildChain();
  }

  /**
   * Update an effect's configuration
   */
  updateEffect(effectId: string, config: Partial<EffectConfig>): void {
    const effect = this.effects.find((e) => e.config.id === effectId);
    if (!effect) {
      return;
    }

    effect.config = { ...effect.config, ...config } as EffectConfig;
    this.updateEffectNode(effect);
  }

  /**
   * Reorder effects in the chain
   */
  reorderEffects(effectIds: string[]): void {
    // Create a map of new positions
    const newOrder = new Map<string, number>();
    effectIds.forEach((id, index) => {
      newOrder.set(id, index);
    });

    // Update order values
    for (const effect of this.effects) {
      const newOrderValue = newOrder.get(effect.config.id);
      if (newOrderValue !== undefined) {
        effect.config.order = newOrderValue;
      }
    }

    // Sort effects by order
    this.effects.sort((a, b) => a.config.order - b.config.order);

    this.rebuildChain();
  }

  /**
   * Get all effects in the chain
   */
  getEffects(): EffectInstance[] {
    return [...this.effects];
  }

  /**
   * Get effect by ID
   */
  getEffect(effectId: string): EffectInstance | undefined {
    return this.effects.find((e) => e.config.id === effectId);
  }

  /**
   * Rebuild the entire effect chain
   */
  private rebuildChain(): void {
    if (!(this.inputNode && this.defaultDestination)) {
      return;
    }

    // Disconnect everything
    this.disconnectAll();

    // If no effects, connect input directly to output
    if (this.effects.length === 0) {
      this.inputNode.connect(this.defaultDestination);
      return;
    }

    const enabledEffects = this.effects.filter((e) => e.config.enabled);
    if (enabledEffects.length === 0) {
      this.inputNode.connect(this.defaultDestination);
      return;
    }

    const currentNode = this.buildEffectChain(enabledEffects);
    this.connectToDestination(currentNode);
  }

  /**
   * Build the effect chain and return the last node
   */
  private buildEffectChain(enabledEffects: EffectInstance[]): AudioNode {
    if (!this.inputNode) {
      throw new Error("Input node not set");
    }
    let currentNode: AudioNode = this.inputNode;

    for (const effect of enabledEffects) {
      // Create or get the effect node
      if (!effect.node) {
        const newNode = this.createEffectNode(effect.config);
        if (newNode) {
          effect.node = newNode;
        }
      }

      if (!effect.node) {
        continue;
      }

      currentNode = this.connectEffect(effect, currentNode);
    }

    return currentNode;
  }

  /**
   * Connect an effect to the chain and return the output node
   */
  private connectEffect(
    effect: EffectInstance,
    currentNode: AudioNode
  ): AudioNode {
    // Handle effects that need wet/dry routing (reverb, delay)
    if (this.needsWetDryRouting(effect.config)) {
      // Create a merge node to combine wet and dry signals
      const mergeNode = this.cacophony.context.createGain();
      mergeNode.gain.value = 1.0;

      // Setup wet/dry routing - both paths output to merge node
      this.setupWetDryRouting(effect, currentNode, mergeNode);

      // Continue chain from merge node
      return mergeNode as unknown as AudioNode;
    }

    // Simple pass-through effects
    const effectNode = effect.node as unknown as AudioNode;
    currentNode.connect(effectNode);
    return effectNode;
  }

  /**
   * Connect the last node to the destination
   */
  private connectToDestination(currentNode: AudioNode): void {
    if (!this.defaultDestination) {
      return;
    }
    if (currentNode !== this.inputNode && this.inputNode) {
      currentNode.connect(this.defaultDestination);
    } else if (this.inputNode) {
      // No enabled effects, connect input directly
      this.inputNode.connect(this.defaultDestination);
    }
  }

  /**
   * Create an effect node from config
   */
  private createEffectNode(config: EffectConfig): EffectNode | null {
    const context = this.cacophony.context;

    try {
      switch (config.type) {
        case "biquadFilter": {
          const filterConfig = config as BiquadFilterConfig;
          const filter = this.cacophony.createBiquadFilter({
            type: filterConfig.filterType,
            frequency: filterConfig.frequency,
            Q: filterConfig.Q,
            gain: filterConfig.gain,
          });
          return filter as unknown as BiquadFilterNode;
        }

        case "reverb": {
          const reverbConfig = config as ReverbConfig;
          const reverb = context.createConvolver();
          const impulseResponse = this.generateImpulseResponse(
            context,
            reverbConfig.roomSize,
            reverbConfig.decayTime
          );
          reverb.buffer = impulseResponse;
          reverb.normalize = false;
          return reverb as ConvolverNode;
        }

        case "delay": {
          const delayConfig = config as DelayConfig;
          const delay = context.createDelay(1.0);
          delay.delayTime.value = delayConfig.delayTime;
          return delay as DelayNode;
        }

        case "distortion": {
          const distortionConfig = config as DistortionConfig;
          const shaper = context.createWaveShaper();
          shaper.curve = this.makeDistortionCurve(distortionConfig.amount);
          shaper.oversample = distortionConfig.oversample;
          return shaper as WaveShaperNode;
        }

        case "compressor": {
          const compressorConfig = config as CompressorConfig;
          const compressor = context.createDynamicsCompressor();
          compressor.threshold.value = compressorConfig.threshold;
          compressor.ratio.value = compressorConfig.ratio;
          compressor.attack.value = compressorConfig.attack;
          compressor.release.value = compressorConfig.release;
          compressor.knee.value = compressorConfig.knee;
          return compressor as DynamicsCompressorNode;
        }

        case "panner": {
          const pannerConfig = config as PannerConfig;
          const panner = context.createStereoPanner();
          panner.pan.value = pannerConfig.pan;
          return panner as StereoPannerNode;
        }

        default:
          return null;
      }
    } catch (error) {
      console.error(`Failed to create effect node for ${config.type}:`, error);
      return null;
    }
  }

  /**
   * Update an effect node's parameters
   */
  private updateEffectNode(effect: EffectInstance): void {
    const wasEnabled = effect.node !== null;
    const isEnabled = effect.config.enabled;

    // If effect is being disabled, disconnect and clean up immediately
    if (wasEnabled && !isEnabled) {
      this.cleanupEffect(effect);
      effect.node = null;
      effect.wetGain = undefined;
      effect.dryGain = undefined;
      effect.feedbackGain = undefined;
      this.rebuildChain();
      return;
    }

    // If effect is being enabled but has no node, create it
    if (!effect.node && isEnabled) {
      const newNode = this.createEffectNode(effect.config);
      if (newNode) {
        effect.node = newNode;
      }
      this.rebuildChain();
      return;
    }

    // If effect is disabled and has no node, nothing to do
    if (!(effect.node || isEnabled)) {
      return;
    }

    // If effect is enabled, update its parameters
    if (isEnabled && effect.node) {
      this.updateEffectNodeParams(effect);
    }
  }

  /**
   * Update effect node parameters (extracted to reduce complexity)
   */
  private updateEffectNodeParams(effect: EffectInstance): void {
    if (!effect.node) {
      return;
    }

    const context = this.cacophony.context;
    const now = context.currentTime;
    const smoothTime = 0.01;

    try {
      switch (effect.config.type) {
        case "biquadFilter":
          this.updateBiquadFilter(effect, now, smoothTime);
          break;
        case "reverb":
          this.updateReverb(effect, context, now, smoothTime);
          break;
        case "delay":
          this.updateDelay(effect, now, smoothTime);
          break;
        case "distortion":
          this.updateDistortion(effect);
          break;
        case "compressor":
          this.updateCompressor(effect, now, smoothTime);
          break;
        case "panner":
          this.updatePanner(effect, now, smoothTime);
          break;
        default: {
          // Unknown effect type, do nothing
          break;
        }
      }
    } catch (error) {
      console.error("Failed to update effect node:", error);
    }
  }

  private updateBiquadFilter(
    effect: EffectInstance,
    now: number,
    smoothTime: number
  ): void {
    const filterConfig = effect.config as BiquadFilterConfig;
    const filter = effect.node as BiquadFilterNode;
    if (filter.type !== filterConfig.filterType) {
      filter.type = filterConfig.filterType;
    }
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(filter.frequency.value, now);
    filter.frequency.exponentialRampToValueAtTime(
      filterConfig.frequency,
      now + smoothTime
    );
    filter.Q.cancelScheduledValues(now);
    filter.Q.setValueAtTime(filter.Q.value, now);
    filter.Q.exponentialRampToValueAtTime(filterConfig.Q, now + smoothTime);
    filter.gain.cancelScheduledValues(now);
    filter.gain.setValueAtTime(filter.gain.value, now);
    filter.gain.linearRampToValueAtTime(filterConfig.gain, now + smoothTime);
  }

  private updateReverb(
    effect: EffectInstance,
    context: AudioContext,
    now: number,
    smoothTime: number
  ): void {
    const reverbConfig = effect.config as ReverbConfig;
    const reverb = effect.node as ConvolverNode;
    // Regenerate impulse response if room size or decay changed
    const oldConfig = this.effects.find((e) => e.config.id === effect.config.id)
      ?.config as ReverbConfig | undefined;
    if (
      oldConfig &&
      (oldConfig.roomSize !== reverbConfig.roomSize ||
        oldConfig.decayTime !== reverbConfig.decayTime)
    ) {
      const impulseResponse = this.generateImpulseResponse(
        context,
        reverbConfig.roomSize,
        reverbConfig.decayTime
      );
      reverb.buffer = impulseResponse;
    }
    // Update wet/dry gains
    if (effect.wetGain && effect.dryGain) {
      this.updateWetDryGains(effect, reverbConfig.wet, reverbConfig.dry, {
        now,
        smoothTime,
      });
    }
  }

  private updateDelay(
    effect: EffectInstance,
    now: number,
    smoothTime: number
  ): void {
    const delayConfig = effect.config as DelayConfig;
    const delay = effect.node as DelayNode;
    delay.delayTime.cancelScheduledValues(now);
    delay.delayTime.setValueAtTime(delay.delayTime.value, now);
    delay.delayTime.linearRampToValueAtTime(
      delayConfig.delayTime,
      now + smoothTime
    );
    // Update feedback gain
    if (effect.feedbackGain) {
      effect.feedbackGain.gain.cancelScheduledValues(now);
      effect.feedbackGain.gain.setValueAtTime(
        effect.feedbackGain.gain.value,
        now
      );
      effect.feedbackGain.gain.linearRampToValueAtTime(
        delayConfig.feedback,
        now + smoothTime
      );
    }
    // Update wet/dry gains
    if (effect.wetGain && effect.dryGain) {
      this.updateWetDryGains(effect, delayConfig.wet, delayConfig.dry, {
        now,
        smoothTime,
      });
    }
  }

  private updateDistortion(effect: EffectInstance): void {
    const distortionConfig = effect.config as DistortionConfig;
    const shaper = effect.node as WaveShaperNode;
    shaper.curve = this.makeDistortionCurve(distortionConfig.amount);
    shaper.oversample = distortionConfig.oversample;
  }

  private updateCompressor(
    effect: EffectInstance,
    now: number,
    smoothTime: number
  ): void {
    const compressorConfig = effect.config as CompressorConfig;
    const compressor = effect.node as DynamicsCompressorNode;
    compressor.threshold.cancelScheduledValues(now);
    compressor.threshold.setValueAtTime(compressor.threshold.value, now);
    compressor.threshold.linearRampToValueAtTime(
      compressorConfig.threshold,
      now + smoothTime
    );
    compressor.ratio.cancelScheduledValues(now);
    compressor.ratio.setValueAtTime(compressor.ratio.value, now);
    compressor.ratio.linearRampToValueAtTime(
      compressorConfig.ratio,
      now + smoothTime
    );
    compressor.attack.cancelScheduledValues(now);
    compressor.attack.setValueAtTime(compressor.attack.value, now);
    compressor.attack.linearRampToValueAtTime(
      compressorConfig.attack,
      now + smoothTime
    );
    compressor.release.cancelScheduledValues(now);
    compressor.release.setValueAtTime(compressor.release.value, now);
    compressor.release.linearRampToValueAtTime(
      compressorConfig.release,
      now + smoothTime
    );
    compressor.knee.cancelScheduledValues(now);
    compressor.knee.setValueAtTime(compressor.knee.value, now);
    compressor.knee.linearRampToValueAtTime(
      compressorConfig.knee,
      now + smoothTime
    );
  }

  private updatePanner(
    effect: EffectInstance,
    now: number,
    smoothTime: number
  ): void {
    const pannerConfig = effect.config as PannerConfig;
    const panner = effect.node as StereoPannerNode;
    panner.pan.cancelScheduledValues(now);
    panner.pan.setValueAtTime(panner.pan.value, now);
    panner.pan.linearRampToValueAtTime(pannerConfig.pan, now + smoothTime);
  }

  private updateWetDryGains(
    effect: EffectInstance,
    wet: number,
    dry: number,
    timing: { now: number; smoothTime: number }
  ): void {
    const { wetGain, dryGain } = effect;
    if (!wetGain) {
      return;
    }
    if (!dryGain) {
      return;
    }
    wetGain.gain.cancelScheduledValues(timing.now);
    wetGain.gain.setValueAtTime(wetGain.gain.value, timing.now);
    wetGain.gain.linearRampToValueAtTime(wet, timing.now + timing.smoothTime);
    dryGain.gain.cancelScheduledValues(timing.now);
    dryGain.gain.setValueAtTime(dryGain.gain.value, timing.now);
    dryGain.gain.linearRampToValueAtTime(dry, timing.now + timing.smoothTime);
  }

  /**
   * Check if an effect needs wet/dry routing
   */
  private needsWetDryRouting(config: EffectConfig): boolean {
    return config.type === "reverb" || config.type === "delay";
  }

  /**
   * Setup wet/dry routing for effects that need it
   */
  private setupWetDryRouting(
    effect: EffectInstance,
    inputNode: AudioNode,
    outputNode: AudioNode
  ): void {
    if (!effect.node) {
      return;
    }

    const context = this.cacophony.context;

    // Create gain nodes if they don't exist
    if (!effect.wetGain) {
      effect.wetGain = context.createGain();
    }
    if (!effect.dryGain) {
      effect.dryGain = context.createGain();
    }

    // Set gain values
    if (effect.config.type === "reverb") {
      const config = effect.config as ReverbConfig;
      effect.wetGain.gain.value = config.wet;
      effect.dryGain.gain.value = config.dry;
    } else if (effect.config.type === "delay") {
      const config = effect.config as DelayConfig;
      effect.wetGain.gain.value = config.wet;
      effect.dryGain.gain.value = config.dry;

      // Setup feedback loop for delay
      if (!effect.feedbackGain) {
        effect.feedbackGain = context.createGain();
      }
      effect.feedbackGain.gain.value = config.feedback;
      effect.node.connect(effect.feedbackGain);
      effect.feedbackGain.connect(effect.node);
    }

    // Route dry signal: input → dryGain → output
    inputNode.connect(effect.dryGain);
    effect.dryGain.connect(outputNode);

    // Route wet signal: input → effect → wetGain → output
    inputNode.connect(effect.node);
    effect.node.connect(effect.wetGain);
    effect.wetGain.connect(outputNode);
  }

  /**
   * Generate impulse response for reverb
   */
  private generateImpulseResponse(
    context: AudioContext,
    roomSize: number,
    decayTime: number
  ): import("@avoid.quest/cacophony").AudioBuffer {
    const sampleRate = context.sampleRate;
    const length = Math.floor(decayTime * sampleRate);
    const impulse = context.createBuffer(2, length, sampleRate);
    const leftChannel = impulse.getChannelData(0);
    const rightChannel = impulse.getChannelData(1);

    const decaySamples = decayTime * sampleRate;
    for (let i = 0; i < length; i++) {
      const decay = Math.exp((-i / decaySamples) * (1 + roomSize));
      const noise = (Math.random() * 2 - 1) * 0.1;
      const value = decay * (1 + noise) * roomSize;
      leftChannel[i] = value;
      rightChannel[i] = value * (0.9 + Math.random() * 0.2);
    }

    return impulse;
  }

  /**
   * Create distortion curve for wave shaper
   */
  private makeDistortionCurve(amount: number): Float32Array {
    const samples = 44_100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    const k = amount * 2;

    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }

    return curve;
  }

  /**
   * Disconnect all nodes
   */
  private disconnectAll(): void {
    if (this.inputNode) {
      this.inputNode.disconnect();
    }

    for (const effect of this.effects) {
      if (effect.node) {
        effect.node.disconnect();
      }
      if (effect.wetGain) {
        effect.wetGain.disconnect();
      }
      if (effect.dryGain) {
        effect.dryGain.disconnect();
      }
      if (effect.feedbackGain) {
        effect.feedbackGain.disconnect();
      }
    }
  }

  /**
   * Cleanup a single effect
   */
  private cleanupEffect(effect: EffectInstance): void {
    if (effect.node) {
      effect.node.disconnect();
    }
    if (effect.wetGain) {
      effect.wetGain.disconnect();
    }
    if (effect.dryGain) {
      effect.dryGain.disconnect();
    }
    if (effect.feedbackGain) {
      effect.feedbackGain.disconnect();
    }
  }

  /**
   * Cleanup all effects
   */
  cleanup(): void {
    this.disconnectAll();
    for (const effect of this.effects) {
      this.cleanupEffect(effect);
    }
    this.effects = [];
  }
}
