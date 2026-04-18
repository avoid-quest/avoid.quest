import Hls from "hls.js";

import type { PlaybackSource } from "./playback-source.js";
import {
  type PlaybackSourceCallbacks,
  STREAM_PROXY_ROUTE,
} from "./playback-source-shared.js";
import type { StreamStatus } from "./types.js";

function isHlsUrl(url: string): boolean {
  try {
    return new URL(
      url,
      typeof window !== "undefined"
        ? window.location.origin
        : "https://example.invalid"
    ).pathname.endsWith(".m3u8");
  } catch {
    return url.includes(".m3u8");
  }
}

function shouldProxyMediaUrl(url: string): boolean {
  if (url.startsWith("/") || url.startsWith(STREAM_PROXY_ROUTE)) {
    return false;
  }

  try {
    const parsed = new URL(
      url,
      typeof window !== "undefined"
        ? window.location.origin
        : "https://example.invalid"
    );

    if (
      typeof window !== "undefined" &&
      parsed.origin === window.location.origin
    ) {
      return false;
    }

    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveMediaUrl(url: string): string {
  if (!shouldProxyMediaUrl(url)) {
    return url;
  }

  return STREAM_PROXY_ROUTE + encodeURIComponent(url);
}

function getMediaPlaybackCandidates(url: string): string[] {
  const candidates = [url];
  const proxiedUrl = resolveMediaUrl(url);

  if (proxiedUrl !== url) {
    candidates.push(proxiedUrl);
  }

  return candidates;
}

function createMediaError(element: HTMLMediaElement): Error {
  const code = element.error?.code;
  let message = "Audio playback failed";

  if (code === MediaError.MEDIA_ERR_ABORTED) {
    message = "Audio playback was aborted";
  } else if (code === MediaError.MEDIA_ERR_NETWORK) {
    message = "Audio stream failed to load";
  } else if (code === MediaError.MEDIA_ERR_DECODE) {
    message = "Audio stream could not be decoded";
  } else if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    message = "Audio stream format is not supported";
  }

  return new Error(message);
}

export class MediaElementPlaybackSource implements PlaybackSource {
  private readonly callbacks: PlaybackSourceCallbacks;
  private readonly sourceId: string;
  private readonly audio: HTMLAudioElement;
  private readonly mediaSourceNode: MediaElementAudioSourceNode;
  private readonly outputNode: GainNode;

  private hls: Hls | null = null;
  private _status: StreamStatus = "idle";
  private _isBuffering = false;
  private generation = 0;
  private playbackRate = 1;
  private shouldResumeAfterLoad = false;
  private currentLoadPromise: Promise<void> | null = null;
  private isLoadingPhase = false;
  private suppressPauseCallback = false;

  constructor(
    context: AudioContext,
    sourceId: string,
    callbacks: PlaybackSourceCallbacks = {}
  ) {
    this.callbacks = callbacks;
    this.sourceId = sourceId;
    this.audio = new Audio();
    this.audio.crossOrigin = "anonymous";
    this.audio.preload = "auto";
    this.audio.autoplay = false;
    this.audio.setAttribute("playsinline", "");

    this.mediaSourceNode = context.createMediaElementSource(this.audio);
    this.outputNode = context.createGain();
    this.outputNode.gain.value = 1;
    this.mediaSourceNode.connect(this.outputNode);

    this.audio.addEventListener("playing", this.handlePlaying);
    this.audio.addEventListener("waiting", this.handleWaiting);
    this.audio.addEventListener("stalled", this.handleWaiting);
    this.audio.addEventListener("pause", this.handlePause);
    this.audio.addEventListener("ended", this.handleEnded);
    this.audio.addEventListener("error", this.handleMediaError);
  }

  get currentTime(): number {
    return Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
  }

  get duration(): number {
    return Number.isFinite(this.audio.duration)
      ? this.audio.duration
      : Number.POSITIVE_INFINITY;
  }

  get id(): string {
    return this.sourceId;
  }

  get isActive(): boolean {
    return (
      this._status === "connecting" ||
      this._status === "buffering" ||
      this._status === "streaming"
    );
  }

  get isBuffering(): boolean {
    return this._isBuffering;
  }

  get output(): AudioNode {
    return this.outputNode;
  }

  get status(): StreamStatus {
    return this._status;
  }

  get volume(): number {
    return this.outputNode.gain.value;
  }

  set volume(value: number) {
    this.outputNode.gain.value = Math.max(0, Math.min(1, value));
  }

  async load(url: string): Promise<void> {
    const generation = ++this.generation;
    this.shouldResumeAfterLoad = false;
    this.resetMediaElement({ resetProgress: true });

    this._status = "connecting";
    this.setBuffering(false);
    const loadPromise = this.loadWithFallbackCandidates(url, generation);
    this.currentLoadPromise = loadPromise;
    this.isLoadingPhase = true;

    try {
      await loadPromise;
    } catch (error) {
      const loadError =
        error instanceof Error ? error : new Error("Audio playback failed");
      this._status = "error";
      this.callbacks.onError?.(loadError);
      throw loadError;
    } finally {
      if (this.currentLoadPromise === loadPromise) {
        this.currentLoadPromise = null;
      }
      this.isLoadingPhase = false;
    }
  }

  async play(): Promise<void> {
    if (this.currentLoadPromise) {
      await this.currentLoadPromise;
    }

    if (this._status === "idle" || this._status === "ended") {
      throw new Error("Source not loaded - call load() first");
    }

    this.shouldResumeAfterLoad = true;
    await this.audio.play();
  }

  pause(): void {
    this.shouldResumeAfterLoad = false;
    this._status = "buffering";
    this.suppressPauseCallback = true;
    this.audio.pause();
    queueMicrotask(() => {
      this.suppressPauseCallback = false;
    });
    this.callbacks.onPaused?.();
  }

  stop(): void {
    this.shouldResumeAfterLoad = false;
    this.resetMediaElement({ resetProgress: true });
    this._status = "ended";
    this.setBuffering(false);
    this.callbacks.onEnded?.();
  }

  cleanup(): void {
    this.resetMediaElement({ resetProgress: true });
    this.audio.removeEventListener("playing", this.handlePlaying);
    this.audio.removeEventListener("waiting", this.handleWaiting);
    this.audio.removeEventListener("stalled", this.handleWaiting);
    this.audio.removeEventListener("pause", this.handlePause);
    this.audio.removeEventListener("ended", this.handleEnded);
    this.audio.removeEventListener("error", this.handleMediaError);
    this.audio.removeAttribute("src");
    this.audio.load();
    try {
      this.mediaSourceNode.disconnect();
    } catch {
      // Ignore disconnect errors during teardown.
    }
    try {
      this.outputNode.disconnect();
    } catch {
      // Ignore disconnect errors during teardown.
    }
    this._status = "idle";
    this.setBuffering(false);
    this.currentLoadPromise = null;
  }

  setPlaybackRate(rate: number): void {
    const clampedRate = Math.max(0.5, Math.min(2, rate));
    this.playbackRate = clampedRate;
    this.audio.playbackRate = clampedRate;
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  seek(position: number): void {
    if (!Number.isFinite(this.audio.duration)) {
      return;
    }

    try {
      this.audio.currentTime = Math.max(0, position);
    } catch {
      // Ignore seek failures for streams or not-yet-seekable media.
    }
  }

  async refreshUrl(newUrl: string, seekPosition?: number): Promise<void> {
    const shouldResume = this.shouldResumeAfterLoad || !this.audio.paused;
    await this.load(newUrl);

    if (
      seekPosition !== undefined &&
      seekPosition > 0 &&
      Number.isFinite(this.audio.duration)
    ) {
      this.seek(seekPosition);
    }

    if (shouldResume) {
      await this.play();
    }
  }

  private async loadWithFallbackCandidates(
    url: string,
    generation: number
  ): Promise<void> {
    const candidates = getMediaPlaybackCandidates(url);
    const treatAsHls = isHlsUrl(url);
    let lastError: Error | DOMException | null = null;

    for (const candidate of candidates) {
      try {
        await this.waitForReadyState(candidate, generation, treatAsHls);
        return;
      } catch (error) {
        lastError =
          error instanceof Error || error instanceof DOMException
            ? error
            : new Error("Audio playback failed");

        if (generation !== this.generation) {
          throw lastError;
        }

        this.resetMediaElement({ resetProgress: true });
      }
    }

    throw lastError ?? new Error("Audio playback failed");
  }

  private async waitForReadyState(
    url: string,
    generation: number,
    treatAsHls: boolean
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        this.audio.removeEventListener("canplay", handleReady);
        this.audio.removeEventListener("loadedmetadata", handleReady);
        this.audio.removeEventListener("error", handleError);
        this.audio.removeEventListener("abort", handleAbort);
      };

      const finish = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        fn();
      };

      const handleReady = () => {
        if (generation !== this.generation) {
          finish(() => {
            reject(new Error("Stale media playback generation"));
          });
          return;
        }

        finish(() => {
          this._status = "buffering";
          this.setBuffering(false);
          this.callbacks.onReady?.();
          resolve();
        });
      };

      const handleError = () => {
        finish(() => {
          reject(createMediaError(this.audio));
        });
      };

      const handleAbort = () => {
        finish(() => {
          reject(new DOMException("Load aborted", "AbortError"));
        });
      };

      this.audio.addEventListener("canplay", handleReady, { once: true });
      this.audio.addEventListener("loadedmetadata", handleReady, {
        once: true,
      });
      this.audio.addEventListener("error", handleError, { once: true });
      this.audio.addEventListener("abort", handleAbort, { once: true });

      try {
        this.loadIntoMediaElement(url, treatAsHls, (error) => {
          finish(() => {
            reject(error);
          });
        });
      } catch (error) {
        finish(() => {
          reject(
            error instanceof Error ? error : new Error("Audio playback failed")
          );
        });
        return;
      }

      if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        handleReady();
      }
    });
  }

  private loadIntoMediaElement(
    url: string,
    treatAsHls: boolean,
    onFatalError: (error: Error) => void
  ): void {
    this.destroyHls();

    if (!treatAsHls) {
      this.audio.src = url;
      this.audio.load();
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        debug: false,
        startLevel: -1,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
          return;
        }

        const error = new Error(`HLS error: ${data.type} - ${data.details}`);
        if (this.isLoadingPhase) {
          onFatalError(error);
          return;
        }

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            this.callbacks.onStreamError?.(this.audio.currentTime);
            this._status = "error";
            this.callbacks.onError?.(error);
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            this._status = "error";
            this.callbacks.onError?.(error);
            break;
        }
      });

      hls.attachMedia(this.audio);
      hls.loadSource(url);
      this.hls = hls;
      return;
    }

    if (this.audio.canPlayType("application/vnd.apple.mpegurl")) {
      this.audio.src = url;
      this.audio.load();
      return;
    }

    throw new Error("HLS is not supported in this browser");
  }

  private resetMediaElement(options: { resetProgress: boolean }): void {
    this.suppressPauseCallback = true;
    this.audio.pause();
    this.destroyHls();
    this.audio.removeAttribute("src");
    if (options.resetProgress && Number.isFinite(this.audio.duration)) {
      try {
        this.audio.currentTime = 0;
      } catch {
        // Ignore streams and unseekable media.
      }
    }

    this.audio.load();

    queueMicrotask(() => {
      this.suppressPauseCallback = false;
    });
  }

  private destroyHls(): void {
    this.hls?.destroy();
    this.hls = null;
  }

  private readonly handlePlaying = (): void => {
    this._status = "streaming";
    this.setBuffering(false);
    this.callbacks.onPlaying?.();
  };

  private readonly handleWaiting = (): void => {
    if (this._status === "idle" || this._status === "ended") {
      return;
    }

    this._status = "buffering";
    this.setBuffering(true);
  };

  private readonly handlePause = (): void => {
    if (this.suppressPauseCallback || this.audio.ended) {
      return;
    }

    this.callbacks.onPaused?.();
  };

  private readonly handleEnded = (): void => {
    this.shouldResumeAfterLoad = false;
    this._status = "ended";
    this.setBuffering(false);
    this.callbacks.onEnded?.();
  };

  private readonly handleMediaError = (): void => {
    if (this.isLoadingPhase) {
      return;
    }

    const error = createMediaError(this.audio);
    const code = this.audio.error?.code;
    if (
      code === MediaError.MEDIA_ERR_NETWORK &&
      (this._status === "streaming" || this._status === "buffering")
    ) {
      this.callbacks.onStreamError?.(this.audio.currentTime);
    }

    this._status = "error";
    this.setBuffering(false);
    this.callbacks.onError?.(error);
  };

  private setBuffering(isBuffering: boolean): void {
    if (this._isBuffering === isBuffering) {
      return;
    }

    this._isBuffering = isBuffering;
    this.callbacks.onBuffering?.(isBuffering);
  }
}
