import type {
  AudioContext,
  AudioNode,
  BiquadFilterNode,
  Cacophony,
  ConvolverNode,
  DelayNode,
  DynamicsCompressorNode,
  PannerNode,
  Playback,
  Sound,
  WaveShaperNode,
} from "../cacophony-types";
import { getLogger, type Logger } from "../logger";
import type {
  BiquadFilterConfig,
  CompressorConfig,
  DelayConfig,
  DistortionConfig,
  EffectConfig,
  EffectInstance,
  EffectNode,
  PannerConfig,
  PhaseVocoderConfig,
  PlateReverbConfig,
  StandardReverbConfig,
} from "./types";

export class EffectManager {
  private readonly cacophony: Cacophony;
  private readonly logger: Logger;
  private effects: EffectInstance[] = [];
  private inputNode: AudioNode | null = null;
  private defaultDestination: AudioNode | null = null;

  constructor(
    cacophony: Cacophony,
    _sound: Sound,
    _playback: Playback | null = null,
    logger?: Logger
  ) {
    this.cacophony = cacophony;
    this.logger = getLogger(logger);
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
    for (const [i, e] of this.effects.entries()) {
      e.config.order = i;
    }

    this.rebuildChain();
  }

  /**
   * Update an effect's configuration
   * @returns Promise that resolves to true on success, false on failure
   */
  updateEffect(
    effectId: string,
    config: Partial<EffectConfig>
  ): Promise<boolean> {
    const effect = this.effects.find((e) => e.config.id === effectId);
    if (!effect) {
      return Promise.resolve(false);
    }

    effect.config = { ...effect.config, ...config } as EffectConfig;
    return this.updateEffectNode(effect);
  }

  /**
   * Reorder effects in the chain
   */
  reorderEffects(effectIds: string[]): void {
    // Create a map of new positions
    const newOrder = new Map<string, number>();
    for (const [index, effectId] of effectIds.entries()) {
      newOrder.set(effectId, index);
    }

    // Track original indices for effects not in effectIds
    const originalIndices = new Map<string, number>();

    for (const [index, effect] of this.effects.entries()) {
      originalIndices.set(effect.config.id, index);
    }

    // Update order values
    // Effects in effectIds get their new order (0 to effectIds.length - 1)
    // Effects not in effectIds get order at the end (effectIds.length + originalIndex)
    for (const effect of this.effects) {
      const newOrderValue = newOrder.get(effect.config.id);
      if (newOrderValue !== undefined) {
        effect.config.order = newOrderValue;
      } else {
        // Place missing effects at the end, preserving their relative order
        const originalIndex = originalIndices.get(effect.config.id) ?? 0;
        effect.config.order = effectIds.length + originalIndex;
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
  private async rebuildChain(): Promise<void> {
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

    // Check if we have any async effects that need async creation
    const hasAsyncEffects = enabledEffects.some(
      (e) =>
        (e.config.type === "plateReverb" || e.config.type === "phaseVocoder") &&
        !e.node
    );

    try {
      if (hasAsyncEffects) {
        // Handle async effect creation with proper error handling
        const currentNode = await this.buildEffectChainAsync(enabledEffects);
        this.connectToDestination(currentNode);
      } else {
        const currentNode = this.buildEffectChain(enabledEffects);
        this.connectToDestination(currentNode);
      }
    } catch (error) {
      this.handleBuildChainError(error, enabledEffects);
    }
  }

  /**
   * Handle errors during effect chain building with cleanup and state reset
   */
  private handleBuildChainError(
    error: unknown,
    enabledEffects: EffectInstance[]
  ): never {
    this.logger.error("Failed to build effect chain", { error });
    // Cleanup any partially-created nodes from the failed build
    this.cleanupPartiallyCreatedNodes(enabledEffects);
    // Ensure we're in a consistent state - disconnect everything
    this.disconnectAll();
    // Reconnect input directly to output as fallback
    if (this.inputNode && this.defaultDestination) {
      this.inputNode.connect(this.defaultDestination);
    }
    // Rethrow so callers can handle the error
    throw error;
  }

  /**
   * Build the effect chain and return the last node
   */
  private async buildEffectChainAsync(
    enabledEffects: EffectInstance[]
  ): Promise<AudioNode> {
    if (!this.inputNode) {
      throw new Error("Input node not set");
    }
    let currentNode: AudioNode = this.inputNode;

    for (const effect of enabledEffects) {
      // Create or get the effect node
      if (!effect.node) {
        await this.ensureEffectNode(effect);
      }

      if (!effect.node) {
        continue;
      }

      currentNode = this.connectEffect(effect, currentNode);
    }

    return currentNode;
  }

  /**
   * Ensure an effect node exists, creating it if necessary
   */
  private async ensureEffectNode(effect: EffectInstance): Promise<void> {
    if (
      effect.config.type === "plateReverb" ||
      effect.config.type === "phaseVocoder"
    ) {
      const newNode = await this.createEffectNodeAsync(effect.config);
      if (newNode) {
        effect.node = newNode;
      }
    } else {
      const newNode = this.createEffectNode(effect.config);
      if (newNode) {
        effect.node = newNode;
      }
    }
  }

  /**
   * Build the effect chain and return the last node (synchronous version)
   */
  private buildEffectChain(enabledEffects: EffectInstance[]): AudioNode {
    if (!this.inputNode) {
      throw new Error("Input node not set");
    }
    let currentNode: AudioNode = this.inputNode;

    for (const effect of enabledEffects) {
      // Create or get the effect node
      if (!effect.node) {
        if (
          effect.config.type === "plateReverb" ||
          effect.config.type === "phaseVocoder"
        ) {
          // Async effects, will be handled separately
          continue;
        }
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
    // Handle plate reverb (handles wet/dry internally)
    if (effect.config.type === "plateReverb") {
      const mergeNode = this.cacophony.context.createGain();
      mergeNode.gain.value = 1.0;
      this.connectPlateReverbEffect(effect, currentNode, mergeNode);
      return mergeNode as unknown as AudioNode;
    }

    // Handle standard reverb (needs wet/dry routing)
    if (effect.config.type === "standardReverb") {
      const mergeNode = this.cacophony.context.createGain();
      mergeNode.gain.value = 1.0;
      this.setupWetDryRouting(effect, currentNode, mergeNode);
      return mergeNode as unknown as AudioNode;
    }

    // Handle phase vocoder (simple pass-through)
    if (effect.config.type === "phaseVocoder") {
      const effectNode = effect.node as unknown as AudioNode;
      currentNode.connect(effectNode);
      return effectNode;
    }

    // Handle effects that need wet/dry routing (delay)
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
   * Initialize an AudioWorklet parameter safely
   */
  private initWorkletParam(
    paramMap: unknown,
    name: string,
    value: number,
    now: number
  ): void {
    try {
      let param: AudioParam | undefined;
      if (
        paramMap !== null &&
        typeof paramMap === "object" &&
        "get" in paramMap &&
        typeof paramMap.get === "function"
      ) {
        param = (
          paramMap as { get(paramName: string): AudioParam | undefined }
        ).get(name) as AudioParam | undefined;
      } else {
        param = (paramMap as unknown as Record<string, AudioParam>)[name];
      }
      if (param) {
        param.cancelScheduledValues(now);
        param.setValueAtTime(value, now);
      } else {
        this.logger.warn("Worklet parameter not found during initialization", {
          parameter: name,
        });
      }
    } catch (error) {
      this.logger.warn("Failed to initialize parameter", {
        parameter: name,
        error,
      });
    }
  }

  /**
   * Create an effect node from config
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Complex async effect creation with multiple worklet types
  private async createEffectNodeAsync(
    config: EffectConfig
  ): Promise<EffectNode | null> {
    try {
      if (config.type === "plateReverb") {
        // Use public path to serve the bundle as a static file
        // The bundle is copied to public/api/worklets during build
        // This works in all environments including Cloudflare Workers
        const workletUrl = "/api/worklets/dattorro-reverb-bundle.js";

        try {
          const reverbNode = await this.cacophony.createWorkletNode(
            "dattorro-reverb",
            workletUrl
          );

          // Initialize parameters with default values from config
          if (reverbNode.parameters) {
            const reverbConfig = config as PlateReverbConfig;
            const params = reverbNode.parameters;
            const now = this.cacophony.context.currentTime;

            // Set initial parameter values
            this.initWorkletParam(
              params,
              "preDelay",
              reverbConfig.preDelay,
              now
            );
            this.initWorkletParam(
              params,
              "bandwidth",
              reverbConfig.bandwidth,
              now
            );
            this.initWorkletParam(
              params,
              "inputDiffusion1",
              reverbConfig.inputDiffusion1,
              now
            );
            this.initWorkletParam(
              params,
              "inputDiffusion2",
              reverbConfig.inputDiffusion2,
              now
            );
            this.initWorkletParam(params, "decay", reverbConfig.decay, now);
            this.initWorkletParam(
              params,
              "decayDiffusion1",
              reverbConfig.decayDiffusion1,
              now
            );
            this.initWorkletParam(
              params,
              "decayDiffusion2",
              reverbConfig.decayDiffusion2,
              now
            );
            this.initWorkletParam(params, "damping", reverbConfig.damping, now);
            this.initWorkletParam(
              params,
              "excursionRate",
              reverbConfig.excursionRate,
              now
            );
            this.initWorkletParam(
              params,
              "excursionDepth",
              reverbConfig.excursionDepth,
              now
            );
            this.initWorkletParam(params, "wet", reverbConfig.wet, now);
            this.initWorkletParam(params, "dry", reverbConfig.dry, now);
          } else {
            this.logger.warn(
              "Plate reverb node parameters not available after creation"
            );
          }

          return reverbNode as unknown as globalThis.AudioWorkletNode;
        } catch (workletError) {
          // Check if it's a NotSupportedError
          if (
            workletError instanceof Error &&
            (workletError.name === "NotSupportedError" ||
              workletError.message.includes("not supported"))
          ) {
            this.logger.error(
              "AudioWorklet is not supported in this browser or the worklet failed to load",
              { url: workletUrl, error: workletError }
            );
          } else {
            this.logger.error("Failed to create plate reverb worklet node", {
              error: workletError,
            });
          }
          throw workletError;
        }
      }

      if (config.type === "phaseVocoder") {
        const workletUrl = "/api/worklets/phase-vocoder-bundle.js";

        try {
          const vocoderNode = await this.cacophony.createWorkletNode(
            "phase-vocoder",
            workletUrl
          );

          // Initialize parameters
          if (vocoderNode.parameters) {
            const vocoderConfig = config as PhaseVocoderConfig;
            const params = vocoderNode.parameters;
            const now = this.cacophony.context.currentTime;

            this.initWorkletParam(
              params,
              "pitchFactor",
              vocoderConfig.pitchFactor,
              now
            );
          } else {
            this.logger.warn(
              "Phase vocoder node parameters not available after creation"
            );
          }

          return vocoderNode as unknown as globalThis.AudioWorkletNode;
        } catch (workletError) {
          if (
            workletError instanceof Error &&
            (workletError.name === "NotSupportedError" ||
              workletError.message.includes("not supported"))
          ) {
            this.logger.error(
              "AudioWorklet is not supported in this browser or the worklet failed to load",
              { url: workletUrl, error: workletError }
            );
          } else {
            this.logger.error("Failed to create phase vocoder worklet node", {
              error: workletError,
            });
          }
          throw workletError;
        }
      }

      return null;
    } catch (error) {
      this.logger.error("Failed to create async effect node", { error });
      return null;
    }
  }

  /**
   * Create an effect node from config (synchronous for non-worklet effects)
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

        case "plateReverb":
        case "phaseVocoder": {
          // Async effects, handled separately
          return null;
        }

        case "standardReverb": {
          const reverbConfig = config as StandardReverbConfig;
          const convolver = context.createConvolver();
          const impulseResponse = this.generateImpulseResponse(
            context,
            reverbConfig.roomSize,
            reverbConfig.decayTime
          );
          convolver.buffer = impulseResponse;
          convolver.normalize = false;
          return convolver as ConvolverNode;
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
          const panner = this.cacophony.createPanner({
            coneInnerAngle: pannerConfig.coneInnerAngle,
            coneOuterAngle: pannerConfig.coneOuterAngle,
            coneOuterGain: pannerConfig.coneOuterGain,
            distanceModel: pannerConfig.distanceModel,
            maxDistance: pannerConfig.maxDistance,
            refDistance: pannerConfig.refDistance,
            rolloffFactor: pannerConfig.rolloffFactor,
            panningModel: pannerConfig.panningModel,
            positionX: pannerConfig.positionX,
            positionY: pannerConfig.positionY,
            positionZ: pannerConfig.positionZ,
            orientationX: pannerConfig.orientationX,
            orientationY: pannerConfig.orientationY,
            orientationZ: pannerConfig.orientationZ,
          });
          return panner as unknown as PannerNode;
        }

        default:
          return null;
      }
    } catch (error) {
      this.logger.error("Failed to create effect node", {
        effectType: config.type,
        error,
      });
      return null;
    }
  }

  /**
   * Update an effect node's parameters
   * @returns Promise that resolves to true on success, false on failure
   */
  private updateEffectNode(effect: EffectInstance): Promise<boolean> {
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
      return Promise.resolve(true);
    }

    // If effect is being enabled but has no node, create it
    if (!effect.node && isEnabled) {
      if (
        effect.config.type === "plateReverb" ||
        effect.config.type === "phaseVocoder"
      ) {
        // Handle async effect creation
        return this.createEffectNodeAsync(effect.config)
          .then((newNode) => {
            if (newNode) {
              effect.node = newNode;
              this.rebuildChain();
              return true;
            }
            // If node creation failed, disable the effect
            this.logger.warn(
              "Effect node creation returned null, disabling effect",
              { effectType: effect.config.type }
            );
            effect.config.enabled = false;
            return false;
          })
          .catch((error) => {
            this.logger.error("Failed to create effect node", {
              effectType: effect.config.type,
              error,
            });
            // Disable the effect if creation fails
            effect.config.enabled = false;
            return false;
          });
      }
      const syncNode = this.createEffectNode(effect.config);
      if (syncNode) {
        effect.node = syncNode;
        this.rebuildChain();
        return Promise.resolve(true);
      }
      // If node creation failed, disable the effect
      this.logger.warn("Effect node creation returned null, disabling effect", {
        effectType: effect.config.type,
      });
      effect.config.enabled = false;
      return Promise.resolve(false);
    }

    // If effect is disabled and has no node, nothing to do
    if (!(effect.node || isEnabled)) {
      return Promise.resolve(true);
    }

    // If effect is enabled, update its parameters
    if (isEnabled && effect.node) {
      this.updateEffectNodeParams(effect);
      return Promise.resolve(true);
    }

    return Promise.resolve(true);
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
        case "plateReverb":
          this.updatePlateReverb(effect, context, now);
          break;
        case "standardReverb":
          this.updateStandardReverb(effect, context, now, smoothTime);
          break;
        case "phaseVocoder":
          this.updatePhaseVocoder(effect, now);
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
      this.logger.error("Failed to update effect node", { error });
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

  private updatePlateReverb(
    effect: EffectInstance,
    _context: AudioContext,
    now: number
  ): void {
    const reverbConfig = effect.config as PlateReverbConfig;
    const reverb = effect.node as globalThis.AudioWorkletNode;
    if (!reverb?.parameters) {
      this.logger.warn("Plate reverb node or parameters not available");
      return;
    }

    // Update all plate reverb parameters
    const params = reverb.parameters;

    // Helper to safely get and update a parameter
    const updateParam = (name: string, value: number) => {
      try {
        // Check if parameters.get exists (for AudioParamMap)
        let param: AudioParam | undefined;
        if (typeof params.get === "function") {
          param = params.get(name);
        } else {
          // Fallback for plain object access
          param = (params as unknown as Record<string, AudioParam>)[name];
        }

        if (param) {
          // For reverb parameters, use immediate updates for better responsiveness
          // The worklet reads k-rate parameters once per render quantum, so immediate updates work better
          param.cancelScheduledValues(now);
          param.setValueAtTime(value, now);
        } else {
          this.logger.warn("Plate reverb parameter not found", {
            parameter: name,
            availableParameters:
              typeof params.get === "function"
                ? Array.from(params.keys?.() ?? [])
                : Object.keys(params),
          });
        }
      } catch (error) {
        this.logger.error("Error updating plate reverb parameter", {
          parameter: name,
          error,
        });
      }
    };

    updateParam("preDelay", reverbConfig.preDelay);
    updateParam("bandwidth", reverbConfig.bandwidth);
    updateParam("inputDiffusion1", reverbConfig.inputDiffusion1);
    updateParam("inputDiffusion2", reverbConfig.inputDiffusion2);
    updateParam("decay", reverbConfig.decay);
    updateParam("decayDiffusion1", reverbConfig.decayDiffusion1);
    updateParam("decayDiffusion2", reverbConfig.decayDiffusion2);
    updateParam("damping", reverbConfig.damping);
    updateParam("excursionRate", reverbConfig.excursionRate);
    updateParam("excursionDepth", reverbConfig.excursionDepth);
    updateParam("wet", reverbConfig.wet);
    updateParam("dry", reverbConfig.dry);
  }

  private updateStandardReverb(
    effect: EffectInstance,
    context: AudioContext,
    now: number,
    smoothTime: number
  ): void {
    const reverbConfig = effect.config as StandardReverbConfig;
    const convolver = effect.node as ConvolverNode;

    if (!convolver) {
      return;
    }

    // Regenerate impulse response when roomSize or decayTime changes
    // We regenerate every time since checking previous values would require storing state
    // The performance impact is minimal since this is only called on parameter changes
    const impulseResponse = this.generateImpulseResponse(
      context,
      reverbConfig.roomSize,
      reverbConfig.decayTime
    );
    convolver.buffer = impulseResponse;

    // Update wet/dry gains
    if (effect.wetGain && effect.dryGain) {
      this.updateWetDryGains(effect, reverbConfig.wet, reverbConfig.dry, {
        now,
        smoothTime,
      });
    }
  }

  private updatePhaseVocoder(effect: EffectInstance, now: number): void {
    const vocoderConfig = effect.config as PhaseVocoderConfig;
    const vocoder = effect.node as globalThis.AudioWorkletNode;
    if (!vocoder?.parameters) {
      this.logger.warn("Phase vocoder node or parameters not available");
      return;
    }

    const params = vocoder.parameters;

    const updateParam = (name: string, value: number) => {
      try {
        let param: AudioParam | undefined;
        if (typeof params.get === "function") {
          param = params.get(name) as AudioParam | undefined;
        } else {
          param = (params as unknown as Record<string, AudioParam>)[name];
        }

        if (param) {
          param.cancelScheduledValues(now);
          param.setValueAtTime(value, now);
        } else {
          this.logger.warn("Phase vocoder parameter not found", {
            parameter: name,
            availableParameters:
              typeof params.get === "function"
                ? Array.from(params.keys?.() ?? [])
                : Object.keys(params),
          });
        }
      } catch (error) {
        this.logger.error("Error updating phase vocoder parameter", {
          parameter: name,
          error,
        });
      }
    };

    updateParam("pitchFactor", vocoderConfig.pitchFactor);
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
    const panner = effect.node as PannerNode;
    if (!panner) {
      return;
    }

    // Update panner properties (non-audio-param properties)
    panner.coneInnerAngle = pannerConfig.coneInnerAngle;
    panner.coneOuterAngle = pannerConfig.coneOuterAngle;
    panner.coneOuterGain = pannerConfig.coneOuterGain;
    panner.distanceModel = pannerConfig.distanceModel;
    panner.maxDistance = pannerConfig.maxDistance;
    panner.refDistance = pannerConfig.refDistance;
    panner.rolloffFactor = pannerConfig.rolloffFactor;
    panner.panningModel = pannerConfig.panningModel;

    // Update audio-param properties with smooth transitions
    const updateParam = (param: PannerNode["positionX"], value: number) => {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(value, now + smoothTime);
    };

    updateParam(panner.positionX, pannerConfig.positionX);
    updateParam(panner.positionY, pannerConfig.positionY);
    updateParam(panner.positionZ, pannerConfig.positionZ);
    updateParam(panner.orientationX, pannerConfig.orientationX);
    updateParam(panner.orientationY, pannerConfig.orientationY);
    updateParam(panner.orientationZ, pannerConfig.orientationZ);
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
   * Generate an impulse response for standard reverb
   */
  private generateImpulseResponse(
    context: AudioContext,
    roomSize: number,
    decayTime: number
  ): ReturnType<AudioContext["createBuffer"]> {
    const sampleRate = context.sampleRate;
    const length = Math.floor(decayTime * sampleRate);
    const impulse = context.createBuffer(2, length, sampleRate);
    const leftChannel = impulse.getChannelData(0);
    const rightChannel = impulse.getChannelData(1);

    // Exponential decay with some randomness for natural reverb
    const decaySamples = decayTime * sampleRate;
    for (let i = 0; i < length; i++) {
      const decay = Math.exp((-i / decaySamples) * (1 + roomSize));
      const noise = (Math.random() * 2 - 1) * 0.1; // Small random component
      const value = decay * (1 + noise) * roomSize;
      leftChannel[i] = value;
      rightChannel[i] = value * (0.9 + Math.random() * 0.2); // Slight stereo variation
    }

    return impulse;
  }

  /**
   * Check if an effect needs wet/dry routing
   */
  private needsWetDryRouting(config: EffectConfig): boolean {
    // Plate reverb handles wet/dry internally, so we don't need separate routing
    // Standard reverb is handled separately in connectEffect
    return config.type === "delay";
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
    if (effect.config.type === "delay") {
      const config = effect.config as DelayConfig;
      effect.wetGain.gain.value = config.wet;
      effect.dryGain.gain.value = config.dry;

      // Setup feedback loop for delay
      if (!effect.feedbackGain) {
        effect.feedbackGain = context.createGain();
      }
      effect.feedbackGain.gain.value = config.feedback;
      (
        effect.node as unknown as {
          connect(destination: AudioNode | { value: number }): void;
        }
      ).connect(effect.feedbackGain as unknown as AudioNode);
      effect.feedbackGain.connect(effect.node as unknown as AudioNode);
    } else if (effect.config.type === "standardReverb") {
      const config = effect.config as StandardReverbConfig;
      effect.wetGain.gain.value = config.wet;
      effect.dryGain.gain.value = config.dry;
    }

    // Route dry signal: input → dryGain → output
    inputNode.connect(effect.dryGain as unknown as AudioNode);
    effect.dryGain.connect(outputNode);

    // Route wet signal: input → effect → wetGain → output
    inputNode.connect(effect.node as unknown as AudioNode);
    (
      effect.node as unknown as {
        connect(destination: AudioNode | { value: number }): void;
      }
    ).connect(effect.wetGain as unknown as AudioNode);
    effect.wetGain.connect(outputNode);
  }

  /**
   * Connect plate reverb effect (handles wet/dry internally)
   */
  private connectPlateReverbEffect(
    effect: EffectInstance,
    inputNode: AudioNode,
    outputNode: AudioNode
  ): void {
    if (!effect.node) {
      return;
    }
    // Plate reverb already handles wet/dry mixing internally
    inputNode.connect(effect.node as unknown as AudioNode);
    (
      effect.node as unknown as {
        connect(destination: AudioNode | { value: number }): void;
      }
    ).connect(outputNode);
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
    // Disconnect input node from destination to prevent duplicate connections
    if (this.inputNode) {
      this.inputNode.disconnect();
    }

    // Disconnect all effect nodes
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
   * Cleanup partially-created nodes from a failed build
   * This ensures any nodes created during a failed chain build are properly disconnected
   */
  private cleanupPartiallyCreatedNodes(effects: EffectInstance[]): void {
    for (const effect of effects) {
      // Use existing cleanup method which handles all node types
      this.cleanupEffect(effect);
    }
  }

  /**
   * Cleanup all effects
   */
  cleanup(): void {
    this.disconnectAll();
    this.effects = [];
  }
}
