/**
 * HTML5 Audio Player
 *
 * Simple wrapper around HTML5 Audio element for radio streaming.
 * Used in non-DJ modes for straightforward playback.
 */

import { capturePlaybackError } from "@avoid.quest/error";
import type { Radio } from "../playback/types.js";
import {
  buildProxyUrl,
  createLoadModeCache,
  getInitialLoadMode,
  getProxyRetryMode,
  getRetryLoadMode,
  type Html5LoadMode,
  mapPlaybackFailureMessage,
  shouldRetryWithoutCors,
} from "./load-mode.js";
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
  #audio: HTMLAudioElement;
  readonly #telemetryMode: "single" | "multiple";
  readonly #listeners = new Set<HTML5AudioStateCallback>();
  readonly #loadModeCache = createLoadModeCache();

  #state: HTML5AudioState = { ...initialHTML5AudioState };
  #activeLoadMode: Html5LoadMode = "cors-anonymous";
  #isResettingSource = false;
  #isPlayInProgress = false;

  constructor(
    id: string,
    radio: Radio,
    options?: { telemetryMode?: "single" | "multiple" }
  ) {
    this.#id = id;
    this.#radio = radio;
    this.#telemetryMode = options?.telemetryMode ?? "multiple";
    this.#audio = new Audio();
    this.#audio.preload = "none";
    this.#applyLoadMode(this.#activeLoadMode);

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
  load(mode?: Html5LoadMode): void {
    const effectiveMode =
      mode ??
      getInitialLoadMode(this.#loadModeCache.get(this.#radio.streamUrl));
    this.#activeLoadMode = effectiveMode;

    this.#isResettingSource = true;
    this.#audio.pause();
    this.#audio.removeAttribute("src");
    this.#audio.load();
    this.#applyLoadMode(effectiveMode);
    const src =
      effectiveMode === "proxied"
        ? buildProxyUrl(this.#radio.streamUrl)
        : this.#radio.streamUrl;
    this.#audio.src = src;
    this.#audio.load();
    this.#isResettingSource = false;
    this.#updateState({ isLoading: true, error: null, hasEnded: false });
  }

  /**
   * Start playback
   */
  async play(volume = 1): Promise<void> {
    this.#audio.volume = Math.max(0, Math.min(1, volume));
    this.#isPlayInProgress = true;

    const cachedMode = this.#loadModeCache.get(this.#radio.streamUrl);
    const initialMode = getInitialLoadMode(cachedMode);

    if (!this.#audio.src || this.#activeLoadMode !== initialMode) {
      this.load(initialMode);
    }

    this.#updateState({ isLoading: true });

    try {
      await this.#audio.play();
      this.#loadModeCache.set(this.#radio.streamUrl, this.#activeLoadMode);
      this.#updateState({ isPlaying: true, isLoading: false });
    } catch (error) {
      const mediaErrorCode = this.#audio.error?.code;
      const canRetry = this.#shouldAttemptNoCorsFallback(error, mediaErrorCode);
      const retryMode = getRetryLoadMode(initialMode, canRetry);

      if (retryMode) {
        try {
          this.#replaceAudioElement();
          this.load(retryMode);
          await this.#audio.play();
          this.#loadModeCache.set(this.#radio.streamUrl, retryMode);
          this.#updateState({ isPlaying: true, isLoading: false, error: null });
          return;
        } catch (noCorsError) {
          if (await this.#tryProxyFallback(retryMode)) {
            return;
          }

          const retryMediaErrorCode = this.#audio.error?.code;
          this.#setPlayFailureState(
            noCorsError,
            retryMediaErrorCode,
            "fallback-no-cors"
          );
          throw noCorsError;
        }
      }

      if (await this.#tryProxyFallback(initialMode)) {
        return;
      }

      this.#setPlayFailureState(error, mediaErrorCode, "initial");
      throw error;
    } finally {
      this.#isPlayInProgress = false;
    }
  }

  async #tryProxyFallback(currentMode: Html5LoadMode): Promise<boolean> {
    const proxyMode = getProxyRetryMode(currentMode);
    if (!proxyMode) {
      return false;
    }

    try {
      this.#replaceAudioElement();
      this.load(proxyMode);
      await this.#audio.play();
      this.#loadModeCache.set(this.#radio.streamUrl, proxyMode);
      this.#updateState({ isPlaying: true, isLoading: false, error: null });
      return true;
    } catch (proxyError) {
      const proxyMediaErrorCode = this.#audio.error?.code;
      this.#setPlayFailureState(
        proxyError,
        proxyMediaErrorCode,
        "fallback-proxy"
      );
      throw proxyError;
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
    this.#isResettingSource = true;
    this.#audio.pause();
    this.#audio.removeAttribute("src");
    this.#audio.load();
    this.#isResettingSource = false;
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
      const currentSrc = this.#audio.currentSrc || this.#audio.src || "";
      if (
        shouldIgnorePlaybackMediaError({
          mediaErrorCode: mediaError?.code,
          currentSrc,
          isResettingSource: this.#isResettingSource,
        })
      ) {
        return;
      }

      const mediaErrorObject = errorFromMedia(mediaError);

      // Let play() handle retries (no-cors / proxy) before surfacing terminal errors.
      if (this.#isPlayInProgress) {
        return;
      }

      // Legacy guard for errors outside play() flow.
      if (
        this.#shouldAttemptNoCorsFallback(mediaErrorObject, mediaError?.code)
      ) {
        return;
      }

      const errorMessage = mapPlaybackFailureMessage(
        mediaErrorObject,
        mediaError?.code
      );
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

      capturePlaybackError(new Error(errorMessage), {
        mode: this.#telemetryMode,
        radioId: this.#radio.id,
        radioName: this.#radio.name,
        streamUrl: this.#radio.streamUrl,
        errorCode,
        errorMessage,
        retryPhase: "none",
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

  #applyLoadMode(mode: Html5LoadMode): void {
    if (mode === "cors-anonymous" || mode === "proxied") {
      this.#audio.crossOrigin = "anonymous";
      this.#audio.setAttribute("crossorigin", "anonymous");
    } else {
      this.#audio.crossOrigin = null;
      this.#audio.removeAttribute("crossorigin");
    }
    this.#activeLoadMode = mode;
  }

  #replaceAudioElement(): void {
    const oldVolume = this.#audio.volume;
    this.#isResettingSource = true;
    this.#audio.pause();
    this.#audio.removeAttribute("src");
    this.#audio.load();
    this.#isResettingSource = false;

    const newAudio = new Audio();
    newAudio.preload = "none";
    newAudio.volume = oldVolume;
    this.#audio = newAudio;
    this.#setupEventListeners();
  }

  #shouldAttemptNoCorsFallback(
    error: unknown,
    mediaErrorCode: number | null | undefined
  ): boolean {
    if (this.#activeLoadMode !== "cors-anonymous") {
      return false;
    }

    if (error instanceof DOMException && error.name === "NotAllowedError") {
      return false;
    }

    // Some browsers classify CORS-blocked media as MEDIA_ERR_NETWORK (2).
    if (mediaErrorCode === 2 || mediaErrorCode === 4) {
      return true;
    }

    return shouldRetryWithoutCors(error, mediaErrorCode);
  }

  #setPlayFailureState(
    error: unknown,
    mediaErrorCode: number | null | undefined,
    retryPhase: "initial" | "fallback-no-cors" | "fallback-proxy"
  ): void {
    const message = mapPlaybackFailureMessage(error, mediaErrorCode);
    let code: string;
    if (retryPhase === "fallback-proxy") {
      code = "PLAYBACK_PROXY_FALLBACK_FAILED";
    } else if (retryPhase === "fallback-no-cors") {
      code = "PLAYBACK_FALLBACK_FAILED";
    } else if (mediaErrorCode) {
      code = `MEDIA_ERROR_${mediaErrorCode}`;
    } else {
      code = "PLAYBACK_FAILED";
    }

    const audioError: HTML5AudioError = {
      message,
      code,
      radio: this.#radio,
      timestamp: Date.now(),
    };

    this.#updateState({
      isPlaying: false,
      isLoading: false,
      error: audioError,
    });

    capturePlaybackError(error, {
      mode: this.#telemetryMode,
      radioId: this.#radio.id,
      radioName: this.#radio.name,
      streamUrl: this.#radio.streamUrl,
      errorCode: code,
      errorMessage: message,
      retryPhase,
    });
  }
}

function errorFromMedia(mediaError: MediaError | null): Error {
  switch (mediaError?.code) {
    case MEDIA_ERR_ABORTED:
      return new Error("MEDIA_ERR_ABORTED");
    case 2:
      return new Error("MEDIA_ERR_NETWORK");
    case 3:
      return new Error("MEDIA_ERR_DECODE");
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
      return new Error("MEDIA_ERR_SRC_NOT_SUPPORTED");
    default:
      return new Error("MEDIA_ERROR_UNKNOWN");
  }
}

type IgnorePlaybackMediaErrorInput = {
  mediaErrorCode: number | null | undefined;
  currentSrc: string;
  isResettingSource: boolean;
};

const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export function shouldIgnorePlaybackMediaError(
  input: IgnorePlaybackMediaErrorInput
): boolean {
  if (input.isResettingSource) {
    return true;
  }

  if (!input.currentSrc.trim()) {
    return true;
  }

  if (input.mediaErrorCode === MEDIA_ERR_ABORTED) {
    return true;
  }

  return false;
}
