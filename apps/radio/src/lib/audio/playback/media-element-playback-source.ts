import type {
  PlaybackInput,
  PlaybackSource,
  PlaybackSourceCallbacks,
} from "./playback-source.js";
import type { StreamStatus } from "./types.js";

const MEDIA_LOAD_TIMEOUT_MS = 8000;
type HlsConstructor = typeof import("hls.js").default;
type HlsInstance = InstanceType<HlsConstructor>;
type MediaSourceGlobal = typeof globalThis & {
  ManagedMediaSource?: typeof MediaSource;
  WebKitMediaSource?: typeof MediaSource;
};

function getPreferredMediaSourceConstructor(): typeof MediaSource | null {
  const mediaSourceGlobal = globalThis as MediaSourceGlobal;
  return (
    mediaSourceGlobal.ManagedMediaSource ??
    mediaSourceGlobal.MediaSource ??
    mediaSourceGlobal.WebKitMediaSource ??
    null
  );
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

  private hls: HlsInstance | null = null;
  private _status: StreamStatus = "idle";
  private _isBuffering = false;
  private generation = 0;
  private mediaLoadAttempt = 0;
  private playbackIntent = 0;
  private playbackRate = 1;
  private shouldResumeAfterLoad = false;
  private currentLoadPromise: Promise<void> | null = null;
  private pendingMediaSourceObjectUrl: string | null = null;
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

  async load(input: PlaybackInput): Promise<void> {
    const generation = ++this.generation;
    this.cancelPendingPlaybackIntent();
    this.resetMediaElement({ resetProgress: true });

    this._status = "connecting";
    this.setBuffering(false);
    const loadPromise = this.loadSource(input, generation);
    this.currentLoadPromise = loadPromise;
    this.isLoadingPhase = true;

    try {
      await loadPromise;
    } catch (error) {
      const loadError =
        error instanceof Error ? error : new Error("Audio playback failed");
      if (generation === this.generation) {
        this._status = "error";
        this.callbacks.onError?.(loadError);
      }
      throw loadError;
    } finally {
      if (this.currentLoadPromise === loadPromise) {
        this.currentLoadPromise = null;
        this.isLoadingPhase = false;
      }
    }
  }

  async play(): Promise<void> {
    const playbackIntent = ++this.playbackIntent;
    this.shouldResumeAfterLoad = true;
    this.audio.autoplay = true;

    if (this.currentLoadPromise) {
      // Mobile browsers require media playback to be requested while the tap's
      // transient user activation is still alive. Start the media element now,
      // even if metadata is still loading, and then wait for both readiness and
      // the browser's play promise.
      const loadPromise = this.currentLoadPromise;
      const playResultPromise = (
        this.audio.paused ? this.audio.play() : Promise.resolve()
      ).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ error, ok: false as const })
      );
      try {
        await loadPromise;
      } catch (error) {
        if (this.isPlaybackIntentCanceled(playbackIntent)) {
          return;
        }
        throw error;
      }

      const playResult = await playResultPromise;
      if (!playResult.ok) {
        const canRecoverPlayError = this.canRecoverPendingPlayError(
          playResult.error,
          playbackIntent
        );
        if (!canRecoverPlayError) {
          throw playResult.error;
        }
      }

      if (
        playbackIntent === this.playbackIntent &&
        this.shouldResumeAfterLoad &&
        this.audio.paused
      ) {
        await this.audio.play();
      }
      return;
    }

    if (this._status === "idle" || this._status === "ended") {
      throw new Error("Source not loaded - call load() first");
    }

    await this.audio.play();
  }

  pause(): void {
    this.cancelPendingPlaybackIntent();
    this._status = "buffering";
    this.suppressPauseCallback = true;
    this.audio.pause();
    queueMicrotask(() => {
      this.suppressPauseCallback = false;
    });
    this.callbacks.onPaused?.();
  }

  stop(): void {
    this.cancelPendingPlaybackIntent();
    this.cancelPendingLoad();
    this.resetMediaElement({ resetProgress: true });
    this._status = "ended";
    this.setBuffering(false);
    this.callbacks.onEnded?.();
  }

  cleanup(): void {
    this.cancelPendingPlaybackIntent();
    this.cancelPendingLoad();
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
    this.revokePendingMediaSourceObjectUrl();
    this.isLoadingPhase = false;
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

  async refreshUrl(input: PlaybackInput, seekPosition?: number): Promise<void> {
    const shouldResume = this.shouldResumeAfterLoad || !this.audio.paused;
    await this.load(input);

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

  private async loadSource(
    input: PlaybackInput,
    generation: number
  ): Promise<void> {
    try {
      await this.waitForReadyState(
        input.src,
        generation,
        input.format === "hls",
        input.credentials
      );
    } catch (error) {
      if (generation === this.generation) {
        this.resetMediaElement({
          preservePlaybackIntent: this.shouldResumeAfterLoad,
          resetProgress: true,
        });
      }
      throw error;
    }
  }

  private async waitForReadyState(
    url: string,
    generation: number,
    treatAsHls: boolean,
    credentials?: RequestCredentials
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        this.audio.removeEventListener("canplay", handleReady);
        this.audio.removeEventListener("loadedmetadata", handleReady);
        this.audio.removeEventListener("error", handleError);
        this.audio.removeEventListener("abort", handleAbort);
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
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

      const handleTimeout = () => {
        finish(() => {
          reject(
            new Error(`Audio stream timed out after ${MEDIA_LOAD_TIMEOUT_MS}ms`)
          );
        });
      };

      this.audio.addEventListener("canplay", handleReady, { once: true });
      this.audio.addEventListener("loadedmetadata", handleReady, {
        once: true,
      });
      this.audio.addEventListener("error", handleError, { once: true });
      this.audio.addEventListener("abort", handleAbort, { once: true });
      timeoutId = setTimeout(handleTimeout, MEDIA_LOAD_TIMEOUT_MS);

      const mediaLoadAttempt = ++this.mediaLoadAttempt;
      const sourceAttachmentPromise = this.loadIntoMediaElement(
        url,
        treatAsHls,
        generation,
        mediaLoadAttempt,
        credentials,
        (error) => {
          finish(() => {
            reject(error);
          });
        }
      );
      sourceAttachmentPromise.catch((error) => {
        finish(() => {
          reject(
            error instanceof Error ? error : new Error("Audio playback failed")
          );
        });
      });

      if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        handleReady();
      }
    });
  }

  private async loadIntoMediaElement(
    url: string,
    treatAsHls: boolean,
    generation: number,
    mediaLoadAttempt: number,
    credentials: RequestCredentials | undefined,
    onFatalError: (error: Error) => void
  ): Promise<void> {
    this.destroyHls();

    if (!treatAsHls) {
      this.audio.src = url;
      this.audio.load();
      return;
    }

    const mediaSource = this.attachMediaSourceForEarlyPlayback();
    const { default: Hls } = await import("hls.js");
    if (
      generation !== this.generation ||
      mediaLoadAttempt !== this.mediaLoadAttempt
    ) {
      throw new DOMException("Load aborted", "AbortError");
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        debug: false,
        ...(credentials
          ? {
              fetchSetup: (context, init) =>
                new Request(context.url, { ...init, credentials }),
            }
          : {}),
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

      if (mediaSource) {
        hls.attachMedia({ media: this.audio, mediaSource });
        this.pendingMediaSourceObjectUrl = null;
      } else {
        hls.attachMedia(this.audio);
      }
      hls.loadSource(url);
      this.hls = hls;
      return;
    }

    this.revokePendingMediaSourceObjectUrl();
    if (this.audio.canPlayType("application/vnd.apple.mpegurl")) {
      this.audio.src = url;
      this.audio.load();
      return;
    }

    throw new Error("HLS is not supported in this browser");
  }

  private resetMediaElement(options: {
    preservePlaybackIntent?: boolean;
    resetProgress: boolean;
  }): void {
    this.suppressPauseCallback = true;
    this.mediaLoadAttempt += 1;
    this.revokePendingMediaSourceObjectUrl();
    if (!options.preservePlaybackIntent) {
      this.audio.pause();
    }
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

  private cancelPendingPlaybackIntent(): void {
    this.shouldResumeAfterLoad = false;
    this.audio.autoplay = false;
    this.playbackIntent += 1;
  }

  private canRecoverPendingPlayError(
    error: unknown,
    playbackIntent: number
  ): boolean {
    if (this.isPlaybackIntentCanceled(playbackIntent)) {
      return true;
    }

    const errorName =
      error instanceof DOMException || error instanceof Error ? error.name : "";
    return errorName === "AbortError" || errorName === "NotSupportedError";
  }

  private cancelPendingLoad(): void {
    this.generation += 1;
    this.currentLoadPromise = null;
    this.isLoadingPhase = false;
  }

  private isPlaybackIntentCanceled(playbackIntent: number): boolean {
    return (
      playbackIntent !== this.playbackIntent || !this.shouldResumeAfterLoad
    );
  }

  private attachMediaSourceForEarlyPlayback(): MediaSource | null {
    const MediaSourceConstructor = getPreferredMediaSourceConstructor();
    if (
      !MediaSourceConstructor ||
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      return null;
    }

    const mediaSource = new MediaSourceConstructor();
    const objectUrl = URL.createObjectURL(mediaSource);
    this.pendingMediaSourceObjectUrl = objectUrl;
    this.audio.src = objectUrl;
    this.audio.load();
    return mediaSource;
  }

  private revokePendingMediaSourceObjectUrl(): void {
    if (!this.pendingMediaSourceObjectUrl) {
      return;
    }

    URL.revokeObjectURL(this.pendingMediaSourceObjectUrl);
    this.pendingMediaSourceObjectUrl = null;
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
