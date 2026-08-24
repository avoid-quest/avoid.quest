/**
 * Audio Manager
 *
 * Simplified high-level API for audio playback with effects.
 * Uses browser-backed playback sources with native graph nodes for routing and effects.
 *
 * Audio routing (post-effects CUE):
 *   PlaybackSource → Pan → Filter → Effects → PreFaderSend (CUE tap) → Gain (fader) → MainDelayNode → Destination
 *                                                                            ↘ openDAW MeterWorklet
 *
 * The CUE tap point is now AFTER effects processing, so headphone monitoring
 * includes the effects but is still independent of the channel fader.
 * Main delay is applied after all sound processing, before final output.
 */

import type {
  DesiredEffectsState,
  EffectsRuntimeOutcome,
} from "../../channel-effects.js";
import { getOutputRouting, type OutputRouting } from "../../output-routing.js";
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
  toPlaybackInput,
  type Unsubscribe,
} from "../playback/index.js";
import { inferStreamFormat } from "../playback/stream-format.js";
import { cleanupSoundNodes, connectAudioGraph } from "./audio-manager-graph.js";
import {
  createDeviceSourceCallbacks,
  createPlaybackSourceCallbacks,
} from "./audio-manager-source-callbacks.js";
import { notifySoundError, notifySoundState } from "./audio-manager-state.js";
import {
  type FilterConfig as AudioManagerFilterConfig,
  createAudioNodes,
  type SoundInstance,
  type SoundOutputMode,
} from "./audio-manager-types.js";
import { EffectsController } from "./effects-controller.js";
import { MeterService } from "./meter-service.js";
import { SoundRegistry } from "./sound-registry.js";
import { VolumeController } from "./volume-controller.js";

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

  private readonly soundRegistry = new SoundRegistry();
  private readonly listeners = new Map<string, Set<AudioStateCallback>>();
  readonly volume: VolumeController;
  private readonly effects: EffectsController;
  private readonly output: OutputRouting;
  readonly meters: MeterService;
  private audioSystemInitialized = false;
  private initPromise: Promise<void> | null = null;

  private get sounds(): Map<string, SoundInstance> {
    return this.soundRegistry.asMap();
  }

  private constructor() {
    this.meters = new MeterService();
    this.output = getOutputRouting();
    this.volume = new VolumeController({
      getSound: (soundId) => this.soundRegistry.get(soundId),
      getSounds: () => this.soundRegistry.entries(),
      notifyListeners: this.notifyListeners,
    });
    this.effects = new EffectsController({
      workletProcessorUrl: () => workletProcessorUrl,
      sounds: this.soundRegistry.asMap(),
      notifyListeners: this.notifyListeners,
    });
  }

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
   * Initialize the native audio system. Effect runtimes are loaded on demand.
   */
  async init(): Promise<void> {
    if (this.audioSystemInitialized) {
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
   * Check if the native audio system is ready.
   */
  get isReady(): boolean {
    return this.audioSystemInitialized;
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
  createSound(
    radio: Radio,
    soundId?: string,
    outputMode: SoundOutputMode = "audio-graph"
  ): string {
    const id = this.soundRegistry.create(
      radio,
      soundId,
      (existingSoundId) => {
        this.cleanupSound(existingSoundId);
      },
      outputMode
    );
    const instance = this.soundRegistry.get(id);
    if (!instance) {
      throw new Error(`Failed to create sound with id ${id}`);
    }

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
        const targetVolume = Math.max(
          0.0001,
          volume * this.volume.getGlobalVolume()
        );
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

    if (instance.outputMode === "native") {
      await this.playNativeSound(soundId, instance, volume);
      return;
    }

    const context = getAudioContext();
    if (!context) {
      throw new Error("Audio context not available");
    }
    const resumePromise = resumeAudioContext();
    // Build the native master shell synchronously so the media play request
    // can remain in the originating user-activation task on mobile.
    this.output.getMainOutput(context);
    this.output.replaceContext(context).catch(console.error);

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
      instance.nodes = createAudioNodes(
        context,
        volume * this.volume.getGlobalVolume()
      );
    }

    // Initialize the requested gain before any source is connected. This is
    // especially important for muted incoming crossfade sources.
    this.volume.set(soundId, volume);

    let playPromise: Promise<void> | null = null;
    const activePlaybackSource = instance.playbackSource?.isActive
      ? instance.playbackSource
      : null;

    // Create remote playback source if not exists or if previous ended/errored
    if (activePlaybackSource) {
      playPromise = this.startPlayback(activePlaybackSource);
    } else {
      // Clean up old source
      instance.playbackSource?.cleanup();

      // Create playback source
      instance.playbackSource = createPlaybackSource(
        context,
        soundId,
        createPlaybackSourceCallbacks({
          instance,
          soundId,
          notifyListeners: this.notifyListeners,
        })
      );

      // Start graph preparation before requesting media playback. The native
      // shell is connected synchronously, while effect runtimes may continue
      // preparing behind a muted branch. Request play in this same task to
      // preserve mobile transient user activation.
      const loadPromise = this.handleDeferredRejection(
        instance.playbackSource.load(toPlaybackInput(instance.radio))
      );
      const setupPromise = this.ensurePlaybackSetup(
        soundId,
        instance,
        activePlaybackSource,
        resumePromise
      );
      const graphPromise = this.connectAudioGraphOrRollback(
        soundId,
        instance,
        activePlaybackSource
      );
      playPromise = this.startPlayback(instance.playbackSource);
      await Promise.all([setupPromise, loadPromise, graphPromise]);
    }

    if (activePlaybackSource) {
      await this.ensurePlaybackSetup(
        soundId,
        instance,
        activePlaybackSource,
        resumePromise
      );
    }

    if (activePlaybackSource) {
      this.effects.resumeSource(soundId);
    }

    // Start playback
    if (playPromise) {
      await playPromise;
    }
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
      instance.nodes = createAudioNodes(
        context,
        instance.volume * this.volume.getGlobalVolume()
      );
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
   *   Source → Pan → Filter → Effects → PreFaderSend (CUE tap) → Gain (fader) → Destination
   *                                                              ↘ openDAW MeterWorklet
   *
   * The CUE tap is now AFTER effects, so headphone monitoring includes effects
   * but is still independent of the channel fader volume.
   *
   * @returns true if graph was connected successfully, false otherwise
   */
  private async connectAudioGraph(instance: SoundInstance): Promise<boolean> {
    const connected = await connectAudioGraph({
      instance,
      connectMainOutput: (source) => this.output.connectMain(source),
      notifyListeners: this.notifyListeners,
      connectEffectsGraph: (soundId, source, destination) =>
        this.effects.connectGraph(soundId, source, destination),
    });
    if (connected && instance.nodes) {
      await this.meters.setSoundSource(instance.sourceId, instance.nodes.gain);
    }
    return connected;
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
      this.effects.pauseSource(soundId);
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
    this.effects.stopSource(soundId);

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
    this.effects.cleanupSound(soundId);

    this.meters.clearSoundSource(soundId);

    this.soundRegistry.delete(soundId);
    this.volume.deleteSound(soundId);

    this.notifyListeners(soundId, { ...initialAudioState });
  }

  // ============================================
  // Volume Control
  // ============================================

  /**
   * Set volume for a sound (0-1)
   */
  setVolume(soundId: string, volume: number): void {
    this.volume.set(soundId, volume);
  }

  /**
   * Schedule a volume curve for a sound without a main-thread animation loop.
   */
  scheduleVolumeCurve(
    soundId: string,
    volumeCurve: Float32Array,
    durationMs: number
  ): void {
    this.volume.scheduleVolumeCurve(soundId, volumeCurve, durationMs);
  }

  hasSound(soundId: string): boolean {
    return this.soundRegistry.has(soundId);
  }

  getSoundVolume(soundId: string): number | null {
    return this.volume.getSoundVolume(soundId);
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
   * Get global volume
   */
  getGlobalVolume(): number {
    return this.volume.getGlobalVolume();
  }

  /**
   * Set global volume (0-1)
   *
   * Note: Master volume is applied ONLY to the channel gain nodes (post-CUE tap).
   * This ensures CUE/headphone monitoring is independent of master volume.
   */
  setGlobalVolume(volume: number): void {
    this.volume.setGlobalVolume(volume);
  }

  /**
   * Mute global audio
   */
  muteGlobal(): void {
    this.volume.muteGlobal();
  }

  /**
   * Unmute global audio
   */
  unmuteGlobal(): void {
    this.volume.unmuteGlobal();
  }

  /**
   * Check if global audio is muted
   */
  isGlobalMuted(): boolean {
    return this.volume.isGlobalMuted();
  }

  /**
   * Mute a specific sound
   */
  muteSound(soundId: string): void {
    this.volume.muteSound(soundId);
  }

  /**
   * Unmute a specific sound
   */
  unmuteSound(soundId: string): void {
    this.volume.unmuteSound(soundId);
  }

  /**
   * Check if a sound is muted
   */
  isSoundMuted(soundId: string): boolean {
    return this.volume.isSoundMuted(soundId);
  }

  // ============================================
  // Effect Management
  // ============================================

  reconcileEffects(
    soundId: string,
    desired: DesiredEffectsState
  ): Promise<EffectsRuntimeOutcome> {
    return this.effects.reconcile(soundId, desired);
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
   * Returns left/right peak levels (0-1) computed by openDAW's MeterWorklet.
   */
  subscribeMasterMeter(
    callback: (level: { left: number; right: number }) => void
  ): Unsubscribe {
    return this.meters.subscribeMasterMeter(callback);
  }

  /**
   * Subscribe to peak meter updates for a sound
   * Returns left/right peak levels (0-1)
   */
  subscribeMeter(
    soundId: string,
    callback: (level: { left: number; right: number }) => void
  ): Unsubscribe {
    return this.meters.subscribeMeter(soundId, callback);
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
    seekPosition?: number,
    streamFormat?: Radio["streamFormat"]
  ): Promise<void> {
    const instance = this.sounds.get(soundId);
    if (!instance?.playbackSource) {
      throw new Error(
        `Cannot refresh sound ${soundId}: sound not found or playback is not initialized`
      );
    }

    // Update loading state
    instance.loading = true;
    notifySoundState(this.notifyListeners, soundId, instance, {
      isPlaying: false,
      isLoading: true,
      error: null,
    });

    const refreshedRadio = {
      ...instance.radio,
      streamFormat: streamFormat ?? inferStreamFormat(newUrl),
      streamUrl: newUrl,
    };

    try {
      await instance.playbackSource.refreshUrl(
        toPlaybackInput(refreshedRadio),
        seekPosition
      );

      instance.radio = refreshedRadio;
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
      throw error;
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

    this.soundRegistry.clear();
    this.listeners.clear();
    this.meters.clear();
    this.volume.clear();

    // Cleanup all per-sound worklet managers
    this.effects.cleanup();
    this.audioSystemInitialized = false;
    this.output.cleanup();
  }

  // ============================================
  // Private Methods
  // ============================================

  private handleDeferredRejection<T>(promise: Promise<T>): Promise<T> {
    promise.catch(() => undefined);
    return promise;
  }

  private async playNativeSound(
    soundId: string,
    instance: SoundInstance,
    volume: number
  ): Promise<void> {
    instance.volume = volume;
    instance.playing = true;
    instance.loading = true;
    notifySoundState(this.notifyListeners, soundId, instance, {
      isPlaying: true,
      isLoading: true,
      volume,
      error: null,
    });

    const activePlaybackSource = instance.playbackSource?.isActive
      ? instance.playbackSource
      : null;
    try {
      if (activePlaybackSource) {
        this.volume.set(soundId, volume);
        await this.startPlayback(activePlaybackSource);
        return;
      }

      instance.playbackSource?.cleanup();
      instance.playbackSource = createPlaybackSource(
        null,
        soundId,
        createPlaybackSourceCallbacks({
          instance,
          soundId,
          notifyListeners: this.notifyListeners,
        })
      );
      this.volume.set(soundId, volume);

      const loadPromise = this.handleDeferredRejection(
        instance.playbackSource.load(toPlaybackInput(instance.radio))
      );
      const playPromise = this.startPlayback(instance.playbackSource);
      await Promise.all([loadPromise, playPromise]);
    } catch (error) {
      this.rollbackEarlyPlayback(soundId, instance, activePlaybackSource);
      throw error;
    }
  }

  private startPlayback(
    playbackSource: NonNullable<SoundInstance["playbackSource"]>
  ): Promise<void> {
    return this.handleDeferredRejection(playbackSource.play());
  }

  private rollbackEarlyPlayback(
    soundId: string,
    instance: SoundInstance,
    activePlaybackSource: NonNullable<SoundInstance["playbackSource"]> | null
  ): void {
    if (this.soundRegistry.get(soundId) !== instance) {
      return;
    }

    if (activePlaybackSource) {
      activePlaybackSource.pause();
    } else {
      instance.playbackSource?.stop();
      instance.playbackSource?.cleanup();
      instance.playbackSource = null;
    }

    instance.playing = false;
    instance.loading = false;
    instance.buffering = false;
    notifySoundState(this.notifyListeners, soundId, instance, {
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
    });
  }

  private async ensurePlaybackSetup(
    soundId: string,
    instance: SoundInstance,
    activePlaybackSource: NonNullable<SoundInstance["playbackSource"]> | null,
    resumePromise: Promise<void>
  ): Promise<void> {
    try {
      await resumePromise;
      await this.init();
    } catch (error) {
      this.rollbackEarlyPlayback(soundId, instance, activePlaybackSource);
      throw error;
    }
  }

  private async connectAudioGraphOrRollback(
    soundId: string,
    instance: SoundInstance,
    activePlaybackSource: NonNullable<SoundInstance["playbackSource"]> | null
  ): Promise<void> {
    let graphConnected = false;
    try {
      graphConnected = await this.connectAudioGraph(instance);
    } catch (error) {
      this.rollbackEarlyPlayback(soundId, instance, activePlaybackSource);
      throw error;
    }

    if (!graphConnected) {
      this.rollbackEarlyPlayback(soundId, instance, activePlaybackSource);
      throw new Error(`Audio graph connection failed for ${soundId}`);
    }
  }

  /**
   * Initialize the native audio system. Compatibility and official effect
   * worklets each own their module lifecycle and initialize only when selected.
   */
  private async doInit(): Promise<void> {
    const context = getAudioContext();
    if (!context) {
      throw new Error("Failed to get audio context");
    }

    // Resume the audio context first
    await resumeAudioContext();

    this.output.getMainOutput(context);
    this.output.replaceContext(context).catch(console.error);
    await this.meters.setMasterSource(this.output.getMainOutput(context));
    this.audioSystemInitialized = true;
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
