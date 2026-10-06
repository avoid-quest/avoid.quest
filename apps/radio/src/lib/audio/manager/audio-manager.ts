import { captureError } from "@avoid.quest/error";
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
 * A sound with an output connector (Node mode's lane gain) reaches the main
 * delay through it instead of directly.
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
  getAudioContextManager,
  initialAudioState,
  type PlaybackSource,
  type Radio,
  resumeAudioContext,
  toPlaybackInput,
  type Unsubscribe,
} from "../playback/index.js";
import { inferStreamFormat } from "../playback/stream-format.js";
import {
  cleanupSoundNodes,
  connectAudioGraph,
  updateDeviceChannelSelection,
} from "./audio-manager-graph.js";
import {
  createDeviceSourceCallbacks,
  createPlaybackSourceCallbacks,
} from "./audio-manager-source-callbacks.js";
import { notifySoundError, notifySoundState } from "./audio-manager-state.js";
import {
  type FilterConfig as AudioManagerFilterConfig,
  createAudioNodes,
  type SoundInstance,
  type SoundOutputConnector,
  type SoundOutputMode,
} from "./audio-manager-types.js";
import {
  type AudioPerformanceDiagnostics,
  createAudioPerformanceDiagnostics,
} from "./audio-performance.js";
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

export type {
  FilterConfig,
  MainOutputConnect,
  SoundOutputConnector,
} from "./audio-manager-types.js";

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
  private readonly outputConnectors = new Map<string, SoundOutputConnector>();
  private readonly deviceStarts = new Map<string, symbol>();
  private readonly playbackRequests = new Map<
    string,
    { cancelled: boolean; pending: boolean }
  >();
  readonly volume: VolumeController;
  private readonly effects: EffectsController;
  private readonly output: OutputRouting;
  readonly meters: MeterService;
  private audioSystemInitialized = false as boolean;
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
      notifyListeners: this.notifyListeners,
      sounds: this.soundRegistry.asMap(),
      workletProcessorUrl: () => workletProcessorUrl,
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

  getPerformanceDiagnostics(): AudioPerformanceDiagnostics {
    const meter = this.meters.getDiagnostics();
    const backends = [...this.sounds.keys()].map(
      (soundId) => this.effects.getRuntimeOutcome(soundId).backend
    );
    return createAudioPerformanceDiagnostics({
      backends,
      context: getAudioContextManager().getPerformanceSnapshot(),
      effects: this.effects.getPerformanceSnapshot(),
      inputs: [...this.sounds.entries()].flatMap(([soundId, sound]) => {
        const diagnostics = sound.deviceSource?.getDiagnostics();
        return diagnostics ? [{ diagnostics, soundId }] : [];
      }),
      meter,
      soundCount: this.sounds.size,
    });
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
      error: null,
      hasEnded: false,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
    });

    return id;
  }

  /**
   * Play a sound
   */
  async playSound(soundId: string, volume = 1): Promise<void> {
    const instance = this.sounds.get(soundId);
    // Device input: unmute by restoring gain (stream stays alive)
    if (instance?.isDeviceInput && instance.deviceSource?.isActive) {
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
        error: null,
        isPlaying: true,
        volume,
      });
      return;
    }
    return await this.playRemoteSound(soundId, volume);
  }

  private async playRemoteSound(
    soundId: string,
    volume: number,
    seekPosition?: number
  ): Promise<void> {
    const instance = this.sounds.get(soundId);
    if (!instance) {
      throw new Error(`Sound with id ${soundId} not found`);
    }

    // An unfinished start still owns loading and graph setup. A new Play
    // replaces it rather than treating its source as ready to resume.
    const activePlaybackSource =
      !this.playbackRequests.get(soundId)?.pending &&
      instance.playbackSource?.isActive
        ? instance.playbackSource
        : null;
    const request = { cancelled: false, pending: true };
    this.playbackRequests.set(soundId, request);
    const isCurrent = () =>
      this.sounds.get(soundId) === instance &&
      this.playbackRequests.get(soundId) === request &&
      !request.cancelled;
    try {
      const useGraph = instance.outputMode !== "native";
      const context = useGraph ? getAudioContext() : null;
      if (useGraph && !context) {
        throw new Error("Audio context not available");
      }
      const setupPromise = context
        ? this.handleDeferredRejection(this.ensurePlaybackSetup(context))
        : null;

      // Update instance state
      instance.volume = volume;
      instance.playing = true;
      instance.loading = true;

      // Notify loading state
      notifySoundState(this.notifyListeners, soundId, instance, {
        error: null,
        isLoading: true,
        isPlaying: true,
        volume,
      });

      // Create audio nodes if not exists
      instance.nodes ??= context
        ? createAudioNodes(context, volume * this.volume.getGlobalVolume())
        : null;

      if (!activePlaybackSource) {
        instance.playbackSource?.cleanup();
      }
      const source =
        activePlaybackSource ??
        this.createManagedPlaybackSource(context, soundId, instance);
      instance.playbackSource = source;

      // Set the graph gain or native media volume before connecting or playing.
      this.volume.set(soundId, volume);

      if (activePlaybackSource) {
        const playPromise = this.startPlayback(activePlaybackSource);
        await setupPromise;
        if (!isCurrent()) {
          return;
        }
        if (context) {
          this.effects.resumeSource(soundId);
        }
        await playPromise;
        return;
      }

      // Connect the graph shell before requesting play in this same task,
      // preserving mobile transient user activation.
      const loadPromise = this.handleDeferredRejection(
        source.load(toPlaybackInput(instance.radio))
      );
      const graphPromise = context
        ? this.ensureAudioGraphConnected(soundId, instance)
        : null;
      const playPromise = this.startLoadedPlayback(
        source,
        loadPromise,
        seekPosition,
        isCurrent
      );
      await Promise.all([setupPromise, loadPromise, graphPromise, playPromise]);
    } catch (error) {
      if (isCurrent()) {
        this.rollbackEarlyPlayback(soundId, instance, activePlaybackSource);
      }
      throw error;
    } finally {
      request.pending = false;
    }
  }

  /**
   * Play a device input source (mic/line-in) through the full audio graph
   */
  async playDeviceSound(
    soundId: string,
    deviceId: string,
    constraints?: DeviceAudioConstraints,
    channelSelection?: ChannelSelection
  ): Promise<void> {
    const instance = this.sounds.get(soundId);
    if (!instance) {
      throw new Error(`Sound with id ${soundId} not found`);
    }

    const request = Symbol("device start");
    this.deviceStarts.set(soundId, request);
    const isCurrent = () =>
      this.sounds.get(soundId) === instance &&
      this.deviceStarts.get(soundId) === request;
    instance.deviceSource?.cleanup();
    instance.deviceSource = null;

    await this.init();
    if (!isCurrent()) {
      return;
    }
    await resumeAudioContext();
    if (!isCurrent()) {
      return;
    }

    const context = getAudioContext();
    if (!context) {
      throw new Error("Audio context not available");
    }

    instance.isDeviceInput = true;
    instance.loading = true;

    notifySoundState(this.notifyListeners, soundId, instance, {
      error: null,
      isLoading: true,
      isPlaying: false,
    });

    // Create audio nodes
    if (!instance.nodes) {
      instance.nodes = createAudioNodes(
        context,
        instance.volume * this.volume.getGlobalVolume()
      );
    }

    // Create device source
    const deviceSource = createDeviceSource(
      context,
      soundId,
      createDeviceSourceCallbacks({
        instance,
        notifyListeners: this.notifyListeners,
        soundId,
      })
    );
    instance.deviceSource = deviceSource;

    if (channelSelection) {
      deviceSource.setChannelSelection(channelSelection);
    }

    // Start capture (onActive callback fires when stream is ready)
    await deviceSource.start(deviceId, constraints);
    if (!(isCurrent() && deviceSource.isActive)) {
      return;
    }

    // Connect through the full audio graph (after start so output node exists)
    const graphConnected = await this.connectAudioGraph(instance);
    if (!isCurrent()) {
      return;
    }
    if (!graphConnected) {
      // A capture with no path to the mixer would read as live in silence.
      deviceSource.stop();
      throw new Error(
        "The audio input could not connect to the mixer. Try going live again."
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
    if (!instance) {
      return;
    }
    updateDeviceChannelSelection({
      instance,
      reconnectGraph: (sound) => this.connectAudioGraph(sound),
      selection,
    });
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
   *   Device:  Source → Filter → Effects → Pan → PreFaderSend → Gain → Destination
   *   Playback: Source → Pan → Filter → Effects → PreFaderSend → Gain → Destination
   *
   * The CUE tap is now AFTER effects, so headphone monitoring includes effects
   * but is still independent of the channel fader volume.
   *
   * @returns true if graph was connected successfully, false otherwise
   */
  private async connectAudioGraph(instance: SoundInstance): Promise<boolean> {
    const graphSource = instance.playbackSource ?? instance.deviceSource;
    const graphNodes = instance.nodes;
    // Pause retains the active source and graph; Stop ends the source.
    const isCurrent = () =>
      this.sounds.get(instance.sourceId) === instance &&
      (instance.playbackSource ?? instance.deviceSource) === graphSource &&
      instance.nodes === graphNodes &&
      graphSource?.isActive === true;
    const connected = await connectAudioGraph({
      connectEffectsGraph: (soundId, source, destination, inputChannels) =>
        this.effects.connectGraph(soundId, source, destination, inputChannels),
      connectMainOutput: (source, realtime) =>
        this.connectMainOutput(instance.sourceId, source, realtime),
      instance,
      isCurrent,
      notifyListeners: this.notifyListeners,
    });
    if (connected && isCurrent() && instance.nodes) {
      await this.meters.setSoundSource(instance.sourceId, instance.nodes.gain);
    }
    return connected;
  }

  /**
   * Route a sound's fader output through `connect` instead of straight to
   * the main bus, or back to the main bus with `null`. Node mode puts a lane
   * gain there. It is read the next time the sound's graph connects, so
   * register it before the sound plays; Single and DJ never register one.
   */
  setSoundOutputConnector(
    soundId: string,
    connect: SoundOutputConnector | null
  ): void {
    if (connect) {
      this.outputConnectors.set(soundId, connect);
    } else {
      this.outputConnectors.delete(soundId);
    }
  }

  private connectMainOutput(
    soundId: string,
    source: AudioNode,
    realtime: boolean
  ): () => void {
    const connectMain = (node: AudioNode, isRealtime: boolean) =>
      this.output.connectMain(node, isRealtime);
    const connect = this.outputConnectors.get(soundId);
    return connect
      ? connect(source, realtime, connectMain)
      : connectMain(source, realtime);
  }

  /**
   * Pause a sound
   */
  pauseSound(soundId: string): void {
    const request = this.playbackRequests.get(soundId);
    if (request) {
      request.cancelled = true;
    }
    const instance = this.sounds.get(soundId);
    if (!instance) {
      return;
    }

    instance.playing = false;
    instance.buffering = false;
    // A pause while connecting abandons the connect; only playback start or an
    // error would otherwise clear the flag.
    instance.loading = false;

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
      error: null,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
    });
  }

  /**
   * Stop a sound
   */
  stopSound(soundId: string): void {
    this.deviceStarts.delete(soundId);
    const request = this.playbackRequests.get(soundId);
    if (request) {
      request.cancelled = true;
    }
    const instance = this.sounds.get(soundId);
    if (!instance) {
      return;
    }

    instance.playing = false;
    instance.loading = false;
    instance.buffering = false;
    instance.playbackSource?.stop();
    instance.deviceSource?.stop();
    this.effects.stopSource(soundId);

    notifySoundState(this.notifyListeners, soundId, instance, {
      error: null,
      isPlaying: false,
      volume: 0,
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
    this.playbackRequests.delete(soundId);
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
   * Pitch follows the rate unless key lock (`setKeyLock`) is on.
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

  /**
   * Key lock for a sound: on, a speed change keeps the pitch; off, pitch
   * follows speed like tape. A no-op for live device input.
   */
  setKeyLock(soundId: string, keyLock: boolean): void {
    const instance = this.sounds.get(soundId);
    if (!instance?.playbackSource || instance.isDeviceInput) {
      return;
    }
    instance.playbackSource.setPreservesPitch(keyLock);
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
    const { filter } = instance.nodes;

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

  /** The backend a sound's effects last settled on, e.g. a dry fallback. */
  getEffectsRuntimeOutcome(soundId: string): EffectsRuntimeOutcome {
    return this.effects.getRuntimeOutcome(soundId);
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
      frequency: 20_000,
      gain: 0,
      Q: 1,
      type: "lowpass",
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
      duration: instance.playbackSource.duration,
      position: instance.playbackSource.currentTime,
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
    if (!instance) {
      throw new Error(`Cannot refresh sound ${soundId}: sound not found`);
    }

    const refreshedRadio = {
      ...instance.radio,
      streamFormat: streamFormat ?? inferStreamFormat(newUrl),
      streamUrl: newUrl,
    };
    // Keep the configuration aligned with the source being loaded, including
    // when Pause cancels resumption while that load finishes.
    instance.radio = refreshedRadio;
    // A failed first start disposes its source. The renewed URL needs the
    // normal source creation and graph setup before it can play again.
    if (!instance.playbackSource) {
      await this.playRemoteSound(soundId, instance.volume, seekPosition);
      return;
    }

    const source = instance.playbackSource;
    const request = { cancelled: false, pending: true };
    this.playbackRequests.set(soundId, request);
    const isCurrent = () =>
      this.sounds.get(soundId) === instance &&
      instance.playbackSource === source &&
      this.playbackRequests.get(soundId) === request &&
      !request.cancelled;

    // Update loading state
    instance.loading = true;
    notifySoundState(this.notifyListeners, soundId, instance, {
      error: null,
      isLoading: true,
      isPlaying: false,
    });

    try {
      // A pause while the new URL loads keeps the sound paused.
      const playing = await source.refreshUrl(
        toPlaybackInput(refreshedRadio),
        seekPosition
      );

      if (!isCurrent()) {
        return;
      }

      instance.loading = false;
      instance.playing = playing;

      notifySoundState(this.notifyListeners, soundId, instance, {
        error: null,
        isLoading: false,
        isPlaying: playing,
      });
    } catch (error) {
      if (!isCurrent()) {
        throw error;
      }
      instance.loading = false;
      instance.playing = false;

      notifySoundError(
        this.notifyListeners,
        soundId,
        instance,
        "STREAM_FETCH_FAILED",
        error instanceof Error ? error.message : "Failed to refresh stream",
        { cause: error, duringStart: true }
      );
      throw error;
    } finally {
      request.pending = false;
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
    this.playbackRequests.clear();
    this.listeners.clear();
    this.outputConnectors.clear();
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

  private createManagedPlaybackSource(
    context: AudioContext | null,
    soundId: string,
    instance: SoundInstance
  ): PlaybackSource {
    const source = createPlaybackSource(
      context,
      soundId,
      createPlaybackSourceCallbacks({
        instance,
        isCurrent: () =>
          this.sounds.get(soundId) === instance &&
          instance.playbackSource === source &&
          !this.playbackRequests.get(soundId)?.cancelled,
        isStarting: () => this.playbackRequests.get(soundId)?.pending === true,
        notifyListeners: this.notifyListeners,
        soundId,
      })
    );
    return source;
  }

  private startLoadedPlayback(
    source: PlaybackSource,
    loading: Promise<void>,
    seekPosition: number | undefined,
    isCurrent: () => boolean
  ): Promise<void> {
    if (seekPosition === undefined || seekPosition <= 0) {
      return this.startPlayback(source);
    }
    // Recovery already has an unlocked audio context. Apply its position on
    // this source before requesting playback, never through a later ID lookup.
    return this.handleDeferredRejection(
      loading.then(() => {
        if (!isCurrent()) {
          return;
        }
        source.seek(seekPosition);
        return source.play();
      })
    );
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

    if (activePlaybackSource && activePlaybackSource.status !== "error") {
      activePlaybackSource.pause();
    } else {
      instance.playbackSource?.cleanup();
      instance.playbackSource = null;
    }

    instance.playing = false;
    instance.loading = false;
    instance.buffering = false;
    notifySoundState(this.notifyListeners, soundId, instance, {
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
    });
  }

  private async ensurePlaybackSetup(context: AudioContext): Promise<void> {
    const resumePromise = resumeAudioContext();
    this.output.getMainMeterSource(context);
    this.output.replaceContext(context).catch((error) => {
      captureError(error, {
        operation: "replaceAudioOutputContext",
        surface: "ui",
      });
    });
    await resumePromise;
    await this.init();
  }

  private async ensureAudioGraphConnected(
    soundId: string,
    instance: SoundInstance
  ): Promise<void> {
    const graphConnected = await this.connectAudioGraph(instance);
    if (!graphConnected) {
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

    this.output.getMainMeterSource(context);
    this.output.replaceContext(context).catch((error) => {
      captureError(error, {
        operation: "replaceAudioOutputContext",
        surface: "ui",
      });
    });
    await this.meters.setMasterSource(this.output.getMainMeterSource(context));
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
