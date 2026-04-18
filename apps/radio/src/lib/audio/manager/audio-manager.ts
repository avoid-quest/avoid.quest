/**
 * Audio Manager
 *
 * Simplified high-level API for audio playback with effects.
 * Uses browser-backed playback sources with native graph nodes for routing and effects.
 *
 * Audio routing (post-effects CUE):
 *   PlaybackSource → Pan → Filter → WorkletNode (effects) → PreFaderSend (CUE tap) → Gain (fader) → Analyser → MainDelayNode → Destination
 *
 * The CUE tap point is now AFTER effects processing, so headphone monitoring
 * includes the effects but is still independent of the channel fader.
 * Main delay is applied after all sound processing, before final output.
 */

import {
  getProxiedBandcampUrl,
  getProxiedSoundCloudUrl,
} from "@avoid.quest/platforms";
import type { EffectConfig } from "../dsp/effects/types.js";
import {
  type AudioState,
  type AudioStateCallback,
  type ChannelSelection,
  createDeviceSource,
  createPlaybackSource,
  type DeviceAudioConstraints,
  type DeviceSource,
  getAudioContext,
  initialAudioState,
  type Radio,
  resumeAudioContext,
  type Unsubscribe,
  WorkletManager,
} from "../playback/index.js";
import { safeDisconnect } from "../utils.js";
import {
  convertEffectConfig,
  convertPartialEffectConfig,
} from "./audio-manager-effects.js";
import {
  attachWorkletManagerListeners,
  cleanupSoundNodes,
  connectAudioGraph,
  createMasterGraphNodes,
  startMasterMeterLoop,
  stopMasterMeterLoop,
} from "./audio-manager-graph.js";
import {
  createDeviceSourceCallbacks,
  createPlaybackSourceCallbacks,
} from "./audio-manager-source-callbacks.js";
import { notifySoundError, notifySoundState } from "./audio-manager-state.js";
import {
  type FilterConfig as AudioManagerFilterConfig,
  createAudioNodes,
  createSoundInstance,
  MAX_MAIN_DELAY_MS,
  MAX_MAIN_DELAY_SECONDS,
  type SoundInstance,
} from "./audio-manager-types.js";

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

export type { FilterConfig } from "./audio-manager-types.js";

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
  private readonly meterListeners = new Map<
    string,
    Set<(level: { left: number; right: number }) => void>
  >();

  private readonly workletManagers = new Map<string, WorkletManager>();
  private workletModuleLoaded = false;
  private initPromise: Promise<void> | null = null;
  private globalVolume = 1;
  private globalMuted = false;
  private lastGlobalVolume = 1;
  private readonly lastSoundVolumes = new Map<string, number>();

  // Main output delay node (shared across all sounds)
  private mainDelayNode: DelayNode | null = null;
  private mainDelayMs = 0;

  // Master meter nodes (stereo analyser tap on main output)
  private masterAnalyserL: AnalyserNode | null = null;
  private masterAnalyserR: AnalyserNode | null = null;
  private masterSplitter: ChannelSplitterNode | null = null;
  private readonly masterMeterListeners = new Set<
    (level: { left: number; right: number }) => void
  >();
  private masterMeterRafId: number | null = null;
  private readonly masterMeterFrame = { count: 0, value: 0 };

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
   * Initialize the audio system (loads worklet module)
   */
  async init(): Promise<void> {
    if (this.workletModuleLoaded) {
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
   * Check if audio system is ready (worklet module loaded)
   */
  get isReady(): boolean {
    return this.workletModuleLoaded;
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
    const instance = createSoundInstance(radio, id);

    this.sounds.set(id, instance);

    // Notify ready state (sound is registered but not initialized)
    notifySoundState(this.notifyListeners, id, instance, {
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      error: null,
      hasEnded: false,
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

    // Device input: unmute by restoring gain (stream stays alive)
    if (instance.isDeviceInput && instance.deviceSource?.isActive) {
      const context = getAudioContext();
      if (context && instance.nodes) {
        const now = context.currentTime;
        const targetVolume = Math.max(0.0001, volume * this.globalVolume);
        instance.nodes.gain.gain.setTargetAtTime(targetVolume, now, 0.02);
      }
      instance.volume = volume;
      instance.playing = true;
      notifySoundState(this.notifyListeners, soundId, instance, {
        isPlaying: true,
        volume,
        error: null,
      });
      return;
    }

    await this.init();
    await resumeAudioContext();

    const context = getAudioContext();
    if (!context) {
      throw new Error("Audio context not available");
    }

    // Update instance state
    instance.volume = volume;
    instance.playing = true;
    instance.loading = true;

    // Notify loading state
    notifySoundState(this.notifyListeners, soundId, instance, {
      isPlaying: true,
      isLoading: true,
      volume,
      error: null,
    });

    // Create audio nodes if not exists
    if (!instance.nodes) {
      instance.nodes = createAudioNodes(context);
    }

    // Create remote playback source if not exists or if previous ended/errored
    if (instance.playbackSource?.isActive) {
      // Resuming existing source - tell worklet to resume
      const wm = this.workletManagers.get(soundId);
      wm?.resumeSource(soundId);
    } else {
      // Clean up old source
      instance.playbackSource?.cleanup();

      // Create playback source
      instance.playbackSource = createPlaybackSource(
        context,
        soundId,
        this.getProxiedUrl(instance.radio.streamUrl),
        createPlaybackSourceCallbacks({
          instance,
          soundId,
          notifyListeners: this.notifyListeners,
        })
      );

      // Get proxied URL for Bandcamp/SoundCloud
      const streamUrl = this.getProxiedUrl(instance.radio.streamUrl);

      // Load and connect
      await instance.playbackSource.load(streamUrl);
      const graphConnected = await this.connectAudioGraph(instance);
      if (!graphConnected) {
        console.warn(
          `[AudioManager] Audio graph connection failed for ${soundId}, playback may be affected`
        );
      }
    }

    // Set initial volume
    this.setVolume(soundId, volume);

    // Start playback
    await instance.playbackSource.play();
  }

  /**
   * Play a device input source (mic/line-in) through the full audio graph
   */
  async playDeviceSound(
    soundId: string,
    deviceId: string,
    constraints?: DeviceAudioConstraints
  ): Promise<void> {
    const instance = this.sounds.get(soundId);
    if (!instance) {
      throw new Error(`Sound with id ${soundId} not found`);
    }

    await this.init();
    await resumeAudioContext();

    const context = getAudioContext();
    if (!context) {
      throw new Error("Audio context not available");
    }

    instance.isDeviceInput = true;
    instance.loading = true;

    notifySoundState(this.notifyListeners, soundId, instance, {
      isPlaying: false,
      isLoading: true,
      error: null,
    });

    // Create audio nodes
    if (!instance.nodes) {
      instance.nodes = createAudioNodes(context);
    }

    // Create device source
    instance.deviceSource = createDeviceSource(
      context,
      soundId,
      createDeviceSourceCallbacks({
        instance,
        soundId,
        notifyListeners: this.notifyListeners,
      })
    );

    // Start capture (onActive callback fires when stream is ready)
    await instance.deviceSource.start(deviceId, constraints);

    // Connect through the full audio graph (after start so output node exists)
    const graphConnected = await this.connectAudioGraph(instance);
    if (!graphConnected) {
      console.warn(
        `[AudioManager] Audio graph connection failed for device ${soundId}`
      );
    }

    // Set initial volume (after graph connection)
    this.setVolume(soundId, instance.volume);
  }

  /**
   * Set channel selection for a device input
   */
  setDeviceChannelSelection(
    soundId: string,
    selection: ChannelSelection
  ): void {
    const instance = this.sounds.get(soundId);
    if (!instance?.deviceSource) {
      return;
    }
    instance.deviceSource.setChannelSelection(selection);
  }

  /**
   * Get the DeviceSource for a sound (to read channel count, etc.)
   */
  getDeviceSource(soundId: string): DeviceSource | null {
    const instance = this.sounds.get(soundId);
    return instance?.deviceSource ?? null;
  }

  /**
   * Connect the audio graph for a sound instance
   *
   * Routing (post-effects CUE):
   *   Source → Pan → Filter → Worklet (effects) → PreFaderSend (CUE tap) → Gain (fader) → Analyser → Destination
   *
   * The CUE tap is now AFTER effects, so headphone monitoring includes effects
   * but is still independent of the channel fader volume.
   *
   * @returns true if graph was connected successfully, false otherwise
   */
  private connectAudioGraph(instance: SoundInstance): Promise<boolean> {
    return connectAudioGraph({
      instance,
      mainDelayNode: this.mainDelayNode,
      notifyListeners: this.notifyListeners,
      getOrCreateWorkletManager: (soundId) =>
        this.getOrCreateWorkletManager(soundId),
    });
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

    // Device input: mute gain instead of stopping stream (instant unmute later)
    if (instance.isDeviceInput) {
      const context = getAudioContext();
      if (context && instance.nodes) {
        const now = context.currentTime;
        instance.nodes.gain.gain.setTargetAtTime(0.0001, now, 0.02);
      }
    } else {
      instance.playbackSource?.pause();
      this.workletManagers.get(soundId)?.pauseSource(soundId);
    }

    notifySoundState(this.notifyListeners, soundId, instance, {
      isPlaying: false,
      error: null,
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
    instance.playbackSource?.stop();
    instance.deviceSource?.stop();
    this.workletManagers.get(soundId)?.stopSource(soundId);

    notifySoundState(this.notifyListeners, soundId, instance, {
      isPlaying: false,
      volume: 0,
      error: null,
    });
  }

  /**
   * Clean up a sound and release resources
   */
  cleanupSound(soundId: string): void {
    this.stopSound(soundId);

    const instance = this.sounds.get(soundId);
    if (instance) {
      // Clean up sources
      instance.playbackSource?.cleanup();
      instance.playbackSource = null;
      instance.deviceSource?.cleanup();
      instance.deviceSource = null;

      // Disconnect nodes (may already be disconnected)
      cleanupSoundNodes(instance);
    }

    // Cleanup per-sound worklet manager
    const wm = this.workletManagers.get(soundId);
    if (wm) {
      wm.cleanup();
      this.workletManagers.delete(soundId);
    }

    // Notify meter listeners with zero before removing the sound,
    // so consumers (e.g. deck-panel) can reset their UI state.
    const meterCallbacks = this.meterListeners.get(soundId);
    if (meterCallbacks) {
      for (const callback of meterCallbacks) {
        callback({ left: 0, right: 0 });
      }
    }

    this.sounds.delete(soundId);
    this.lastSoundVolumes.delete(soundId);

    this.notifyListeners(soundId, { ...initialAudioState });
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
      console.warn(`[AudioManager] setVolume: sound ${soundId} not found`);
      return;
    }

    const clampedVolume = Math.max(0, Math.min(1, volume));
    instance.volume = clampedVolume;

    // Use native GainNode for hardware-accelerated volume control
    if (instance.nodes) {
      const context = getAudioContext();
      if (context) {
        const now = context.currentTime;
        const targetVolume = Math.max(
          0.0001,
          clampedVolume * this.globalVolume
        );
        instance.nodes.gain.gain.setTargetAtTime(targetVolume, now, 0.05);
      }
    }

    notifySoundState(this.notifyListeners, soundId, instance, {
      volume: clampedVolume,
      error: null,
    });
  }

  /**
   * Set pan for a sound (-1 to 1)
   */
  setPan(soundId: string, pan: number): void {
    const instance = this.sounds.get(soundId);
    if (!instance?.nodes) {
      console.warn(
        `[AudioManager] setPan: sound ${soundId} not found or not initialized`
      );
      return;
    }

    const clampedPan = Math.max(-1, Math.min(1, pan));
    instance.pan = clampedPan;

    const context = getAudioContext();
    if (context) {
      const now = context.currentTime;
      instance.nodes.pan.pan.setTargetAtTime(clampedPan, now, 0.05);
    }
  }

  /**
   * Set playback rate for a sound (0.5 to 2.0)
   * Note: This changes both speed and pitch when the browser transport supports it.
   */
  setPlaybackRate(soundId: string, rate: number): void {
    const instance = this.sounds.get(soundId);
    if (!instance) {
      console.warn(
        `[AudioManager] setPlaybackRate: sound ${soundId} not found`
      );
      return;
    }

    // Can't change speed of live audio
    if (instance.isDeviceInput) {
      return;
    }

    if (!instance.playbackSource) {
      return;
    }

    const clampedRate = Math.max(0.5, Math.min(2.0, rate));
    instance.playbackSource.setPlaybackRate(clampedRate);
  }

  seekSound(soundId: string, position: number): void {
    const instance = this.sounds.get(soundId);
    if (!instance) {
      return;
    }

    if (instance.isDeviceInput) {
      return;
    }

    if (!instance.playbackSource) {
      return;
    }

    instance.playbackSource.seek(position);
  }

  /**
   * Set channel filter (bipolar: -1 = lowpass, 0 = off, 1 = highpass)
   * This is a simple DJ-style one-knob filter that sweeps frequency
   */
  setChannelFilter(soundId: string, value: number): void {
    const instance = this.sounds.get(soundId);
    if (!instance?.nodes) {
      console.warn(
        `[AudioManager] setChannelFilter: sound ${soundId} not found or not initialized`
      );
      return;
    }

    const clampedValue = Math.max(-1, Math.min(1, value));
    const context = getAudioContext();
    if (!context) {
      return;
    }

    const now = context.currentTime;
    const filter = instance.nodes.filter;

    // If value is near center, bypass filter
    if (Math.abs(clampedValue) < 0.05) {
      // Bypass: set to allpass-like behavior
      filter.type = "allpass";
      filter.frequency.setTargetAtTime(1000, now, 0.05);
      return;
    }

    if (clampedValue < 0) {
      // Negative: Lowpass sweep (lower value = lower cutoff)
      // Logarithmic mapping -1→0 : 80Hz→20kHz — evenly distributed on perceptual scale
      filter.type = "lowpass";
      const t = 1 + clampedValue; // 0..1
      const freq = 80 * (20_000 / 80) ** t;
      filter.frequency.setTargetAtTime(freq, now, 0.05);
      filter.Q.setTargetAtTime(1.0, now, 0.05);
    } else {
      // Positive: Highpass sweep (higher value = higher cutoff)
      // Logarithmic mapping 0→1 : 20Hz→18kHz — evenly distributed on perceptual scale
      filter.type = "highpass";
      const freq = 20 * (18_000 / 20) ** clampedValue;
      filter.frequency.setTargetAtTime(freq, now, 0.05);
      filter.Q.setTargetAtTime(1.0, now, 0.05);
    }
  }

  /**
   * Set master dry/wet for the effect chain (0 = bypass all, 1 = full effects)
   */
  setEffectsDryWet(soundId: string, value: number): void {
    const instance = this.sounds.get(soundId);
    if (!instance) {
      console.warn(
        `[AudioManager] setEffectsDryWet: sound ${soundId} not found`
      );
      return;
    }

    const clampedValue = Math.max(0, Math.min(1, value));
    this.workletManagers.get(soundId)?.setEffectsDryWet(soundId, clampedValue);
  }

  /**
   * Get global volume
   */
  getGlobalVolume(): number {
    return this.globalVolume;
  }

  /**
   * Set global volume (0-1)
   *
   * Note: Master volume is applied ONLY to the channel gain nodes (post-CUE tap).
   * This ensures CUE/headphone monitoring is independent of master volume.
   */
  setGlobalVolume(volume: number): void {
    this.globalVolume = Math.max(0, Math.min(1, volume));

    // Update all active sounds (channel gain is post-CUE tap, so CUE is unaffected)
    for (const [_soundId, instance] of this.sounds) {
      if (instance.nodes) {
        const context = getAudioContext();
        if (context) {
          const now = context.currentTime;
          const targetVolume = Math.max(
            0.0001,
            instance.volume * this.globalVolume
          );
          instance.nodes.gain.gain.setTargetAtTime(targetVolume, now, 0.05);
        }
      }
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
   * Get current main output delay in milliseconds
   */
  getMainDelay(): number {
    return this.mainDelayMs;
  }

  /**
   * Set main output delay (0-500ms)
   * Applies to all audio going to the main output
   */
  setMainDelay(ms: number): void {
    const clampedMs = Math.max(0, Math.min(MAX_MAIN_DELAY_MS, ms));
    this.mainDelayMs = clampedMs;

    if (!this.mainDelayNode) {
      return;
    }

    const context = getAudioContext();
    if (!context) {
      return;
    }

    const now = context.currentTime;
    const seconds = clampedMs / 1000;

    // Smooth transition to avoid clicks
    this.mainDelayNode.delayTime.setTargetAtTime(seconds, now, 0.02);
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
   *
   * @returns true if effect was added, false if no worklet manager exists
   */
  addEffect(soundId: string, config: EffectConfig): boolean {
    const wm = this.workletManagers.get(soundId);
    if (!wm) {
      return false;
    }

    const engineConfig = convertEffectConfig(config);

    wm.addEffect(soundId, config.id, config.type, engineConfig, config.order);
    return true;
  }

  /**
   * Remove an effect from a sound
   */
  removeEffect(soundId: string, effectId: string): void {
    this.workletManagers.get(soundId)?.removeEffect(soundId, effectId);
  }

  /**
   * Update an effect's configuration
   *
   * @returns true if effect was updated, false if no worklet manager exists
   */
  updateEffect(
    soundId: string,
    effectId: string,
    config: Partial<EffectConfig>
  ): boolean {
    const wm = this.workletManagers.get(soundId);
    if (!wm) {
      return false;
    }

    const engineConfig = convertPartialEffectConfig(config);
    wm.updateEffect(soundId, effectId, engineConfig);
    return true;
  }

  /**
   * Reorder effects in a sound's chain
   */
  reorderEffects(soundId: string, effectIds: string[]): void {
    this.workletManagers.get(soundId)?.reorderEffects(soundId, effectIds);
  }

  // ============================================
  // Filter Management (using native BiquadFilterNode)
  // ============================================

  /**
   * Update filter on a sound (uses native BiquadFilterNode)
   */
  updateFilter(soundId: string, config: AudioManagerFilterConfig): void {
    const instance = this.sounds.get(soundId);
    if (!instance?.nodes) {
      console.warn(
        `[AudioManager] updateFilter: sound ${soundId} not found or not initialized`
      );
      return;
    }

    const { filter } = instance.nodes;
    const context = getAudioContext();
    if (!context) {
      return;
    }

    const now = context.currentTime;

    if (!config.enabled) {
      // Bypass filter by setting to highpass at 0Hz
      filter.type = "highpass";
      filter.frequency.setTargetAtTime(0, now, 0.05);
      instance.filterEnabled = false;
      return;
    }

    // Apply filter settings
    filter.type = config.type;
    filter.frequency.setTargetAtTime(config.frequency, now, 0.05);
    filter.Q.setTargetAtTime(config.Q, now, 0.05);
    filter.gain.setTargetAtTime(config.gain, now, 0.05);
    instance.filterEnabled = true;
  }

  /**
   * Remove filter from a sound
   */
  removeFilter(soundId: string): void {
    this.updateFilter(soundId, {
      enabled: false,
      type: "lowpass",
      frequency: 20_000,
      Q: 1,
      gain: 0,
    });
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

  /**
   * Subscribe to master output meter (post-fader, post-crossfader, post-master volume).
   * Returns left/right RMS levels (0-1) computed from real AnalyserNodes.
   */
  subscribeMasterMeter(
    callback: (level: { left: number; right: number }) => void
  ): Unsubscribe {
    this.masterMeterListeners.add(callback);

    // Start rAF loop on first subscriber
    if (this.masterMeterListeners.size === 1) {
      this.startMasterMeterLoop();
    }

    return () => {
      this.masterMeterListeners.delete(callback);
      // Stop rAF loop when last subscriber leaves
      if (this.masterMeterListeners.size === 0) {
        this.stopMasterMeterLoop();
      }
    };
  }

  /**
   * Subscribe to RMS meter updates for a sound
   * Returns left/right RMS levels (0-1)
   */
  subscribeMeter(
    soundId: string,
    callback: (level: { left: number; right: number }) => void
  ): Unsubscribe {
    if (!this.meterListeners.has(soundId)) {
      this.meterListeners.set(soundId, new Set());
    }

    this.meterListeners.get(soundId)?.add(callback);

    return () => {
      const callbacks = this.meterListeners.get(soundId);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.meterListeners.delete(soundId);
        }
      }
    };
  }

  // ============================================
  // Track Progress
  // ============================================

  /**
   * Get current track progress for a sound
   * Returns position and duration in seconds
   * For live streams, duration will be Infinity
   */
  getTrackProgress(
    soundId: string
  ): { position: number; duration: number } | null {
    const instance = this.sounds.get(soundId);
    if (!instance?.playbackSource) {
      return null;
    }

    return {
      position: instance.playbackSource.currentTime,
      duration: instance.playbackSource.duration,
    };
  }

  // ============================================
  // Stream URL Refresh (YouTube 403 recovery)
  // ============================================

  /**
   * Refresh the playback URL for a sound, optionally seeking to a position.
   * Used for YouTube URL refresh when streams get throttled (403 error).
   *
   * @param soundId - The sound ID to refresh
   * @param newUrl - The new stream URL (should already be proxied)
   * @param seekPosition - Optional position in seconds to seek to after refresh
   */
  async refreshStreamUrl(
    soundId: string,
    newUrl: string,
    seekPosition?: number
  ): Promise<void> {
    const instance = this.sounds.get(soundId);
    if (!instance?.playbackSource) {
      console.warn(
        `[AudioManager] refreshStreamUrl: sound ${soundId} not found or no playbackSource`
      );
      return;
    }

    // Update loading state
    instance.loading = true;
    notifySoundState(this.notifyListeners, soundId, instance, {
      isPlaying: false,
      isLoading: true,
      error: null,
    });

    try {
      // Get proxied URL
      const proxiedUrl = this.getProxiedUrl(newUrl);

      // Refresh the playback source with new URL
      await instance.playbackSource.refreshUrl(proxiedUrl, seekPosition);

      instance.loading = false;
      instance.playing = true;

      notifySoundState(this.notifyListeners, soundId, instance, {
        isPlaying: true,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      instance.loading = false;
      instance.playing = false;

      notifySoundError(
        this.notifyListeners,
        soundId,
        instance,
        "STREAM_FETCH_FAILED",
        error instanceof Error ? error.message : "Failed to refresh stream"
      );
    }
  }

  /**
   * Get the radio configuration for a sound
   * Useful for re-loading platform metadata to get a fresh URL
   */
  getSoundRadio(soundId: string): Radio | null {
    const instance = this.sounds.get(soundId);
    return instance?.radio ?? null;
  }

  // ============================================
  // CUE Pre-Fader Access
  // ============================================

  /**
   * Get the pre-fader audio node for a sound
   * This is a tap point AFTER effects but BEFORE the channel fader
   * Used for CUE/PFL monitoring (headphones hear effects but not fader changes)
   * Returns null if the sound doesn't exist or hasn't been initialized
   */
  getPreFaderNode(soundId: string): GainNode | null {
    const instance = this.sounds.get(soundId);
    return instance?.nodes?.preFaderSend ?? null;
  }

  /**
   * Get the post-fader (post-crossfader) audio node for a sound
   * This is the gain node where channel volume and crossfader are applied
   * Used for MIX monitoring in headphones (hear what the audience hears)
   * Returns null if the sound doesn't exist or hasn't been initialized
   */
  getPostFaderNode(soundId: string): GainNode | null {
    const instance = this.sounds.get(soundId);
    return instance?.nodes?.gain ?? null;
  }

  /**
   * Get the WorkletManager for a sound
   * This provides access to the master output node for CUE/MIX monitoring
   * Returns null if the sound doesn't exist or worklet isn't initialized
   */
  getWorkletManager(soundId: string): WorkletManager | null {
    return this.workletManagers.get(soundId) ?? null;
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
    this.meterListeners.clear();
    this.lastSoundVolumes.clear();

    // Cleanup all per-sound worklet managers
    for (const wm of this.workletManagers.values()) {
      wm.cleanup();
    }
    this.workletManagers.clear();
    this.workletModuleLoaded = false;

    // Cleanup master meter
    this.stopMasterMeterLoop();
    this.masterMeterListeners.clear();
    if (this.masterSplitter) {
      safeDisconnect(this.masterSplitter, "AudioManager.cleanup");
      this.masterSplitter = null;
    }
    if (this.masterAnalyserL) {
      safeDisconnect(this.masterAnalyserL, "AudioManager.cleanup");
      this.masterAnalyserL = null;
    }
    if (this.masterAnalyserR) {
      safeDisconnect(this.masterAnalyserR, "AudioManager.cleanup");
      this.masterAnalyserR = null;
    }

    // Cleanup main delay node
    if (this.mainDelayNode) {
      safeDisconnect(this.mainDelayNode, "AudioManager.cleanup");
      this.mainDelayNode = null;
    }
    this.mainDelayMs = 0;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Start the master meter rAF loop (~30fps, every other frame)
   */
  private startMasterMeterLoop(): void {
    if (!(this.masterAnalyserL && this.masterAnalyserR)) {
      return;
    }

    this.masterMeterRafId = startMasterMeterLoop(
      this.masterAnalyserL,
      this.masterAnalyserR,
      this.masterMeterListeners,
      this.masterMeterFrame
    );
  }

  /**
   * Stop the master meter rAF loop
   */
  private stopMasterMeterLoop(): void {
    stopMasterMeterLoop(this.masterMeterFrame.value || this.masterMeterRafId);
    this.masterMeterRafId = null;
    this.masterMeterFrame.count = 0;
    this.masterMeterFrame.value = 0;
  }

  /**
   * Initialize audio system (loads worklet module)
   */
  private async doInit(): Promise<void> {
    const context = getAudioContext();
    if (!context) {
      throw new Error("Failed to get audio context");
    }

    // Resume the audio context first
    await resumeAudioContext();

    const masterGraph = createMasterGraphNodes(context, MAX_MAIN_DELAY_SECONDS);
    this.mainDelayNode = masterGraph.mainDelayNode;
    this.masterSplitter = masterGraph.masterSplitter;
    this.masterAnalyserL = masterGraph.masterAnalyserL;
    this.masterAnalyserR = masterGraph.masterAnalyserR;

    // Load the worklet module once (will be used by all per-sound worklet managers)
    await context.audioWorklet.addModule(workletProcessorUrl);
    this.workletModuleLoaded = true;
  }

  /**
   * Get or create a WorkletManager for a specific sound
   */
  private async getOrCreateWorkletManager(
    soundId: string
  ): Promise<WorkletManager> {
    let wm = this.workletManagers.get(soundId);
    if (wm) {
      return wm;
    }

    const context = getAudioContext();
    if (!context) {
      throw new Error("Audio context not available");
    }

    // Create new WorkletManager for this sound
    // Note: worklet module is already loaded in doInit()
    wm = new WorkletManager(context, workletProcessorUrl);
    await wm.init();
    this.workletManagers.set(soundId, wm);

    attachWorkletManagerListeners({
      wm,
      soundId,
      sounds: this.sounds,
      meterListeners: this.meterListeners,
      notifyListeners: this.notifyListeners,
    });

    // Note: We intentionally don't set wm.setVolume() here.
    // Worklet masterGainNode stays at unity (1.0) so CUE tap gets full signal.
    // Master volume is applied via channel gain nodes (post-CUE tap).

    return wm;
  }

  /**
   * Get proxied URL for CORS
   */
  private getProxiedUrl(url: string): string {
    const bandcampUrl = getProxiedBandcampUrl(url);
    if (bandcampUrl !== url) {
      return bandcampUrl;
    }
    // YouTube URLs do not need additional proxying (handled at stream resolution time)
    return getProxiedSoundCloudUrl(url);
  }

  /**
   * Notify all listeners for a sound
   */
  private readonly notifyListeners = (
    soundId: string,
    state: AudioState
  ): void => {
    const callbacks = this.listeners.get(soundId);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(state);
      }
    }
  };
}
