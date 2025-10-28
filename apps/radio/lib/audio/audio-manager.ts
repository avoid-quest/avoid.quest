"use client";

import { Cacophony, type Playback, type Sound, SoundType } from "cacophony";
import type { FilterConfig } from "@/components/audio/filter-control";
import type { Radio } from "../types";

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
  private readonly filters: Map<string, BiquadFilterNode> = new Map();

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

    // Remove filter
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
}
