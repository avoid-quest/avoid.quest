/**
 * HTML5 Audio Player
 *
 * Simple wrapper around HTML5 Audio element for radio streaming.
 * Used in non-DJ modes for straightforward playback.
 */

import type { Radio } from "../playback/types.js";
import {
  type HTML5AudioError,
  type HTML5AudioState,
  type HTML5AudioStateCallback,
  initialHTML5AudioState,
} from "./types.js";

/**
 * HTML5 Audio Player
 *
 * Wraps a single HTML5 Audio element with state management and callbacks.
 */
export class HTML5AudioPlayer {
  readonly #id: string;
  readonly #radio: Radio;
  readonly #audio: HTMLAudioElement;
  readonly #listeners = new Set<HTML5AudioStateCallback>();

  #state: HTML5AudioState = { ...initialHTML5AudioState };

  constructor(id: string, radio: Radio) {
    this.#id = id;
    this.#radio = radio;
    this.#audio = new Audio();
    this.#audio.preload = "none";
    this.#audio.crossOrigin = "anonymous";

    this.#setupEventListeners();
  }

  get id(): string {
    return this.#id;
  }

  get radio(): Radio {
    return this.#radio;
  }

  get element(): HTMLAudioElement {
    return this.#audio;
  }

  get state(): HTML5AudioState {
    return { ...this.#state };
  }

  get isPlaying(): boolean {
    return this.#state.isPlaying;
  }

  get volume(): number {
    return this.#audio.volume;
  }

  /**
   * Load the audio source
   */
  load(): void {
    this.#audio.src = this.#radio.streamUrl;
    this.#audio.load();
    this.#updateState({ isLoading: true });
  }

  /**
   * Start playback
   */
  async play(volume = 1): Promise<void> {
    this.#audio.volume = Math.max(0, Math.min(1, volume));

    // Load if not already loaded
    if (!this.#audio.src) {
      this.load();
    }

    this.#updateState({ isLoading: true });

    try {
      await this.#audio.play();
      this.#updateState({ isPlaying: true, isLoading: false });
    } catch (error) {
      const audioError: HTML5AudioError = {
        message: error instanceof Error ? error.message : "Playback failed",
        code: "PLAYBACK_FAILED",
        radio: this.#radio,
        timestamp: Date.now(),
      };
      this.#updateState({
        isPlaying: false,
        isLoading: false,
        error: audioError,
      });
      throw error;
    }
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.#audio.pause();
    this.#updateState({ isPlaying: false });
  }

  /**
   * Stop playback and reset
   */
  stop(): void {
    this.#audio.pause();
    this.#audio.currentTime = 0;
    this.#updateState({ isPlaying: false, currentTime: 0 });
  }

  /**
   * Set volume (0-1)
   */
  setVolume(volume: number): void {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    this.#audio.volume = clampedVolume;
    this.#updateState({ volume: clampedVolume });
  }

  /**
   * Subscribe to state changes
   */
  subscribe(callback: HTML5AudioStateCallback): () => void {
    this.#listeners.add(callback);
    // Immediately send current state
    callback(this.#state);

    return () => {
      this.#listeners.delete(callback);
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.#audio.pause();
    this.#audio.src = "";
    this.#audio.load();
    this.#listeners.clear();
  }

  /**
   * Set up event listeners for the audio element
   */
  #setupEventListeners(): void {
    this.#audio.addEventListener("playing", () => {
      this.#updateState({ isPlaying: true, isLoading: false });
    });

    this.#audio.addEventListener("pause", () => {
      this.#updateState({ isPlaying: false });
    });

    this.#audio.addEventListener("ended", () => {
      this.#updateState({ isPlaying: false, hasEnded: true });
    });

    this.#audio.addEventListener("waiting", () => {
      this.#updateState({ isLoading: true });
    });

    this.#audio.addEventListener("canplay", () => {
      this.#updateState({ isLoading: false });
    });

    this.#audio.addEventListener("timeupdate", () => {
      this.#updateState({
        currentTime: this.#audio.currentTime,
        duration: this.#audio.duration || 0,
      });
    });

    this.#audio.addEventListener("volumechange", () => {
      this.#updateState({ volume: this.#audio.volume });
    });

    this.#audio.addEventListener("error", () => {
      const mediaError = this.#audio.error;
      const errorMessage = mediaError?.message || "Unknown audio error";
      const errorCode = `MEDIA_ERROR_${mediaError?.code || 0}`;

      const error: HTML5AudioError = {
        message: errorMessage,
        code: errorCode,
        radio: this.#radio,
        timestamp: Date.now(),
      };

      this.#updateState({
        isPlaying: false,
        isLoading: false,
        error,
      });
    });
  }

  /**
   * Update state and notify listeners
   */
  #updateState(partial: Partial<HTML5AudioState>): void {
    this.#state = { ...this.#state, ...partial };
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
