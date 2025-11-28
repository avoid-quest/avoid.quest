import {
  type AudioNode,
  Cacophony,
  type Playback,
  type Sound,
  SoundType,
} from "@avoid.quest/cacophony";
import type { FilterConfig } from "@/components/audio/filter-control";
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
  hasEnded: boolean;
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
  // Unified effect system
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

  /**
   * Get the proxied URL for Bandcamp and SoundCloud streams to avoid CORS issues
   */
  private getProxiedUrl(url: string): string {
    // Check if this is a Bandcamp URL (bcbits.com domain)
    if (url.includes("bcbits.com")) {
      // Use the proxy endpoint to avoid CORS issues
      const proxyUrl = `/api/bandcamp-proxy?url=${encodeURIComponent(url)}`;
      return proxyUrl;
    }

    // Check if this is a SoundCloud stream URL (not already proxied)
    // SoundCloud stream URLs typically come from CDN domains like cf-media.sndcdn.com
    // or media.soundcloud.com, but we should only proxy if it's not already a proxy URL
    if (
      !url.startsWith("/api/") &&
      (url.includes("sndcdn.com") ||
        url.includes("media.soundcloud.com") ||
        url.includes("soundcloud.com"))
    ) {
      // Use the proxy endpoint to avoid CORS issues
      const proxyUrl = `/api/soundcloud-proxy?url=${encodeURIComponent(url)}`;
      return proxyUrl;
    }

    return url;
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

      // Use HTML type for Bandcamp and SoundCloud to avoid CORS issues (works like simple player)
      // Streaming type requires crossOrigin which these platforms don't support
      const soundType =
        radio.platformMetadata?.platform === "bandcamp" ||
        radio.platformMetadata?.platform === "soundcloud"
          ? SoundType.HTML
          : SoundType.Streaming;

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
            hasEnded: false,
          });
        });

        // Also listen to sound ended event (in addition to playback ended)
        sound.on("ended", () => {
          console.log(`Sound ended for ${radio.name} (soundId: ${id})`);
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

    // For HTML audio elements, we need to wait for the play promise to resolve
    // The play() method returns synchronously, but actual playback start is async
    // We'll wait for the "playing" event on the mediaElement if available
    const clearLoadingState = () => {
      this.notifyListeners(soundId, {
        isPlaying: true,
        isLoading: false,
        volume: playback.volume,
        error: null,
        hasEnded: false,
      });
    };

    // Check if this is an HTML audio element source
    if (
      playback.source &&
      "mediaElement" in playback.source &&
      playback.source.mediaElement
    ) {
      const mediaElement = playback.source.mediaElement;

      // Wait for the "playing" event which fires when playback actually starts
      // This is more reliable than the "play" event which fires synchronously
      await new Promise<void>((resolve, reject) => {
        const playingHandler = () => {
          clearLoadingState();
          mediaElement.removeEventListener("playing", playingHandler);
          mediaElement.removeEventListener("error", errorHandler);
          resolve();
        };

        // Also handle errors
        const errorHandler = () => {
          this.notifyListeners(soundId, {
            isPlaying: false,
            isLoading: false,
            volume: playback.volume,
            error: {
              message: "Failed to start playback",
              code: "PLAYBACK_ERROR",
              timestamp: Date.now(),
            },
            hasEnded: false,
          });
          mediaElement.removeEventListener("playing", playingHandler);
          mediaElement.removeEventListener("error", errorHandler);
          reject(new Error("Failed to start playback"));
        };

        mediaElement.addEventListener("playing", playingHandler);
        mediaElement.addEventListener("error", errorHandler);

        // If already playing, clear loading immediately
        if (!mediaElement.paused && mediaElement.readyState >= 2) {
          clearLoadingState();
          mediaElement.removeEventListener("playing", playingHandler);
          mediaElement.removeEventListener("error", errorHandler);
          resolve();
        }
      });
    } else {
      // For buffer sources, playback starts immediately
      clearLoadingState();
    }

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
      playback.stop();
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
