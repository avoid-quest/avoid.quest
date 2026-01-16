/**
 * Audio Manager
 *
 * Simplified high-level API for audio playback with effects.
 * Coordinates playback infrastructure with DSP processing.
 */

import { getProxiedBandcampUrl } from "@avoid.quest/bandcamp";
import { getProxiedSoundCloudUrl } from "@avoid.quest/soundcloud";
import type { EffectConfig } from "../dsp/effects/types.js";
import {
  type AudioState,
  type AudioStateCallback,
  type FilterType,
  getAudioContext,
  initialAudioState,
  type Radio,
  resumeAudioContext,
  StreamSource,
  type Unsubscribe,
  WorkletManager,
} from "../playback/index.js";

/**
 * Filter configuration for simple biquad filtering
 */
export type FilterConfig = {
  enabled: boolean;
  type: FilterType;
  frequency: number;
  Q: number;
  gain: number;
};

/**
 * Sound instance tracking
 */
type SoundInstance = {
  radio: Radio;
  sourceId: string;
  stream: StreamSource | null;
  volume: number;
  playing: boolean;
  loading: boolean;
  buffering: boolean;
};

/**
 * Worklet processor URL - should be set before use
 */
let workletProcessorUrl = "/dsp-processor-bundle.js";

/**
 * Set the worklet processor URL
 */
export function setWorkletProcessorUrl(url: string): void {
  workletProcessorUrl = url;
}

/**
 * Audio Manager singleton
 *
 * Provides a high-level API for:
 * - Sound creation and lifecycle
 * - Playback control (play, pause, stop)
 * - Volume control (per-sound and global)
 * - Effect chain management
 * - Filter application
 * - State subscriptions
 */
export class AudioManager {
  private static instance: AudioManager | null = null;

  private readonly sounds = new Map<string, SoundInstance>();
  private readonly listeners = new Map<string, Set<AudioStateCallback>>();
  private readonly filters = new Map<string, string>(); // soundId -> filterId

  private workletManager: WorkletManager | null = null;
  private initPromise: Promise<void> | null = null;
  private globalVolume = 1;
  private globalMuted = false;
  private lastGlobalVolume = 1;
  private readonly lastSoundVolumes = new Map<string, number>();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  /**
   * Reset the singleton (useful for testing)
   */
  static resetInstance(): void {
    if (AudioManager.instance) {
      AudioManager.instance.cleanup();
      AudioManager.instance = null;
    }
  }

  /**
   * Initialize the audio system
   */
  async init(): Promise<void> {
    if (this.workletManager?.isReady) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInit();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Check if audio system is ready
   */
  get isReady(): boolean {
    return this.workletManager?.isReady ?? false;
  }

  // ============================================
  // Sound Lifecycle
  // ============================================

  /**
   * Create a sound from a radio configuration
   *
   * Note: This is a lightweight operation that stores the sound config.
   * Full audio system initialization is deferred to playSound() to avoid
   * browser autoplay policy issues (AudioContext must be created/resumed
   * after a user gesture).
   */
  createSound(radio: Radio, soundId?: string): string {
    const id = soundId ?? `sound_${radio.id ?? Date.now()}`;

    // Clean up existing sound
    if (this.sounds.has(id)) {
      this.cleanupSound(id);
    }

    // Create sound instance (but don't initialize audio system yet)
    // Full initialization happens in playSound() on user gesture
    const instance: SoundInstance = {
      radio,
      sourceId: id,
      stream: null,
      volume: 1,
      playing: false,
      loading: false,
      buffering: false,
    };

    this.sounds.set(id, instance);

    // Notify ready state (sound is registered but not initialized)
    this.notifyListeners(id, {
      ...initialAudioState,
    });

    return id;
  }

  /**
   * Play a sound
   */
  async playSound(soundId: string, volume = 1): Promise<void> {
    const instance = this.sounds.get(soundId);
    if (!instance) {
      throw new Error(`Sound with id ${soundId} not found`);
    }

    await this.init();
    await resumeAudioContext();

    // Create worklet source if not already created
    // This is done here (on user gesture) rather than in createSound() to avoid autoplay policy issues
    this.workletManager?.createStreamSource(soundId);

    // Update instance state
    instance.volume = volume;
    instance.playing = true;
    instance.loading = true;

    // Notify loading state
    this.notifyListeners(soundId, {
      isPlaying: true,
      isLoading: true,
      isBuffering: false,
      volume,
      error: null,
      hasEnded: false,
    });

    // Start streaming if not already (or if stream ended/errored)
    let preBufferReadyPromise: Promise<void> | null = null;

    if (!instance.stream?.isActive) {
      // Clean up dead stream if it exists
      if (instance.stream) {
        instance.stream.stop();
        instance.stream = null;
      }

      const context = getAudioContext();
      if (!context) {
        throw new Error("Audio context not available");
      }

      // Create promise to wait for pre-buffer threshold before starting playback
      let resolvePreBufferReady: () => void;
      preBufferReadyPromise = new Promise<void>((resolve) => {
        resolvePreBufferReady = resolve;
      });

      const streamUrl = this.getProxiedUrl(instance.radio.streamUrl);

      instance.stream = new StreamSource(
        context,
        { url: streamUrl, sourceId: soundId },
        {
          onChunk: (buffer) => {
            this.workletManager?.addStreamChunk(soundId, buffer);
          },
          onPreBufferReady: () => {
            // Pre-buffer threshold reached - safe to start playback
            instance.loading = false;
            resolvePreBufferReady();
            this.notifyListeners(soundId, {
              isPlaying: true,
              isLoading: false,
              isBuffering: false,
              volume: instance.volume,
              error: null,
              hasEnded: false,
            });
          },
          onBufferLevel: ({ isBuffering: bufferingState }) => {
            // Update buffering state for UI
            const wasBuffering = instance.buffering;
            instance.buffering = bufferingState;

            // Only notify if buffering state changed and we're past initial load
            if (wasBuffering !== bufferingState && !instance.loading) {
              this.notifyListeners(soundId, {
                isPlaying: instance.playing,
                isLoading: false,
                isBuffering: bufferingState,
                volume: instance.volume,
                error: null,
                hasEnded: false,
              });
            }
          },
          onError: (error) => {
            this.notifyListeners(soundId, {
              isPlaying: false,
              isLoading: false,
              isBuffering: false,
              volume: instance.volume,
              error: {
                message: error.message,
                code: "STREAM_FETCH_FAILED",
                radio: instance.radio,
                timestamp: Date.now(),
              },
              hasEnded: false,
            });
          },
          onEnded: () => {
            instance.playing = false;
            instance.stream = null;
            this.notifyListeners(soundId, {
              isPlaying: false,
              isLoading: false,
              isBuffering: false,
              volume: instance.volume,
              error: null,
              hasEnded: true,
            });
          },
        }
      );

      instance.stream.start();
    }

    // Wait for pre-buffer threshold before starting playback (~800ms of audio)
    // This prevents audio jumps from insufficient buffering
    if (preBufferReadyPromise) {
      await preBufferReadyPromise;
    }

    // Start playback in worklet (now safe - we have data)
    this.workletManager?.startSource(soundId);
    this.workletManager?.setSourceVolume(soundId, volume * this.globalVolume);
  }

  /**
   * Pause a sound
   */
  pauseSound(soundId: string): void {
    const instance = this.sounds.get(soundId);
    if (!instance) {
      return;
    }

    instance.playing = false;
    this.workletManager?.pauseSource(soundId);

    this.notifyListeners(soundId, {
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      volume: instance.volume,
      error: null,
      hasEnded: false,
    });
  }

  /**
   * Stop a sound
   */
  stopSound(soundId: string): void {
    const instance = this.sounds.get(soundId);
    if (!instance) {
      return;
    }

    instance.playing = false;
    instance.stream?.stop();
    this.workletManager?.stopSource(soundId);

    this.notifyListeners(soundId, {
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      volume: 0,
      error: null,
      hasEnded: false,
    });
  }

  /**
   * Clean up a sound and release resources
   */
  cleanupSound(soundId: string): void {
    this.stopSound(soundId);

    // Remove filter
    this.removeFilter(soundId);

    // Clean up instance
    const instance = this.sounds.get(soundId);
    if (instance) {
      instance.stream = null;
    }

    this.sounds.delete(soundId);
    this.lastSoundVolumes.delete(soundId);

    this.notifyListeners(soundId, {
      ...initialAudioState,
    });
  }

  // ============================================
  // Volume Control
  // ============================================

  /**
   * Set volume for a sound (0-1)
   */
  setVolume(soundId: string, volume: number): void {
    const instance = this.sounds.get(soundId);
    if (!instance) {
      return;
    }

    const clampedVolume = Math.max(0, Math.min(1, volume));
    instance.volume = clampedVolume;
    this.workletManager?.setSourceVolume(
      soundId,
      clampedVolume * this.globalVolume
    );

    this.notifyListeners(soundId, {
      isPlaying: instance.playing,
      isLoading: instance.loading,
      isBuffering: instance.buffering,
      volume: clampedVolume,
      error: null,
      hasEnded: false,
    });
  }

  /**
   * Get global volume
   */
  getGlobalVolume(): number {
    return this.globalVolume;
  }

  /**
   * Set global volume (0-1)
   */
  setGlobalVolume(volume: number): void {
    this.globalVolume = Math.max(0, Math.min(1, volume));
    this.workletManager?.setVolume(this.globalVolume);

    // Update all active sounds
    for (const [soundId, instance] of this.sounds) {
      this.workletManager?.setSourceVolume(
        soundId,
        instance.volume * this.globalVolume
      );
    }
  }

  /**
   * Mute global audio
   */
  muteGlobal(): void {
    if (!this.globalMuted) {
      this.lastGlobalVolume = this.globalVolume;
      this.setGlobalVolume(0);
      this.globalMuted = true;
    }
  }

  /**
   * Unmute global audio
   */
  unmuteGlobal(): void {
    if (this.globalMuted) {
      this.setGlobalVolume(this.lastGlobalVolume);
      this.globalMuted = false;
    }
  }

  /**
   * Check if global audio is muted
   */
  isGlobalMuted(): boolean {
    return this.globalMuted;
  }

  /**
   * Mute a specific sound
   */
  muteSound(soundId: string): void {
    const instance = this.sounds.get(soundId);
    if (instance) {
      this.lastSoundVolumes.set(soundId, instance.volume);
      this.setVolume(soundId, 0);
    }
  }

  /**
   * Unmute a specific sound
   */
  unmuteSound(soundId: string): void {
    const instance = this.sounds.get(soundId);
    if (instance) {
      const lastVolume = this.lastSoundVolumes.get(soundId) ?? 1;
      this.setVolume(soundId, lastVolume);
      this.lastSoundVolumes.delete(soundId);
    }
  }

  /**
   * Check if a sound is muted
   */
  isSoundMuted(soundId: string): boolean {
    const instance = this.sounds.get(soundId);
    return instance ? instance.volume === 0 : false;
  }

  // ============================================
  // Effect Management
  // ============================================

  /**
   * Add an effect to a sound
   */
  addEffect(soundId: string, config: EffectConfig): void {
    if (!this.workletManager?.isReady) {
      console.warn("Worklet not ready for effect addition");
      return;
    }

    const engineConfig = this.convertEffectConfig(config);
    const engineType = this.mapEffectType(config.type);

    this.workletManager.addEffect(
      soundId,
      config.id,
      engineType,
      engineConfig,
      config.order
    );
  }

  /**
   * Remove an effect from a sound
   */
  removeEffect(soundId: string, effectId: string): void {
    this.workletManager?.removeEffect(soundId, effectId);
  }

  /**
   * Update an effect's configuration
   */
  updateEffect(
    soundId: string,
    effectId: string,
    config: Partial<EffectConfig>
  ): boolean {
    if (!this.workletManager?.isReady) {
      return false;
    }

    const engineConfig = this.convertPartialEffectConfig(config);
    this.workletManager.updateEffect(soundId, effectId, engineConfig);
    return true;
  }

  /**
   * Reorder effects in a sound's chain
   */
  reorderEffects(soundId: string, effectIds: string[]): void {
    this.workletManager?.reorderEffects(soundId, effectIds);
  }

  // ============================================
  // Filter Management
  // ============================================

  /**
   * Update filter on a sound
   */
  updateFilter(soundId: string, config: FilterConfig): void {
    if (!this.workletManager?.isReady) {
      return;
    }

    const filterId = this.filters.get(soundId) ?? `filter_${soundId}`;

    if (!config.enabled) {
      this.removeFilter(soundId);
      return;
    }

    // Add or update filter
    if (this.filters.has(soundId)) {
      this.workletManager.setFilterParam(
        soundId,
        filterId,
        "type",
        config.type
      );
      this.workletManager.setFilterParam(
        soundId,
        filterId,
        "frequency",
        config.frequency
      );
      this.workletManager.setFilterParam(soundId, filterId, "Q", config.Q);
      this.workletManager.setFilterParam(
        soundId,
        filterId,
        "gain",
        config.gain
      );
    } else {
      this.workletManager.addFilter(
        soundId,
        filterId,
        config.type,
        config.frequency,
        config.Q,
        config.gain
      );
      this.filters.set(soundId, filterId);
    }
  }

  /**
   * Remove filter from a sound
   */
  removeFilter(soundId: string): void {
    const filterId = this.filters.get(soundId);
    if (filterId) {
      this.workletManager?.removeFilter(soundId, filterId);
      this.filters.delete(soundId);
    }
  }

  // ============================================
  // Subscriptions
  // ============================================

  /**
   * Subscribe to state changes for a sound
   */
  subscribe(soundId: string, callback: AudioStateCallback): Unsubscribe {
    if (!this.listeners.has(soundId)) {
      this.listeners.set(soundId, new Set());
    }

    this.listeners.get(soundId)?.add(callback);

    return () => {
      const callbacks = this.listeners.get(soundId);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.listeners.delete(soundId);
        }
      }
    };
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Clean up all resources
   */
  cleanup(): void {
    for (const soundId of this.sounds.keys()) {
      this.stopSound(soundId);
    }

    this.sounds.clear();
    this.listeners.clear();
    this.filters.clear();
    this.lastSoundVolumes.clear();

    this.workletManager?.cleanup();
    this.workletManager = null;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Initialize audio system
   */
  private async doInit(): Promise<void> {
    const context = getAudioContext();
    if (!context) {
      throw new Error("Failed to get audio context");
    }

    // Resume the audio context first - this is required before accessing audioWorklet
    // on some browsers, as suspended contexts may not have audioWorklet fully initialized
    await resumeAudioContext();

    this.workletManager = new WorkletManager(context, workletProcessorUrl);
    await this.workletManager.init();

    // Set up event handlers
    this.workletManager.on("sourceEnded", ({ sourceId }) => {
      const instance = this.sounds.get(sourceId);
      if (instance) {
        instance.playing = false;
        this.notifyListeners(sourceId, {
          isPlaying: false,
          isLoading: false,
          isBuffering: false,
          volume: instance.volume,
          error: null,
          hasEnded: true,
        });
      }
    });

    this.workletManager.on("sourceError", ({ sourceId, error }) => {
      const instance = this.sounds.get(sourceId);
      if (instance) {
        this.notifyListeners(sourceId, {
          isPlaying: false,
          isLoading: false,
          isBuffering: false,
          volume: instance.volume,
          error: {
            message: error,
            code: "PLAYBACK_FAILED",
            radio: instance.radio,
            timestamp: Date.now(),
          },
          hasEnded: false,
        });
      }
    });

    this.workletManager.on("streamReady", ({ sourceId }) => {
      const instance = this.sounds.get(sourceId);
      if (instance) {
        instance.loading = false;
        this.notifyListeners(sourceId, {
          isPlaying: instance.playing,
          isLoading: false,
          isBuffering: instance.buffering,
          volume: instance.volume,
          error: null,
          hasEnded: false,
        });
      }
    });
  }

  /**
   * Get proxied URL for CORS
   */
  private getProxiedUrl(url: string): string {
    const bandcampUrl = getProxiedBandcampUrl(url);
    if (bandcampUrl !== url) {
      return bandcampUrl;
    }
    return getProxiedSoundCloudUrl(url);
  }

  /**
   * Notify all listeners for a sound
   */
  private notifyListeners(soundId: string, state: AudioState): void {
    const callbacks = this.listeners.get(soundId);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(state);
      }
    }
  }

  /**
   * Map effect type to worklet type
   */
  private mapEffectType(
    type: EffectConfig["type"]
  ): import("../playback/worklet-manager.js").EffectType {
    if (type === "plateReverb") {
      return "reverb";
    }
    return type;
  }

  /**
   * Convert effect config to worklet format
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: simple switch over effect types
  private convertEffectConfig(config: EffectConfig): Record<string, number> {
    const base: Record<string, number> = {};

    // Common dry/wet handling
    if (config.dryWet !== undefined) {
      base.wet = config.dryWet;
      base.dry = 1 - config.dryWet;
    }

    switch (config.type) {
      case "biquadFilter": {
        const filterTypeMap: Record<string, number> = {
          lowpass: 0,
          highpass: 1,
          bandpass: 2,
          lowshelf: 3,
          highshelf: 4,
          peaking: 5,
          notch: 6,
          allpass: 7,
        };
        base.filterType = filterTypeMap[config.filterType] ?? 0;
        base.frequency = config.frequency;
        base.Q = config.Q;
        base.gain = config.gain;
        break;
      }
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
      case "standardReverb":
        base.roomSize = config.roomSize;
        base.damp = config.decayTime;
        break;
      case "phaseVocoder":
        base.pitchFactor = config.pitchFactor;
        break;
      case "delay":
        base.delayTime = config.delayTime;
        base.feedback = config.feedback;
        break;
      case "distortion":
        base.amount = config.amount;
        break;
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
        base.panning = config.panning;
        base.stereo = config.stereo;
        base.invertL = config.invertL ? 1 : 0;
        base.invertR = config.invertR ? 1 : 0;
        base.swap = config.swap ? 1 : 0;
        break;
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

    return base;
  }

  /**
   * Convert partial effect config to worklet format
   */
  private convertPartialEffectConfig(
    config: Partial<EffectConfig>
  ): Record<string, number> {
    const result: Record<string, number> = {};

    if (config.dryWet !== undefined) {
      result.wet = config.dryWet;
      result.dry = 1 - config.dryWet;
      result.mix = config.dryWet;
    }

    // Copy numeric properties directly
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === "number" && key !== "order") {
        result[key] = value;
      } else if (typeof value === "boolean") {
        result[key] = value ? 1 : 0;
      }
    }

    return result;
  }
}
