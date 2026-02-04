/**
 * Audio Manager
 *
 * Simplified high-level API for audio playback with effects.
 * Uses HTML5 Audio with native Web Audio nodes for hardware acceleration.
 *
 * Audio routing (post-effects CUE):
 *   Html5AudioSource → Pan → Filter → WorkletNode (effects) → PreFaderSend (CUE tap) → Gain (fader) → Analyser → MainDelayNode → Destination
 *
 * The CUE tap point is now AFTER effects processing, so headphone monitoring
 * includes the effects but is still independent of the channel fader.
 * Main delay is applied after all sound processing, before final output.
 */

import { getProxiedBandcampUrl } from "@avoid.quest/bandcamp";
import { getProxiedSoundCloudUrl } from "@avoid.quest/soundcloud";
import type { EffectConfig } from "../dsp/effects/types.js";
import {
  type AudioState,
  type AudioStateCallback,
  type ChannelSelection,
  createDeviceSource,
  type DeviceAudioConstraints,
  type DeviceSource,
  type FilterType,
  generateErrorId,
  getAudioContext,
  Html5AudioSource,
  initialAudioState,
  type Radio,
  resumeAudioContext,
  type Unsubscribe,
  WorkletManager,
} from "../playback/index.js";
import { safeDisconnect } from "../utils.js";

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
 * Native audio nodes for a sound instance
 */
type AudioNodes = {
  preFaderSend: GainNode; // Tap point for CUE (post-effects, pre-fader monitoring)
  gain: GainNode; // Channel fader
  pan: StereoPannerNode;
  filter: BiquadFilterNode;
  analyser: AnalyserNode;
};

/**
 * Sound instance tracking
 */
type SoundInstance = {
  radio: Radio;
  sourceId: string;
  html5Source: Html5AudioSource | null;
  deviceSource: DeviceSource | null;
  isDeviceInput: boolean;
  nodes: AudioNodes | null;
  volume: number;
  pan: number;
  playing: boolean;
  loading: boolean;
  buffering: boolean;
  filterEnabled: boolean;
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
/** Maximum main delay in milliseconds */
const MAX_MAIN_DELAY_MS = 500;

/** Maximum main delay in seconds (for Web Audio API) */
const MAX_MAIN_DELAY_SECONDS = MAX_MAIN_DELAY_MS / 1000;

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
  private masterMeterFrame = 0;

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
    const instance: SoundInstance = {
      radio,
      sourceId: id,
      html5Source: null,
      deviceSource: null,
      isDeviceInput: false,
      nodes: null,
      volume: 1,
      pan: 0,
      playing: false,
      loading: false,
      buffering: false,
      filterEnabled: false,
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
      this.notifyListeners(soundId, {
        isPlaying: true,
        isLoading: false,
        isBuffering: false,
        volume,
        error: null,
        hasEnded: false,
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
    this.notifyListeners(soundId, {
      isPlaying: true,
      isLoading: true,
      isBuffering: false,
      volume,
      error: null,
      hasEnded: false,
    });

    // Create audio nodes if not exists
    if (!instance.nodes) {
      instance.nodes = this.createAudioNodes(context);
    }

    // Create HTML5 source if not exists or if previous ended/errored
    if (instance.html5Source?.isActive) {
      // Resuming existing source - tell worklet to resume
      const wm = this.workletManagers.get(soundId);
      wm?.resumeSource(soundId);
    } else {
      // Clean up old source
      instance.html5Source?.cleanup();

      // Create new HTML5 audio source
      instance.html5Source = new Html5AudioSource(context, soundId, {
        onPlaying: () => {
          instance.loading = false;
          instance.buffering = false;
          this.notifyListeners(soundId, {
            isPlaying: true,
            isLoading: false,
            isBuffering: false,
            volume: instance.volume,
            error: null,
            hasEnded: false,
          });
        },
        onBuffering: (isBuffering) => {
          instance.buffering = isBuffering;
          this.notifyListeners(soundId, {
            isPlaying: instance.playing,
            isLoading: false,
            isBuffering,
            volume: instance.volume,
            error: null,
            hasEnded: false,
          });
        },
        onError: (error) => {
          instance.playing = false;
          instance.loading = false;
          this.notifyListeners(soundId, {
            isPlaying: false,
            isLoading: false,
            isBuffering: false,
            volume: instance.volume,
            error: {
              id: generateErrorId(),
              message: error.message,
              code: "STREAM_FETCH_FAILED",
              radio: instance.radio,
              timestamp: Date.now(),
              sourceId: soundId,
            },
            hasEnded: false,
          });
        },
        onEnded: () => {
          instance.playing = false;
          this.notifyListeners(soundId, {
            isPlaying: false,
            isLoading: false,
            isBuffering: false,
            volume: instance.volume,
            error: null,
            hasEnded: true,
          });
        },
      });

      // Get proxied URL for Bandcamp/SoundCloud
      const streamUrl = this.getProxiedUrl(instance.radio.streamUrl);

      // Load and connect
      await instance.html5Source.load(streamUrl);
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
    await instance.html5Source.play();
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

    this.notifyListeners(soundId, {
      isPlaying: false,
      isLoading: true,
      isBuffering: false,
      volume: instance.volume,
      error: null,
      hasEnded: false,
    });

    // Create audio nodes
    if (!instance.nodes) {
      instance.nodes = this.createAudioNodes(context);
    }

    // Create device source
    instance.deviceSource = createDeviceSource(context, soundId, {
      onActive: () => {
        instance.loading = false;
        instance.playing = true;
        this.notifyListeners(soundId, {
          isPlaying: true,
          isLoading: false,
          isBuffering: false,
          volume: instance.volume,
          error: null,
          hasEnded: false,
        });
      },
      onInactive: () => {
        instance.playing = false;
        this.notifyListeners(soundId, {
          isPlaying: false,
          isLoading: false,
          isBuffering: false,
          volume: instance.volume,
          error: null,
          hasEnded: false,
        });
      },
      onError: (error) => {
        instance.playing = false;
        instance.loading = false;
        this.notifyListeners(soundId, {
          isPlaying: false,
          isLoading: false,
          isBuffering: false,
          volume: instance.volume,
          error: {
            id: generateErrorId(),
            message: error.message,
            code: "PLAYBACK_FAILED",
            radio: instance.radio,
            timestamp: Date.now(),
            sourceId: soundId,
          },
          hasEnded: false,
        });
      },
    });

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
   * Create native audio nodes for a sound
   */
  private createAudioNodes(context: AudioContext): AudioNodes {
    // Pre-fader send for CUE monitoring (post-effects, unity gain, always passing audio)
    // This is the tap point between worklet output and channel fader
    const preFaderSend = context.createGain();
    preFaderSend.gain.value = 1;

    const gain = context.createGain();
    const pan = context.createStereoPanner();
    const filter = context.createBiquadFilter();
    const analyser = context.createAnalyser();

    // Set default filter to bypass (highpass at 0Hz = no filtering)
    filter.type = "highpass";
    filter.frequency.value = 0;

    // Configure analyser for visualization
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;

    return { preFaderSend, gain, pan, filter, analyser };
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
  private async connectAudioGraph(instance: SoundInstance): Promise<boolean> {
    const sourceOutput =
      instance.html5Source?.output ?? instance.deviceSource?.output;
    if (!(sourceOutput && instance.nodes)) {
      console.warn(
        `[AudioManager] Cannot connect graph: missing source or nodes for ${instance.sourceId}`
      );
      return false;
    }

    const context = getAudioContext();
    if (!context) {
      console.warn(
        "[AudioManager] Cannot connect graph: no AudioContext available"
      );
      return false;
    }

    const { preFaderSend, gain, pan, filter, analyser } = instance.nodes;

    // Disconnect any existing connections (may already be disconnected)
    safeDisconnect(sourceOutput, "AudioManager.connectAudioGraph");
    safeDisconnect(preFaderSend, "AudioManager.connectAudioGraph");
    safeDisconnect(gain, "AudioManager.connectAudioGraph");
    safeDisconnect(pan, "AudioManager.connectAudioGraph");
    safeDisconnect(filter, "AudioManager.connectAudioGraph");
    safeDisconnect(analyser, "AudioManager.connectAudioGraph");

    // Get or create per-sound worklet manager
    const wm = await this.getOrCreateWorkletManager(instance.sourceId);

    // Create worklet source for this sound (for effects processing)
    wm.createStreamSource(instance.sourceId);
    wm.startSource(instance.sourceId);

    // Connect the graph (post-effects CUE routing)
    // Source → Pan → Filter → Worklet (effects)
    sourceOutput.connect(pan);
    pan.connect(filter);

    // Determine final destination (main delay node if available, else direct)
    const finalDestination = this.mainDelayNode ?? context.destination;

    if (wm.node && wm.outputNode) {
      // Filter → Worklet input
      filter.connect(wm.node);

      // Worklet output → PreFaderSend (CUE tap, now post-effects)
      wm.outputNode.connect(preFaderSend);

      // PreFaderSend → Gain (channel fader)
      preFaderSend.connect(gain);

      // Gain → Analyser → MainDelay → Destination
      gain.connect(analyser);
      analyser.connect(finalDestination);
    } else {
      // Fallback: direct routing without worklet - effects bypassed
      console.warn(
        `[AudioManager] Worklet unavailable for ${instance.sourceId}, effects bypassed`
      );
      this.notifyListeners(instance.sourceId, {
        ...initialAudioState,
        error: {
          id: generateErrorId(),
          message: "Audio effects unavailable - worklet failed to initialize",
          code: "WORKLET_UNAVAILABLE",
          radio: instance.radio,
          timestamp: Date.now(),
          sourceId: instance.sourceId,
        },
      });

      // Filter → PreFaderSend → Gain → Analyser → MainDelay → Destination
      filter.connect(preFaderSend);
      preFaderSend.connect(gain);
      gain.connect(analyser);
      analyser.connect(finalDestination);
    }

    return true;
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
      instance.html5Source?.pause();
      this.workletManagers.get(soundId)?.pauseSource(soundId);
    }

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
    instance.html5Source?.stop();
    instance.deviceSource?.stop();
    this.workletManagers.get(soundId)?.stopSource(soundId);

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

    const instance = this.sounds.get(soundId);
    if (instance) {
      // Clean up sources
      instance.html5Source?.cleanup();
      instance.html5Source = null;
      instance.deviceSource?.cleanup();
      instance.deviceSource = null;

      // Disconnect nodes (may already be disconnected)
      if (instance.nodes) {
        safeDisconnect(instance.nodes.gain, "AudioManager.cleanupSound");
        safeDisconnect(instance.nodes.pan, "AudioManager.cleanupSound");
        safeDisconnect(instance.nodes.filter, "AudioManager.cleanupSound");
        safeDisconnect(instance.nodes.analyser, "AudioManager.cleanupSound");
        instance.nodes = null;
      }
    }

    // Cleanup per-sound worklet manager
    const wm = this.workletManagers.get(soundId);
    if (wm) {
      wm.cleanup();
      this.workletManagers.delete(soundId);
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
   * Note: This changes both speed and pitch (HTML5 playbackRate behavior)
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

    if (!instance.html5Source) {
      return;
    }

    const clampedRate = Math.max(0.5, Math.min(2.0, rate));
    instance.html5Source.setPlaybackRate(clampedRate);
  }

  seekSound(soundId: string, position: number): void {
    const instance = this.sounds.get(soundId);
    if (!instance) {
      return;
    }

    if (instance.isDeviceInput) {
      return;
    }

    if (!instance.html5Source) {
      return;
    }

    instance.html5Source.seek(position);
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
      filter.type = "lowpass";
      // Map -1 to 0 → 200Hz to 20000Hz
      const freq = 200 + (1 + clampedValue) * 19_800;
      filter.frequency.setTargetAtTime(freq, now, 0.05);
      filter.Q.setTargetAtTime(1.0, now, 0.05);
    } else {
      // Positive: Highpass sweep (higher value = higher cutoff)
      filter.type = "highpass";
      // Map 0 to 1 → 20Hz to 5000Hz
      const freq = 20 + clampedValue * 4980;
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

    const engineConfig = this.convertEffectConfig(config);

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

    const engineConfig = this.convertPartialEffectConfig(config);
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
  updateFilter(soundId: string, config: FilterConfig): void {
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
    if (!instance?.html5Source) {
      return null;
    }

    return {
      position: instance.html5Source.currentTime,
      duration: instance.html5Source.duration,
    };
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
    const bufferL = new Float32Array(2048);
    const bufferR = new Float32Array(2048);

    const tick = () => {
      this.masterMeterRafId = requestAnimationFrame(tick);

      // Throttle to ~30fps by skipping every other frame
      this.masterMeterFrame++;
      if (this.masterMeterFrame % 2 !== 0) {
        return;
      }

      if (!(this.masterAnalyserL && this.masterAnalyserR)) {
        return;
      }

      this.masterAnalyserL.getFloatTimeDomainData(bufferL);
      this.masterAnalyserR.getFloatTimeDomainData(bufferR);

      let sumL = 0;
      let sumR = 0;
      for (let i = 0; i < bufferL.length; i++) {
        sumL += bufferL[i] * bufferL[i];
        sumR += bufferR[i] * bufferR[i];
      }

      const left = Math.sqrt(sumL / bufferL.length);
      const right = Math.sqrt(sumR / bufferR.length);

      const level = { left, right };
      for (const cb of this.masterMeterListeners) {
        cb(level);
      }
    };

    this.masterMeterRafId = requestAnimationFrame(tick);
  }

  /**
   * Stop the master meter rAF loop
   */
  private stopMasterMeterLoop(): void {
    if (this.masterMeterRafId !== null) {
      cancelAnimationFrame(this.masterMeterRafId);
      this.masterMeterRafId = null;
    }
    this.masterMeterFrame = 0;
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

    // Create main delay node for output delay control
    this.mainDelayNode = context.createDelay(MAX_MAIN_DELAY_SECONDS);
    this.mainDelayNode.delayTime.value = 0;
    this.mainDelayNode.connect(context.destination);

    // Create master meter tap (parallel to main path, does not interrupt audio)
    this.masterSplitter = context.createChannelSplitter(2);
    this.mainDelayNode.connect(this.masterSplitter);

    this.masterAnalyserL = context.createAnalyser();
    this.masterAnalyserL.fftSize = 2048;
    this.masterAnalyserR = context.createAnalyser();
    this.masterAnalyserR.fftSize = 2048;

    this.masterSplitter.connect(this.masterAnalyserL, 0);
    this.masterSplitter.connect(this.masterAnalyserR, 1);

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

    // Set up event handlers for this worklet manager
    wm.on("sourceEnded", ({ sourceId }) => {
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

    wm.on(
      "sourceError",
      ({ id, sourceId, error, code, effectId, timestamp }) => {
        const instance = this.sounds.get(sourceId);
        if (instance) {
          this.notifyListeners(sourceId, {
            isPlaying: false,
            isLoading: false,
            isBuffering: false,
            volume: instance.volume,
            error: {
              id,
              message: effectId ? `[${effectId}] ${error}` : error,
              code:
                code === "EFFECT_PROCESS_FAILED"
                  ? "EFFECT_PROCESS_FAILED"
                  : "PLAYBACK_FAILED",
              radio: instance.radio,
              timestamp,
              sourceId,
            },
            hasEnded: false,
          });
        }
      }
    );

    wm.on("peakMeter", ({ peakL, peakR }) => {
      const callbacks = this.meterListeners.get(soundId);
      if (callbacks) {
        for (const callback of callbacks) {
          callback({ left: peakL, right: peakR });
        }
      }
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
   * Convert effect config to worklet format
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: simple switch over effect types
  private convertEffectConfig(config: EffectConfig): Record<string, number> {
    // Universal params for all effects
    const base: Record<string, number> = {
      enabled: config.enabled ? 1 : 0,
      inputGain: config.inputGain ?? 1.0,
      outputGain: config.outputGain ?? 1.0,
    };

    // Common dry/wet handling
    if (config.dryWet !== undefined) {
      base.wet = config.dryWet;
      base.dry = 1 - config.dryWet;
    }

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
