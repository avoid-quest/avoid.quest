"use client";

import {
  type AudioBuffer,
  type AudioContext,
  type AudioNode,
  Cacophony,
  type ConvolverNode,
  type GainNode,
  type Playback,
  type Sound,
  SoundType,
} from "@avoid.quest/cacophony";
import type { FilterConfig } from "@/components/audio/filter-control";
import type { ReverbConfig } from "@/components/audio/reverb-control";
import type { Radio } from "../types";
import { EffectManager } from "./effects/effect-manager";
import type { EffectConfig } from "./effects/types";

export type AudioError = {
  message: string;
  code: string;
  radio?: Radio;
  timestamp: number;
};

export type AudioState = {
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  error: AudioError | null;
};

export class AudioManager {
  private static instance: AudioManager | null = null;
  private readonly cacophony: Cacophony;
  private readonly sounds: Map<string, Sound> = new Map();
  private readonly playbacks: Map<string, Playback> = new Map();
  private readonly listeners: Map<string, Set<(state: AudioState) => void>> =
    new Map();
  // Legacy support - will be removed after migration
  private readonly filters: Map<string, BiquadFilterNode> = new Map();
  private readonly reverbs: Map<string, ConvolverNode> = new Map();
  private readonly reverbGains: Map<string, { wet: GainNode; dry: GainNode }> =
    new Map();
  private readonly reverbConfigs: Map<string, ReverbConfig> = new Map();
  private readonly defaultDestinations: Map<string, AudioNode> = new Map();
  // New unified effect system
  private readonly effectManagers: Map<string, EffectManager> = new Map();

  private constructor() {
    this.cacophony = new Cacophony();
  }

  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  getCacophony(): Cacophony {
    return this.cacophony;
  }

  async createSound(radio: Radio, soundId?: string): Promise<Sound> {
    const id = soundId || `sound_${radio.id || Date.now()}`;

    // Clean up existing sound if it exists
    if (this.sounds.has(id)) {
      this.cleanupSound(id);
    }

    try {
      const sound = await this.cacophony.createSound(
        radio.streamUrl,
        SoundType.Streaming,
        "stereo"
      );

      // Set up error handling for this specific sound
      sound.on("soundError", (event: { error: Error }) => {
        console.error(`Audio error for ${radio.name}:`, event.error);
        this.notifyListeners(id, {
          isPlaying: false,
          isLoading: false,
          volume: sound.volume,
          error: {
            message: `Failed to play ${radio.name}: ${event.error.message}`,
            code: "SOUND_ERROR",
            radio,
            timestamp: Date.now(),
          },
        });
      });

      this.sounds.set(id, sound);
      return sound;
    } catch (error) {
      const audioError: AudioError = {
        message: `Failed to create sound for ${radio.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
        code: "CREATE_SOUND_ERROR",
        radio,
        timestamp: Date.now(),
      };

      this.notifyListeners(id, {
        isPlaying: false,
        isLoading: false,
        volume: 0,
        error: audioError,
      });

      throw audioError;
    }
  }

  playSound(soundId: string, volume = 1): Playback | null {
    const sound = this.sounds.get(soundId);
    if (!sound) {
      throw new Error(`Sound with id ${soundId} not found`);
    }

    // Clean up existing playback
    if (this.playbacks.has(soundId)) {
      this.playbacks.get(soundId)?.cleanup();
    }

    const [playback] = sound.play();

    if (playback) {
      playback.volume = volume;
      this.playbacks.set(soundId, playback);

      // Setup effect manager for this sound
      let effectManager = this.effectManagers.get(soundId);
      if (!effectManager) {
        effectManager = new EffectManager(this.cacophony, sound, playback);
        this.effectManagers.set(soundId, effectManager);
      }

      // Set input and output nodes
      effectManager.setInputNode(playback.outputNode);
      effectManager.setOutputNode(
        this.cacophony.globalGainNode as unknown as AudioNode
      );

      // Apply reverb if config exists and is enabled (legacy support)
      const reverbConfig = this.reverbConfigs.get(soundId);
      if (reverbConfig?.enabled) {
        this.applyReverb(soundId, reverbConfig);
      }
    } else {
      throw new Error(`Failed to play sound with id ${soundId}`);
    }

    this.notifyListeners(soundId, {
      isPlaying: true,
      isLoading: false,
      volume,
      error: null,
    });

    return null;
  }

  pauseSound(soundId: string): void {
    const playback = this.playbacks.get(soundId);
    if (playback) {
      playback.pause();
      this.notifyListeners(soundId, {
        isPlaying: false,
        isLoading: false,
        volume: playback.volume,
        error: null,
      });
    }
  }

  stopSound(soundId: string): void {
    const playback = this.playbacks.get(soundId);
    if (playback) {
      playback.stop();
      this.playbacks.delete(soundId);
      this.notifyListeners(soundId, {
        isPlaying: false,
        isLoading: false,
        volume: 0,
        error: null,
      });
    }
  }

  setVolume(soundId: string, volume: number): void {
    const playback = this.playbacks.get(soundId);
    if (playback) {
      playback.volume = Math.max(0, Math.min(1, volume));
      this.notifyListeners(soundId, {
        isPlaying: playback.volume > 0,
        isLoading: false,
        volume: playback.volume,
        error: null,
      });
    }
  }

  crossfade(
    fromSoundId: string,
    toSoundId: string,
    duration: number,
    targetVolume = 1
  ): Promise<void> {
    const fromPlayback = this.playbacks.get(fromSoundId);
    const toPlayback = this.playbacks.get(toSoundId);

    if (!(fromPlayback && toPlayback)) {
      throw new Error("Both sounds must be playing for crossfade");
    }

    // Store the original volume of the old sound for proper crossfade
    const originalFromVolume = fromPlayback.volume;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Crossfade volumes with linear curves for balanced crossfade
        // Use original volume as starting point for proper fadeout
        const fromVolume = originalFromVolume * (1 - progress);
        const toVolume = targetVolume * progress;

        fromPlayback.volume = fromVolume;
        toPlayback.volume = toVolume;

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          // Crossfade complete
          this.stopSound(fromSoundId);
          resolve();
        }
      };

      animate();
    });
  }

  cleanupSound(soundId: string): void {
    // Stop and cleanup playback
    this.stopSound(soundId);

    // Cleanup effect manager
    const effectManager = this.effectManagers.get(soundId);
    if (effectManager) {
      effectManager.cleanup();
      this.effectManagers.delete(soundId);
    }

    // Remove filter (legacy)
    this.removeFilter(soundId);

    // Remove reverb (legacy)
    this.removeReverb(soundId);

    // Cleanup sound
    const sound = this.sounds.get(soundId);
    if (sound) {
      sound.cleanup();
      this.sounds.delete(soundId);
    }

    // Notify listeners
    this.notifyListeners(soundId, {
      isPlaying: false,
      isLoading: false,
      volume: 0,
      error: null,
    });
  }

  cleanup(): void {
    // Cleanup all sounds and playbacks
    for (const soundId of this.sounds.keys()) {
      this.cleanupSound(soundId);
    }

    // Clear maps
    this.sounds.clear();
    this.playbacks.clear();
    this.listeners.clear();
    this.filters.clear();
    this.reverbs.clear();
    this.reverbGains.clear();
    this.reverbConfigs.clear();
    this.defaultDestinations.clear();
    this.effectManagers.clear();
  }

  subscribe(
    soundId: string,
    callback: (state: AudioState) => void
  ): () => void {
    if (!this.listeners.has(soundId)) {
      this.listeners.set(soundId, new Set());
    }

    this.listeners.get(soundId)?.add(callback);

    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(soundId);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.listeners.delete(soundId);
        }
      }
    };
  }

  private notifyListeners(soundId: string, state: AudioState): void {
    const listeners = this.listeners.get(soundId);
    if (listeners) {
      for (const callback of listeners) {
        callback(state);
      }
    }
  }

  getSound(soundId: string): Sound | undefined {
    return this.sounds.get(soundId);
  }

  getPlayback(soundId: string): Playback | undefined {
    return this.playbacks.get(soundId);
  }

  getGlobalVolume(): number {
    return this.cacophony.volume;
  }

  setGlobalVolume(volume: number): void {
    this.cacophony.volume = Math.max(0, Math.min(1, volume));
  }

  private globalMuted = false;
  private lastGlobalVolume = 1;

  muteGlobal(): void {
    if (!this.globalMuted) {
      this.lastGlobalVolume = this.cacophony.volume;
      this.cacophony.volume = 0;
      this.globalMuted = true;
    }
  }

  unmuteGlobal(): void {
    if (this.globalMuted) {
      this.cacophony.volume = this.lastGlobalVolume;
      this.globalMuted = false;
    }
  }

  isGlobalMuted(): boolean {
    return this.globalMuted;
  }

  muteSound(soundId: string): void {
    const playback = this.playbacks.get(soundId);
    if (playback) {
      playback.volume = 0;
    }
  }

  unmuteSound(soundId: string): void {
    const playback = this.playbacks.get(soundId);
    if (playback) {
      // Restore to previous volume or default to 1
      playback.volume = 1;
    }
  }

  isSoundMuted(soundId: string): boolean {
    const playback = this.playbacks.get(soundId);
    return playback ? playback.volume === 0 : false;
  }

  /**
   * Apply a filter to a sound
   */
  applyFilter(soundId: string, config: FilterConfig): BiquadFilterNode | null {
    const sound = this.sounds.get(soundId);
    if (!sound) {
      console.warn(`Sound ${soundId} not found for filter application`);
      return null;
    }

    // Remove existing filter for this sound
    this.removeFilter(soundId);

    if (!config.enabled) {
      return null;
    }

    try {
      // Create new filter using cacophony
      const filter = this.cacophony.createBiquadFilter({
        type: config.type,
        frequency: config.frequency,
        Q: config.Q,
        gain: config.gain,
      });

      // Apply filter to the sound
      sound.addFilter(filter);

      // Store filter reference
      this.filters.set(soundId, filter);

      return filter;
    } catch (error) {
      console.error("Failed to apply filter:", error);
      return null;
    }
  }

  /**
   * Update an existing filter
   */
  updateFilter(soundId: string, config: FilterConfig): void {
    const filter = this.filters.get(soundId);
    if (!filter) {
      // If no filter exists, create a new one
      this.applyFilter(soundId, config);
      return;
    }

    if (!config.enabled) {
      this.removeFilter(soundId);
      return;
    }

    try {
      // Update filter parameters with smooth transitions to prevent crackling
      const now = this.cacophony.context.currentTime;
      const smoothTime = 0.01; // 10ms smooth transition

      // Only update type if it changed
      if (filter.type !== config.type) {
        filter.type = config.type;
      }

      // Use exponentialRampToValueAtTime for smooth parameter changes
      filter.frequency.cancelScheduledValues(now);
      filter.frequency.setValueAtTime(filter.frequency.value, now);
      filter.frequency.exponentialRampToValueAtTime(
        config.frequency,
        now + smoothTime
      );

      filter.Q.cancelScheduledValues(now);
      filter.Q.setValueAtTime(filter.Q.value, now);
      filter.Q.exponentialRampToValueAtTime(config.Q, now + smoothTime);

      filter.gain.cancelScheduledValues(now);
      filter.gain.setValueAtTime(filter.gain.value, now);
      filter.gain.linearRampToValueAtTime(config.gain, now + smoothTime);
    } catch (error) {
      console.error("Failed to update filter:", error);
    }
  }

  /**
   * Remove filter from a sound
   */
  removeFilter(soundId: string): void {
    const sound = this.sounds.get(soundId);
    const filter = this.filters.get(soundId);

    if (sound && filter) {
      try {
        sound.removeFilter(filter);
      } catch (error) {
        console.error("Failed to remove filter:", error);
      }
    }

    this.filters.delete(soundId);
  }

  /**
   * Get current filter for a sound
   */
  getFilter(soundId: string): BiquadFilterNode | undefined {
    return this.filters.get(soundId);
  }

  /**
   * Check if a sound has a filter applied
   */
  hasFilter(soundId: string): boolean {
    return this.filters.has(soundId);
  }

  /**
   * Generate an impulse response for reverb
   */
  private generateImpulseResponse(
    context: AudioContext,
    roomSize: number,
    decayTime: number
  ): AudioBuffer {
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
   * Apply reverb to a sound
   */
  applyReverb(soundId: string, config: ReverbConfig): void {
    const playback = this.playbacks.get(soundId);

    if (!playback) {
      console.warn(`Sound ${soundId} not found for reverb application`);
      return;
    }

    if (!config.enabled) {
      // If disabled, just remove any existing reverb
      if (this.reverbs.has(soundId)) {
        this.removeReverb(soundId);
      }
      return;
    }

    // Remove existing reverb if any (only if one exists)
    if (this.reverbs.has(soundId)) {
      this.removeReverb(soundId);
    }

    try {
      const context = this.cacophony.context;
      const outputNode = playback.outputNode;

      // Generate impulse response
      const impulseResponse = this.generateImpulseResponse(
        context,
        config.roomSize,
        config.decayTime
      );

      // Create reverb convolver
      const reverb = context.createConvolver();
      reverb.buffer = impulseResponse;
      reverb.normalize = false;

      // Create wet and dry gain nodes
      const wetGain = context.createGain();
      const dryGain = context.createGain();

      wetGain.gain.value = config.wet;
      dryGain.gain.value = config.dry;

      // Store default destination (globalGainNode from cacophony)
      const globalGainNode = this.cacophony.globalGainNode;
      this.defaultDestinations.set(
        soundId,
        globalGainNode as unknown as AudioNode
      );

      // Disconnect from default routing
      // The outputNode is connected to globalGainNode by default
      // We need to disconnect it and route through reverb
      outputNode.disconnect();

      // Route dry signal: outputNode → dryGain → globalGainNode
      outputNode.connect(dryGain);
      dryGain.connect(globalGainNode);

      // Route wet signal: outputNode → reverb → wetGain → globalGainNode
      outputNode.connect(reverb);
      reverb.connect(wetGain);
      wetGain.connect(globalGainNode);

      // Store references
      this.reverbs.set(soundId, reverb);
      this.reverbGains.set(soundId, { wet: wetGain, dry: dryGain });
      this.reverbConfigs.set(soundId, config);
    } catch (error) {
      console.error("Failed to apply reverb:", error);
    }
  }

  /**
   * Update reverb parameters
   */
  updateReverb(soundId: string, config: ReverbConfig): void {
    const playback = this.playbacks.get(soundId);
    const oldConfig = this.reverbConfigs.get(soundId);

    // Always store config so it can be applied when playback starts
    this.reverbConfigs.set(soundId, config);

    if (!playback) {
      // No playback yet, just store the config for later
      return;
    }

    const reverb = this.reverbs.get(soundId);
    const gains = this.reverbGains.get(soundId);

    if (!reverb) {
      // If no reverb exists, create a new one (only if enabled)
      if (config.enabled) {
        this.applyReverb(soundId, config);
      }
      return;
    }
    if (!gains) {
      return;
    }

    if (!config.enabled) {
      this.removeReverb(soundId);
      return;
    }

    try {
      const context = this.cacophony.context;
      const now = context.currentTime;
      const smoothTime = 0.01; // 10ms smooth transition

      // Check if we need to regenerate impulse response
      const needsNewIR =
        oldConfig?.roomSize !== config.roomSize ||
        oldConfig?.decayTime !== config.decayTime;

      if (needsNewIR) {
        // Regenerate impulse response
        const impulseResponse = this.generateImpulseResponse(
          context,
          config.roomSize,
          config.decayTime
        );
        reverb.buffer = impulseResponse;
      }

      // Update wet/dry gains with smooth transitions
      const wetGain = gains.wet;
      const dryGain = gains.dry;

      wetGain.gain.cancelScheduledValues(now);
      wetGain.gain.setValueAtTime(wetGain.gain.value, now);
      wetGain.gain.linearRampToValueAtTime(config.wet, now + smoothTime);

      dryGain.gain.cancelScheduledValues(now);
      dryGain.gain.setValueAtTime(dryGain.gain.value, now);
      dryGain.gain.linearRampToValueAtTime(config.dry, now + smoothTime);
    } catch (error) {
      console.error("Failed to update reverb:", error);
    }
  }

  /**
   * Remove reverb from a sound
   */
  removeReverb(soundId: string): void {
    const playback = this.playbacks.get(soundId);
    const reverb = this.reverbs.get(soundId);
    const gains = this.reverbGains.get(soundId);

    if (playback && reverb && gains) {
      try {
        const outputNode = playback.outputNode;
        const globalGainNode = this.cacophony.globalGainNode;

        // Disconnect all reverb routing
        outputNode.disconnect();
        reverb.disconnect();
        gains.wet.disconnect();
        gains.dry.disconnect();

        // Reconnect to default routing (globalGainNode)
        // This ensures audio continues to play after reverb removal
        outputNode.connect(globalGainNode);
      } catch (error) {
        console.error("Failed to remove reverb:", error);
        // Try to restore default routing even if there was an error
        try {
          const outputNode = playback.outputNode;
          const globalGainNode = this.cacophony.globalGainNode;
          outputNode.connect(globalGainNode);
        } catch (reconnectError) {
          console.error(
            "Failed to restore default routing after reverb removal:",
            reconnectError
          );
        }
      }
    }

    // Clean up references
    this.reverbs.delete(soundId);
    this.reverbGains.delete(soundId);
    this.defaultDestinations.delete(soundId);
    // Note: We keep reverbConfigs so reverb can be reapplied when playback starts
  }

  /**
   * Get current reverb config for a sound
   */
  getReverbConfig(soundId: string): ReverbConfig | undefined {
    return this.reverbConfigs.get(soundId);
  }

  /**
   * Check if a sound has reverb applied
   */
  hasReverb(soundId: string): boolean {
    return this.reverbs.has(soundId);
  }

  /**
   * Add an effect to a sound's effect chain
   */
  addEffect(soundId: string, config: EffectConfig): void {
    const effectManager = this.effectManagers.get(soundId);
    if (effectManager) {
      effectManager.addEffect(config);
    } else {
      // Create effect manager if it doesn't exist
      const sound = this.sounds.get(soundId);
      const playback = this.playbacks.get(soundId);
      if (!sound) {
        console.warn(`Sound ${soundId} not found for effect addition`);
        return;
      }
      const newEffectManager = new EffectManager(
        this.cacophony,
        sound,
        playback
      );
      this.effectManagers.set(soundId, newEffectManager);
      if (playback) {
        newEffectManager.setInputNode(playback.outputNode);
        newEffectManager.setOutputNode(
          this.cacophony
            .globalGainNode as unknown as import("@avoid.quest/cacophony").AudioNode
        );
      }
      newEffectManager.addEffect(config);
    }
  }

  /**
   * Remove an effect from a sound's effect chain
   */
  removeEffect(soundId: string, effectId: string): void {
    const effectManager = this.effectManagers.get(soundId);
    if (effectManager) {
      effectManager.removeEffect(effectId);
    }
  }

  /**
   * Update an effect's configuration
   */
  updateEffect(
    soundId: string,
    effectId: string,
    config: Partial<EffectConfig>
  ): void {
    const effectManager = this.effectManagers.get(soundId);
    if (effectManager) {
      effectManager.updateEffect(effectId, config);
    }
  }

  /**
   * Reorder effects in a sound's effect chain
   */
  reorderEffects(soundId: string, effectIds: string[]): void {
    const effectManager = this.effectManagers.get(soundId);
    if (effectManager) {
      effectManager.reorderEffects(effectIds);
    }
  }

  /**
   * Get all effects for a sound
   */
  getEffects(soundId: string): ReturnType<EffectManager["getEffects"]> {
    const effectManager = this.effectManagers.get(soundId);
    if (effectManager) {
      return effectManager.getEffects();
    }
    return [];
  }

  /**
   * Get effect manager for a sound (for advanced usage)
   */
  getEffectManager(soundId: string): EffectManager | undefined {
    return this.effectManagers.get(soundId);
  }
}
