import { getProxiedBandcampUrl } from "@avoid.quest/bandcamp";
import { getProxiedSoundCloudUrl } from "@avoid.quest/soundcloud";
import { Cacophony, SoundType } from "./cacophony.js";
import type { Radio } from "./types.js";
import type { BiquadFilterNode } from "./context.js";
import type { Playback } from "./playback.js";
import type { Sound } from "./sound.js";
import type {
  CompressorConfig,
  CrusherConfig,
  DelayConfig,
  DistortionConfig,
  EffectConfig,
  FoldConfig,
  PhaseVocoderConfig,
  PlateReverbConfig,
  RevampConfig,
  StandardReverbConfig,
  StereoToolConfig,
  TidalConfig,
} from "./effects/types.js";
import type { FilterConfig } from "./filter-types.js";
import type { EffectType } from "./protocol.js";
import { getLogger, type Logger } from "./logger.js";

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
  hasEnded: boolean;
};

/**
 * Timeout in milliseconds for waiting for mediaElement "playing" or "error" events.
 * Exported for use in tests.
 */
export const MEDIA_ELEMENT_PLAYBACK_TIMEOUT_MS = 20_000; // 20 seconds

/**
 * Maps EffectConfig type to engine effect type
 */
function mapEffectTypeToEngine(
  type: EffectConfig["type"]
): EffectType {
  switch (type) {
    case "biquadFilter":
      return "biquadFilter";
    case "plateReverb":
      return "reverb";
    case "standardReverb":
      return "standardReverb";
    case "phaseVocoder":
      return "phaseVocoder";
    case "distortion":
      return "distortion";
    case "compressor":
      return "compressor";
    case "delay":
      return "delay";
    case "crusher":
      return "crusher";
    case "fold":
      return "fold";
    case "stereoTool":
      return "stereoTool";
    case "revamp":
      return "revamp";
    case "tidal":
      return "tidal";
    default:
      throw new Error(`Unsupported effect type: ${type}`);
  }
}

/**
 * Converts EffectConfig to engine effect config
 */
function convertEffectConfigToEngine(
  config: EffectConfig
): Record<string, number> {
  const base: Record<string, number> = {};

  switch (config.type) {
    case "biquadFilter": {
      const filterConfig = config as import("./effects/types.js").BiquadFilterConfig;
      // Map filterType string to a number for the worklet
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
      base.filterType = filterTypeMap[filterConfig.filterType] ?? 0;
      base.frequency = filterConfig.frequency;
      base.Q = filterConfig.Q;
      base.gain = filterConfig.gain;
      break;
    }
    case "plateReverb": {
      const reverbConfig = config as PlateReverbConfig;
      base.preDelay = reverbConfig.preDelay;
      base.bandwidth = reverbConfig.bandwidth;
      base.inputDiffusion1 = reverbConfig.inputDiffusion1;
      base.inputDiffusion2 = reverbConfig.inputDiffusion2;
      base.decay = reverbConfig.decay;
      base.decayDiffusion1 = reverbConfig.decayDiffusion1;
      base.decayDiffusion2 = reverbConfig.decayDiffusion2;
      base.damping = reverbConfig.damping;
      base.excursionRate = reverbConfig.excursionRate;
      base.excursionDepth = reverbConfig.excursionDepth;
      base.wet = config.dryWet;
      base.dry = 1 - config.dryWet;
      break;
    }
    case "standardReverb": {
      const reverbConfig = config as StandardReverbConfig;
      base.roomSize = reverbConfig.roomSize;
      base.damp = reverbConfig.decayTime; // Map decayTime to damp
      base.wet = config.dryWet;
      base.dry = 1 - config.dryWet;
      break;
    }
    case "phaseVocoder": {
      const vocoderConfig = config as PhaseVocoderConfig;
      base.pitchFactor = vocoderConfig.pitchFactor;
      break;
    }
    case "distortion": {
      const distortionConfig = config as DistortionConfig;
      base.amount = distortionConfig.amount;
      break;
    }
    case "compressor": {
      const compressorConfig = config as CompressorConfig;
      base.threshold = compressorConfig.threshold;
      base.ratio = compressorConfig.ratio;
      base.attack = compressorConfig.attack;
      base.release = compressorConfig.release;
      base.knee = compressorConfig.knee;
      break;
    }
    case "delay": {
      const delayConfig = config as DelayConfig;
      base.delayTime = delayConfig.delayTime;
      base.feedback = delayConfig.feedback;
      base.wet = config.dryWet;
      base.dry = 1 - config.dryWet;
      break;
    }
    case "crusher": {
      const crusherConfig = config as CrusherConfig;
      base.crush = crusherConfig.crush;
      base.bitDepth = crusherConfig.bitDepth;
      base.boost = crusherConfig.boost;
      base.mix = config.dryWet;
      base.wet = config.dryWet;
      base.dry = 1 - config.dryWet;
      break;
    }
    case "fold": {
      const foldConfig = config as FoldConfig;
      base.amount = foldConfig.amount;
      base.volume = foldConfig.volume;
      base.oversample = foldConfig.oversample;
      base.wet = config.dryWet;
      base.dry = 1 - config.dryWet;
      break;
    }
    case "stereoTool": {
      const stereoToolConfig = config as StereoToolConfig;
      base.volume = stereoToolConfig.volume;
      base.panning = stereoToolConfig.panning;
      base.stereo = stereoToolConfig.stereo;
      base.invertL = stereoToolConfig.invertL ? 1 : 0;
      base.invertR = stereoToolConfig.invertR ? 1 : 0;
      base.swap = stereoToolConfig.swap ? 1 : 0;
      base.wet = config.dryWet;
      base.dry = 1 - config.dryWet;
      break;
    }
    case "revamp": {
      const revampConfig = config as RevampConfig;
      base.highPassEnabled = revampConfig.highPassEnabled ? 1 : 0;
      base.highPassFrequency = revampConfig.highPassFrequency;
      base.highPassQ = revampConfig.highPassQ;
      base.highPassOrder = revampConfig.highPassOrder;
      base.lowShelfEnabled = revampConfig.lowShelfEnabled ? 1 : 0;
      base.lowShelfFrequency = revampConfig.lowShelfFrequency;
      base.lowShelfGain = revampConfig.lowShelfGain;
      base.lowBellEnabled = revampConfig.lowBellEnabled ? 1 : 0;
      base.lowBellFrequency = revampConfig.lowBellFrequency;
      base.lowBellGain = revampConfig.lowBellGain;
      base.lowBellQ = revampConfig.lowBellQ;
      base.midBellEnabled = revampConfig.midBellEnabled ? 1 : 0;
      base.midBellFrequency = revampConfig.midBellFrequency;
      base.midBellGain = revampConfig.midBellGain;
      base.midBellQ = revampConfig.midBellQ;
      base.highBellEnabled = revampConfig.highBellEnabled ? 1 : 0;
      base.highBellFrequency = revampConfig.highBellFrequency;
      base.highBellGain = revampConfig.highBellGain;
      base.highBellQ = revampConfig.highBellQ;
      base.highShelfEnabled = revampConfig.highShelfEnabled ? 1 : 0;
      base.highShelfFrequency = revampConfig.highShelfFrequency;
      base.highShelfGain = revampConfig.highShelfGain;
      base.lowPassEnabled = revampConfig.lowPassEnabled ? 1 : 0;
      base.lowPassFrequency = revampConfig.lowPassFrequency;
      base.lowPassQ = revampConfig.lowPassQ;
      base.lowPassOrder = revampConfig.lowPassOrder;
      base.wet = config.dryWet;
      base.dry = 1 - config.dryWet;
      break;
    }
    case "tidal": {
      const tidalConfig = config as TidalConfig;
      base.rate = tidalConfig.rate;
      base.depth = tidalConfig.depth;
      base.slope = tidalConfig.slope;
      base.symmetry = tidalConfig.symmetry;
      base.offset = tidalConfig.offset;
      base.channelOffset = tidalConfig.channelOffset;
      base.wet = config.dryWet;
      base.dry = 1 - config.dryWet;
      break;
    }
    default:
      throw new Error(`Unsupported effect type: ${config.type}`);
  }

  return base;
}

export class AudioManager {
  private static instance: AudioManager | null = null;
  private readonly cacophony: Cacophony;
  private readonly sounds: Map<string, Sound> = new Map();
  private readonly playbacks: Map<string, Playback> = new Map();
  private readonly listeners: Map<string, Set<(state: AudioState) => void>> =
    new Map();
  // Simple filter system (separate from effect chain)
  private readonly filters: Map<string, BiquadFilterNode> = new Map();
  // Unified effect system
  private logger: Logger;

  private constructor(logger?: Logger) {
    this.cacophony = new Cacophony();
    this.logger = getLogger(logger);
  }

  static getInstance(logger?: Logger): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager(logger);
    }
    return AudioManager.instance;
  }

  /**
   * Set the logger instance for this AudioManager
   */
  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  /**
   * Reset the singleton instance by cleaning up the existing instance
   * and setting it to null. Useful for test teardown.
   * External code can re-create the instance via getInstance().
   */
  static resetInstance(): void {
    if (AudioManager.instance) {
      AudioManager.instance.cleanup();
      AudioManager.instance = null;
    }
  }

  getCacophony(): Cacophony {
    return this.cacophony;
  }

  /**
   * Get the proxied URL for Bandcamp and SoundCloud streams to avoid CORS issues
   */
  private getProxiedUrl(url: string): string {
    // Try Bandcamp first
    const bandcampUrl = getProxiedBandcampUrl(url);
    if (bandcampUrl !== url) {
      return bandcampUrl;
    }

    // Try SoundCloud
    return getProxiedSoundCloudUrl(url);
  }

  async createSound(radio: Radio, soundId?: string): Promise<Sound> {
    const id = soundId || `sound_${radio.id || Date.now()}`;

    // Clean up existing sound if it exists
    if (this.sounds.has(id)) {
      this.cleanupSound(id);
    }

    try {
      // Set loading state before creating sound
      this.notifyListeners(id, {
        isPlaying: false,
        isLoading: true,
        volume: 0,
        error: null,
        hasEnded: false,
      });

      // Get the URL to use (proxied for Bandcamp and SoundCloud to avoid CORS)
      const streamUrl = this.getProxiedUrl(radio.streamUrl);

      // Use engine-based streaming for all radio streams
      // Engine StreamSource handles decoded audio chunks from createStream
      const soundType = SoundType.Streaming;

      // Subscribe to cacophony loading events for this URL
      const loadingStartHandler = (event: {
        url: string;
        timestamp: number;
      }) => {
        if (event.url === streamUrl) {
          this.notifyListeners(id, {
            isPlaying: false,
            isLoading: true,
            volume: 0,
            error: null,
            hasEnded: false,
          });
        }
      };

      const loadingCompleteHandler = (event: {
        url: string;
        timestamp: number;
      }) => {
        if (event.url === streamUrl) {
          // Loading complete - clear loading state
          // If playSound is called, it will set isLoading again
          this.notifyListeners(id, {
            isPlaying: false,
            isLoading: false,
            volume: 0,
            error: null,
            hasEnded: false,
          });
        }
      };

      const loadingErrorHandler = (event: {
        url: string;
        error: Error;
        errorType: string;
        timestamp: number;
      }) => {
        if (event.url === streamUrl) {
          this.notifyListeners(id, {
            isPlaying: false,
            isLoading: false,
            volume: 0,
            error: {
              message: `Failed to load ${radio.name}: ${event.error.message}`,
              code: "LOADING_ERROR",
              radio,
              timestamp: Date.now(),
            },
            hasEnded: false,
          });
        }
      };

      this.cacophony.on("loadingStart", loadingStartHandler);
      this.cacophony.on("loadingComplete", loadingCompleteHandler);
      this.cacophony.on("loadingError", loadingErrorHandler);

      try {
        const sound = await this.cacophony.createSound(
          streamUrl,
          soundType,
          "stereo"
        );

        // Clear loading state after sound is created
        this.notifyListeners(id, {
          isPlaying: false,
          isLoading: false,
          volume: sound.volume,
          error: null,
          hasEnded: false,
        });

        // Set up error handling for this specific sound
        sound.on("soundError", (event: { error: Error }) => {
          const timestamp = Date.now();
          this.logger.error(`Audio error for ${radio.name}`, {
            error: {
              message: event.error.message,
              stack: event.error.stack,
              name: event.error.name,
            },
            radio: {
              id: radio.id,
              name: radio.name,
            },
            sound: {
              id,
            },
            timestamp,
          });
          this.notifyListeners(id, {
            isPlaying: false,
            isLoading: false,
            volume: sound.volume,
            error: {
              message: `Failed to play ${radio.name}: ${event.error.message}`,
              code: "SOUND_ERROR",
              radio,
              timestamp,
            },
            hasEnded: false,
          });
        });

        // Also listen to sound ended event (in addition to playback ended)
        sound.on("ended", () => {
          this.notifyListeners(id, {
            isPlaying: false,
            isLoading: false,
            volume: sound.volume,
            error: null,
            hasEnded: true,
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
          hasEnded: false,
        });

        throw audioError;
      } finally {
        // Always remove loading event listeners, even if createSound throws
        this.cacophony.off("loadingStart", loadingStartHandler);
        this.cacophony.off("loadingComplete", loadingCompleteHandler);
        this.cacophony.off("loadingError", loadingErrorHandler);
      }
    } catch (error) {
      // If already an AudioError from inner catch, just re-throw
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        "timestamp" in error
      ) {
        throw error;
      }

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
        hasEnded: false,
      });

      throw audioError;
    }
  }

  async playSound(soundId: string, volume = 1): Promise<Playback> {
    const sound = this.sounds.get(soundId);
    if (!sound) {
      throw new Error(`Sound with id ${soundId} not found`);
    }

    // Clean up existing playback
    const existingPlayback = this.playbacks.get(soundId);
    if (existingPlayback) {
      existingPlayback.cleanup();
    }

    // Notify that playback is starting with loading state BEFORE calling play()
    // This ensures loading state is set before the play event fires
    this.notifyListeners(soundId, {
      isPlaying: true,
      isLoading: true,
      volume,
      error: null,
      hasEnded: false,
    });

    let playback: Playback;
    try {
      const [playbackResult] = sound.play();
      if (!playbackResult) {
        throw new Error(`Failed to play sound with id ${soundId}`);
      }
      playback = playbackResult;
    } catch (error) {
      this.notifyListeners(soundId, {
        isPlaying: false,
        isLoading: false,
        volume,
        error: {
          message: `Failed to play sound with id ${soundId}: ${error instanceof Error ? error.message : "Unknown error"}`,
          code: "PLAY_ERROR",
          timestamp: Date.now(),
        },
        hasEnded: false,
      });
      throw error;
    }

    playback.volume = volume;
    this.playbacks.set(soundId, playback);

    // Listen for track end events
    const endedHandler = () => {
      this.notifyListeners(soundId, {
        isPlaying: false,
        isLoading: false,
        volume: playback.volume,
        error: null,
        hasEnded: true,
      });
    };
    playback.on("ended", endedHandler);

    // Check if this is a streaming source
    const isStreaming = sound.soundType === SoundType.Streaming;
    
    if (isStreaming) {
      // For streaming sources, wait for streamReady event before clearing loading state
      let loadingStateCleared = false;
      const clearLoadingState = () => {
        if (loadingStateCleared) return; // Prevent multiple clears
        loadingStateCleared = true;
        this.notifyListeners(soundId, {
          isPlaying: true,
          isLoading: false,
          volume: playback.volume,
          error: null,
          hasEnded: false,
        });
      };

      // Listen for streamReady event from engine
      const streamReadyHandler = (payload: { sourceId: string }) => {
        if (payload.sourceId === playback.sourceId) {
          clearLoadingState();
          // Remove listener after first ready event
          this.cacophony.engine.off("streamReady", streamReadyHandler);
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }
      };
      this.cacophony.engine.on("streamReady", streamReadyHandler);

      // Listen for stream errors - clear loading state even on errors
      const streamErrorHandler = (payload: { sourceId: string; error?: string }) => {
        if (payload.sourceId === playback.sourceId && !loadingStateCleared) {
          // Even if there's an error, clear loading state so UI isn't stuck
          clearLoadingState();
        }
      };
      this.cacophony.engine.on("sourceError", streamErrorHandler);

      // Timeout fallback: clear loading after 5 seconds if stream is playing
      // Increased from 2s to handle cases where first chunk takes longer to decode
      // This handles cases where streamReady event might not fire or is delayed
      const timeoutId = setTimeout(() => {
        if (playback.isPlaying && !loadingStateCleared) {
          this.logger.warn("Stream loading state timeout - clearing loading state", {
            soundId,
            sourceId: playback.sourceId,
          });
          clearLoadingState();
          this.cacophony.engine.off("streamReady", streamReadyHandler);
          this.cacophony.engine.off("sourceError", streamErrorHandler);
        }
      }, 5000);

      // Cleanup listeners when playback ends or is stopped
      const cleanup = () => {
        this.cacophony.engine.off("streamReady", streamReadyHandler);
        this.cacophony.engine.off("sourceError", streamErrorHandler);
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };
      playback.on("ended", cleanup);
      playback.on("error", cleanup);
    } else {
      // For non-streaming sources, clear loading state immediately
    // Engine-based playback starts immediately
    this.notifyListeners(soundId, {
      isPlaying: true,
      isLoading: false,
      volume: playback.volume,
      error: null,
      hasEnded: false,
    });
    }

    // Engine-based playback handles routing internally
    // Effects are managed via engine API

    return playback;
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
        hasEnded: false,
      });
    }
  }

  stopSound(soundId: string): void {
    const playback = this.playbacks.get(soundId);
    if (playback) {
      try {
        playback.stop();
      } catch (error) {
        // Playback may have been cleaned up already, just remove it from the map
        if (
          !(
            error instanceof Error &&
            error.message.includes(
              "Cannot stop a sound that has been cleaned up"
            )
          )
        ) {
          throw error;
        }
        // Already cleaned up, just remove from map
      }
      this.playbacks.delete(soundId);
      this.notifyListeners(soundId, {
        isPlaying: false,
        isLoading: false,
        volume: 0,
        error: null,
        hasEnded: false,
      });
    }
  }

  setVolume(soundId: string, volume: number): void {
    const playback = this.playbacks.get(soundId);
    if (playback) {
      playback.volume = Math.max(0, Math.min(1, volume));
      this.notifyListeners(soundId, {
        isPlaying: playback.isPlaying,
        isLoading: false,
        volume: playback.volume,
        error: null,
        hasEnded: false,
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
    // Stop and cleanup playback (stopSound is now defensive and handles already-cleaned playbacks)
    this.stopSound(soundId);

    // Effects are managed by engine, no cleanup needed

    // Remove filter if applied
    this.removeFilter(soundId);

    // Cleanup sound
    const sound = this.sounds.get(soundId);
    if (sound) {
      try {
        sound.cleanup();
      } catch {
        // Sound may have been cleaned up already, continue
      }
      this.sounds.delete(soundId);
    }

    // Cleanup volume tracking
    this.lastSoundVolumes.delete(soundId);

    // Notify listeners
    this.notifyListeners(soundId, {
      isPlaying: false,
      isLoading: false,
      volume: 0,
      error: null,
      hasEnded: false,
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
    this.lastSoundVolumes.clear();
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
  private readonly lastSoundVolumes: Map<string, number> = new Map();

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
      this.lastSoundVolumes.set(soundId, playback.volume);
      playback.volume = 0;
    }
  }

  unmuteSound(soundId: string): void {
    const playback = this.playbacks.get(soundId);
    if (playback) {
      playback.volume = this.lastSoundVolumes.get(soundId) ?? 1;
      this.lastSoundVolumes.delete(soundId);
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
      this.logger.warn("Sound not found for filter application", { soundId });
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
      this.logger.error("Failed to apply filter", {
        soundId,
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          name: error instanceof Error ? error.name : undefined,
        },
        config,
      });
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
      this.logger.error("Failed to update filter", {
        soundId,
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          name: error instanceof Error ? error.name : undefined,
        },
        config,
      });
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
        this.logger.error("Failed to remove filter", {
          soundId,
          error: {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            name: error instanceof Error ? error.name : undefined,
          },
        });
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
   * Add an effect to a sound's effect chain
   */
  addEffect(soundId: string, config: EffectConfig): void {
    const playback = this.playbacks.get(soundId);
    if (!playback) {
      this.logger.warn("Playback not found for effect addition", { soundId });
      return;
    }

    const engine = this.cacophony.engine;
    if (!engine.isReady) {
      this.logger.warn("Engine not ready for effect addition", { soundId });
      return;
    }

    const engineEffectType = mapEffectTypeToEngine(config.type);
    const engineConfig = convertEffectConfigToEngine(config);

    engine.addEffect(
      playback.sourceId,
      config.id,
      engineEffectType,
      engineConfig,
      config.order
    );
  }

  /**
   * Remove an effect from a sound's effect chain
   */
  removeEffect(soundId: string, effectId: string): void {
    const playback = this.playbacks.get(soundId);
    if (!playback) {
      this.logger.warn("Playback not found for effect removal", { soundId });
      return;
    }

    const engine = this.cacophony.engine;
    if (!engine.isReady) {
      this.logger.warn("Engine not ready for effect removal", { soundId });
      return;
    }

    engine.removeEffect(playback.sourceId, effectId);
  }

  /**
   * Update an effect's configuration
   * @returns Promise that resolves to true on success, false on failure
   */
  updateEffect(
    soundId: string,
    effectId: string,
    config: Partial<EffectConfig>
  ): Promise<boolean> {
    const playback = this.playbacks.get(soundId);
    if (!playback) {
      this.logger.warn("Playback not found for effect update", { soundId });
      return Promise.resolve(false);
    }

    const engine = this.cacophony.engine;
    if (!engine.isReady) {
      this.logger.warn("Engine not ready for effect update", { soundId });
      return Promise.resolve(false);
    }

    // Convert partial config to engine config
    const engineConfig: Record<string, number> = {};

    if (config.type === "plateReverb") {
      const reverbConfig = config as Partial<PlateReverbConfig>;
      if (reverbConfig.preDelay !== undefined)
        engineConfig.preDelay = reverbConfig.preDelay;
      if (reverbConfig.bandwidth !== undefined)
        engineConfig.bandwidth = reverbConfig.bandwidth;
      if (reverbConfig.inputDiffusion1 !== undefined)
        engineConfig.inputDiffusion1 = reverbConfig.inputDiffusion1;
      if (reverbConfig.inputDiffusion2 !== undefined)
        engineConfig.inputDiffusion2 = reverbConfig.inputDiffusion2;
      if (reverbConfig.decay !== undefined)
        engineConfig.decay = reverbConfig.decay;
      if (reverbConfig.decayDiffusion1 !== undefined)
        engineConfig.decayDiffusion1 = reverbConfig.decayDiffusion1;
      if (reverbConfig.decayDiffusion2 !== undefined)
        engineConfig.decayDiffusion2 = reverbConfig.decayDiffusion2;
      if (reverbConfig.damping !== undefined)
        engineConfig.damping = reverbConfig.damping;
      if (reverbConfig.excursionRate !== undefined)
        engineConfig.excursionRate = reverbConfig.excursionRate;
      if (reverbConfig.excursionDepth !== undefined)
        engineConfig.excursionDepth = reverbConfig.excursionDepth;
      if (config.dryWet !== undefined) {
        engineConfig.wet = config.dryWet;
        engineConfig.dry = 1 - config.dryWet;
      }
    } else if (config.type === "phaseVocoder") {
      const vocoderConfig = config as Partial<PhaseVocoderConfig>;
      if (vocoderConfig.pitchFactor !== undefined)
        engineConfig.pitchFactor = vocoderConfig.pitchFactor;
    } else if (config.type === "distortion") {
      const distortionConfig = config as Partial<DistortionConfig>;
      if (distortionConfig.amount !== undefined)
        engineConfig.amount = distortionConfig.amount;
    } else if (config.type === "compressor") {
      const compressorConfig = config as Partial<CompressorConfig>;
      if (compressorConfig.threshold !== undefined)
        engineConfig.threshold = compressorConfig.threshold;
      if (compressorConfig.ratio !== undefined)
        engineConfig.ratio = compressorConfig.ratio;
      if (compressorConfig.attack !== undefined)
        engineConfig.attack = compressorConfig.attack;
      if (compressorConfig.release !== undefined)
        engineConfig.release = compressorConfig.release;
      if (compressorConfig.knee !== undefined)
        engineConfig.knee = compressorConfig.knee;
    } else if (config.type === "delay") {
      const delayConfig = config as Partial<DelayConfig>;
      if (delayConfig.delayTime !== undefined)
        engineConfig.delayTime = delayConfig.delayTime;
      if (delayConfig.feedback !== undefined)
        engineConfig.feedback = delayConfig.feedback;
      if (config.dryWet !== undefined) {
        engineConfig.wet = config.dryWet;
        engineConfig.dry = 1 - config.dryWet;
      }
    } else if (config.type === "crusher") {
      const crusherConfig = config as Partial<CrusherConfig>;
      if (crusherConfig.crush !== undefined)
        engineConfig.crush = crusherConfig.crush;
      if (crusherConfig.bitDepth !== undefined)
        engineConfig.bitDepth = crusherConfig.bitDepth;
      if (crusherConfig.boost !== undefined)
        engineConfig.boost = crusherConfig.boost;
      if (config.dryWet !== undefined) {
        engineConfig.mix = config.dryWet;
        engineConfig.wet = config.dryWet;
        engineConfig.dry = 1 - config.dryWet;
      }
    } else if (config.type === "fold") {
      const foldConfig = config as Partial<FoldConfig>;
      if (foldConfig.amount !== undefined)
        engineConfig.amount = foldConfig.amount;
      if (foldConfig.volume !== undefined)
        engineConfig.volume = foldConfig.volume;
      if (foldConfig.oversample !== undefined)
        engineConfig.oversample = foldConfig.oversample;
      if (config.dryWet !== undefined) {
        engineConfig.wet = config.dryWet;
        engineConfig.dry = 1 - config.dryWet;
      }
    } else if (config.type === "stereoTool") {
      const stereoToolConfig = config as Partial<StereoToolConfig>;
      if (stereoToolConfig.volume !== undefined)
        engineConfig.volume = stereoToolConfig.volume;
      if (stereoToolConfig.panning !== undefined)
        engineConfig.panning = stereoToolConfig.panning;
      if (stereoToolConfig.stereo !== undefined)
        engineConfig.stereo = stereoToolConfig.stereo;
      if (stereoToolConfig.invertL !== undefined)
        engineConfig.invertL = stereoToolConfig.invertL ? 1 : 0;
      if (stereoToolConfig.invertR !== undefined)
        engineConfig.invertR = stereoToolConfig.invertR ? 1 : 0;
      if (stereoToolConfig.swap !== undefined)
        engineConfig.swap = stereoToolConfig.swap ? 1 : 0;
      if (config.dryWet !== undefined) {
        engineConfig.wet = config.dryWet;
        engineConfig.dry = 1 - config.dryWet;
      }
    } else if (config.type === "revamp") {
      const revampConfig = config as Partial<RevampConfig>;
      if (revampConfig.highPassEnabled !== undefined)
        engineConfig.highPassEnabled = revampConfig.highPassEnabled ? 1 : 0;
      if (revampConfig.highPassFrequency !== undefined)
        engineConfig.highPassFrequency = revampConfig.highPassFrequency;
      if (revampConfig.highPassQ !== undefined)
        engineConfig.highPassQ = revampConfig.highPassQ;
      if (revampConfig.highPassOrder !== undefined)
        engineConfig.highPassOrder = revampConfig.highPassOrder;
      if (revampConfig.lowShelfEnabled !== undefined)
        engineConfig.lowShelfEnabled = revampConfig.lowShelfEnabled ? 1 : 0;
      if (revampConfig.lowShelfFrequency !== undefined)
        engineConfig.lowShelfFrequency = revampConfig.lowShelfFrequency;
      if (revampConfig.lowShelfGain !== undefined)
        engineConfig.lowShelfGain = revampConfig.lowShelfGain;
      if (revampConfig.lowBellEnabled !== undefined)
        engineConfig.lowBellEnabled = revampConfig.lowBellEnabled ? 1 : 0;
      if (revampConfig.lowBellFrequency !== undefined)
        engineConfig.lowBellFrequency = revampConfig.lowBellFrequency;
      if (revampConfig.lowBellGain !== undefined)
        engineConfig.lowBellGain = revampConfig.lowBellGain;
      if (revampConfig.lowBellQ !== undefined)
        engineConfig.lowBellQ = revampConfig.lowBellQ;
      if (revampConfig.midBellEnabled !== undefined)
        engineConfig.midBellEnabled = revampConfig.midBellEnabled ? 1 : 0;
      if (revampConfig.midBellFrequency !== undefined)
        engineConfig.midBellFrequency = revampConfig.midBellFrequency;
      if (revampConfig.midBellGain !== undefined)
        engineConfig.midBellGain = revampConfig.midBellGain;
      if (revampConfig.midBellQ !== undefined)
        engineConfig.midBellQ = revampConfig.midBellQ;
      if (revampConfig.highBellEnabled !== undefined)
        engineConfig.highBellEnabled = revampConfig.highBellEnabled ? 1 : 0;
      if (revampConfig.highBellFrequency !== undefined)
        engineConfig.highBellFrequency = revampConfig.highBellFrequency;
      if (revampConfig.highBellGain !== undefined)
        engineConfig.highBellGain = revampConfig.highBellGain;
      if (revampConfig.highBellQ !== undefined)
        engineConfig.highBellQ = revampConfig.highBellQ;
      if (revampConfig.highShelfEnabled !== undefined)
        engineConfig.highShelfEnabled = revampConfig.highShelfEnabled ? 1 : 0;
      if (revampConfig.highShelfFrequency !== undefined)
        engineConfig.highShelfFrequency = revampConfig.highShelfFrequency;
      if (revampConfig.highShelfGain !== undefined)
        engineConfig.highShelfGain = revampConfig.highShelfGain;
      if (revampConfig.lowPassEnabled !== undefined)
        engineConfig.lowPassEnabled = revampConfig.lowPassEnabled ? 1 : 0;
      if (revampConfig.lowPassFrequency !== undefined)
        engineConfig.lowPassFrequency = revampConfig.lowPassFrequency;
      if (revampConfig.lowPassQ !== undefined)
        engineConfig.lowPassQ = revampConfig.lowPassQ;
      if (revampConfig.lowPassOrder !== undefined)
        engineConfig.lowPassOrder = revampConfig.lowPassOrder;
      if (config.dryWet !== undefined) {
        engineConfig.wet = config.dryWet;
        engineConfig.dry = 1 - config.dryWet;
      }
    } else if (config.type === "tidal") {
      const tidalConfig = config as Partial<TidalConfig>;
      if (tidalConfig.rate !== undefined)
        engineConfig.rate = tidalConfig.rate;
      if (tidalConfig.depth !== undefined)
        engineConfig.depth = tidalConfig.depth;
      if (tidalConfig.slope !== undefined)
        engineConfig.slope = tidalConfig.slope;
      if (tidalConfig.symmetry !== undefined)
        engineConfig.symmetry = tidalConfig.symmetry;
      if (tidalConfig.offset !== undefined)
        engineConfig.offset = tidalConfig.offset;
      if (tidalConfig.channelOffset !== undefined)
        engineConfig.channelOffset = tidalConfig.channelOffset;
      if (config.dryWet !== undefined) {
        engineConfig.wet = config.dryWet;
        engineConfig.dry = 1 - config.dryWet;
      }
    }

    engine.updateEffect(playback.sourceId, effectId, engineConfig);
    return Promise.resolve(true);
  }

  /**
   * Reorder effects in a sound's effect chain
   */
  reorderEffects(soundId: string, effectIds: string[]): void {
    const playback = this.playbacks.get(soundId);
    if (!playback) {
      this.logger.warn("Playback not found for effect reordering", { soundId });
      return;
    }

    const engine = this.cacophony.engine;
    if (!engine.isReady) {
      this.logger.warn("Engine not ready for effect reordering", { soundId });
      return;
    }

    engine.reorderEffects(playback.sourceId, effectIds);
  }

  /**
   * Get all effects for a sound
   * Note: Engine doesn't currently expose effect list, so this returns empty array
   * TODO: Add getEffects API to engine if needed
   */
  getEffects(soundId: string): EffectConfig[] {
    // Engine doesn't expose effect list yet
    // This would require adding a GET_EFFECTS message type and handler
    return [];
  }
}
