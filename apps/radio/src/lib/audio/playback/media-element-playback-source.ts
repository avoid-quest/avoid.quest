import { createValidatedHlsFetchSetup } from "./hls-request.js";
import type {
  PlaybackInput,
  PlaybackSource,
  PlaybackSourceCallbacks,
} from "./playback-source.js";
import type { StreamStatus } from "./types.js";

// Start this budget only after a source is attached. A cold, lazy HLS import
// must not consume the media-readiness timeout on a constrained connection.
const MEDIA_READY_TIMEOUT_MS = 20_000;
const NO_PROGRESS_WATCHDOG_MS = 6000;
const MAX_FETCH_WITHOUT_MEDIA_PROGRESS_MS = NO_PROGRESS_WATCHDOG_MS * 2;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MIN_MEDIA_TIME_PROGRESS_SECONDS = 0.1;
type HlsConstructor = typeof import("hls.js").default;
type HlsInstance = InstanceType<HlsConstructor>;
type HlsFetchSetup = ReturnType<typeof createValidatedHlsFetchSetup>;
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
  private readonly hlsFetchSetups = new Map<
    RequestCredentials,
    HlsFetchSetup
  >();
  private _status: StreamStatus = "idle";
  private _isBuffering = false;
  private generation = 0;
  private mediaLoadAttempt = 0;
  private playbackIntent = 0;
  private playbackRate = 1;
  private shouldResumeAfterLoad = false;
  private currentLoadPromise: Promise<void> | null = null;
  private currentInput: PlaybackInput | null = null;
  private pendingMediaSourceObjectUrl: string | null = null;
  private isLoadingPhase = false;
  private suppressPauseCallback = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private noProgressTimer: ReturnType<typeof setTimeout> | null = null;
  private progressEpoch = 0;
  private noMediaProgressSince: number | null = null;
  private pendingRecoveryError: Error | null = null;
  private hlsMediaRecoveryAttempt = 0;
  private recoveryLoadActive = false;

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
    this.audio.addEventListener("stalled", this.handleStalled);
    this.audio.addEventListener("canplay", this.handleCanPlay);
    this.audio.addEventListener("progress", this.handleProgress);
    this.audio.addEventListener("timeupdate", this.handleProgress);
    this.audio.addEventListener("pause", this.handlePause);
    this.audio.addEventListener("ended", this.handleEnded);
    this.audio.addEventListener("error", this.handleMediaError);
    globalThis.addEventListener?.("online", this.handleOnline);
    globalThis.addEventListener?.("offline", this.handleOffline);
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
    this.cancelRecovery();
    this.resetMediaElement({ resetProgress: true });
    this.currentInput = { ...input };

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
    this.cancelRecovery();
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
    this.cancelRecovery();
    this.resetMediaElement({ resetProgress: true });
    this.currentInput = null;
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
    this.audio.removeEventListener("stalled", this.handleStalled);
    this.audio.removeEventListener("canplay", this.handleCanPlay);
    this.audio.removeEventListener("progress", this.handleProgress);
    this.audio.removeEventListener("timeupdate", this.handleProgress);
    this.audio.removeEventListener("pause", this.handlePause);
    this.audio.removeEventListener("ended", this.handleEnded);
    this.audio.removeEventListener("error", this.handleMediaError);
    globalThis.removeEventListener?.("online", this.handleOnline);
    globalThis.removeEventListener?.("offline", this.handleOffline);
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
    this.currentInput = null;
    this.cancelRecovery();
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
        input.credentials,
        input.allowNativeHls ?? false
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
    credentials: RequestCredentials | undefined,
    allowNativeHls: boolean
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let sourceAttached = false;
      let mediaLoadAttempt = 0;

      const cleanup = () => {
        this.audio.removeEventListener("canplay", handleReady);
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
        if (
          !sourceAttached ||
          this.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
        ) {
          return;
        }
        if (
          generation !== this.generation ||
          mediaLoadAttempt !== this.mediaLoadAttempt
        ) {
          finish(() => {
            reject(new Error("Stale media playback generation"));
          });
          return;
        }

        finish(() => {
          this._status = this.audio.paused ? "buffering" : "streaming";
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
            new Error(
              `Audio stream timed out after ${MEDIA_READY_TIMEOUT_MS}ms`
            )
          );
        });
      };

      this.audio.addEventListener("canplay", handleReady, { once: true });
      this.audio.addEventListener("error", handleError, { once: true });
      this.audio.addEventListener("abort", handleAbort, { once: true });

      mediaLoadAttempt = ++this.mediaLoadAttempt;
      const sourceAttachmentPromise = this.loadIntoMediaElement(
        url,
        treatAsHls,
        generation,
        mediaLoadAttempt,
        credentials,
        allowNativeHls,
        (error) => {
          finish(() => {
            reject(error);
          });
        }
      );
      sourceAttachmentPromise.then(
        () => {
          if (
            generation !== this.generation ||
            mediaLoadAttempt !== this.mediaLoadAttempt
          ) {
            finish(() => {
              reject(new DOMException("Load aborted", "AbortError"));
            });
            return;
          }

          sourceAttached = true;
          // The readiness clock intentionally begins after the HLS runtime and
          // source attachment have completed.
          timeoutId = setTimeout(handleTimeout, MEDIA_READY_TIMEOUT_MS);
          handleReady();
        },
        (error: unknown) => {
          finish(() => {
            reject(
              error instanceof Error
                ? error
                : new Error("Audio playback failed")
            );
          });
        }
      );
    });
  }

  private async loadIntoMediaElement(
    url: string,
    treatAsHls: boolean,
    generation: number,
    mediaLoadAttempt: number,
    credentials: RequestCredentials | undefined,
    allowNativeHls: boolean,
    onFatalError: (error: Error) => void
  ): Promise<void> {
    this.destroyHls();

    if (!treatAsHls) {
      this.audio.src = url;
      this.audio.load();
      return;
    }

    // Safari's native HLS path has fewer moving parts and avoids downloading
    // hls.js. Only use it for inputs explicitly marked as trusted by the URL
    // policy layer.
    if (
      allowNativeHls &&
      this.audio.canPlayType("application/vnd.apple.mpegurl")
    ) {
      this.audio.src = url;
      this.audio.load();
      return;
    }

    const mediaSource = this.attachMediaSourceForEarlyPlayback();
    const { default: Hls, FetchLoader } = await import("hls.js");
    if (
      generation !== this.generation ||
      mediaLoadAttempt !== this.mediaLoadAttempt
    ) {
      throw new DOMException("Load aborted", "AbortError");
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        debug: false,
        fetchSetup: this.getHlsFetchSetup(credentials),
        loader: FetchLoader,
        startLevel: -1,
        // Radio favors continuity over glass-to-glass latency. Keep hls.js out
        // of low-latency mode and allow a deeper forward buffer on unstable
        // mobile links; Safari/iOS uses native HLS above instead.
        lowLatencyMode: false,
        liveSyncDurationCount: 4,
        liveMaxLatencyDurationCount: 10,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (
          !data.fatal ||
          generation !== this.generation ||
          mediaLoadAttempt !== this.mediaLoadAttempt
        ) {
          return;
        }

        const error = new Error(`HLS error: ${data.type} - ${data.details}`);
        this.handleFatalHlsError(
          hls,
          data.type,
          Hls.ErrorTypes.NETWORK_ERROR,
          Hls.ErrorTypes.MEDIA_ERROR,
          error,
          onFatalError
        );
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
    throw new Error("HLS is not supported in this browser");
  }

  private getHlsFetchSetup(
    credentials: RequestCredentials | undefined
  ): HlsFetchSetup {
    const key = credentials ?? "omit";
    const existing = this.hlsFetchSetups.get(key);
    if (existing) {
      return existing;
    }
    const fetchSetup = createValidatedHlsFetchSetup({ credentials: key });
    this.hlsFetchSetups.set(key, fetchSetup);
    return fetchSetup;
  }

  private handleFatalHlsError(
    hls: HlsInstance,
    errorType: string,
    networkErrorType: string,
    mediaErrorType: string,
    error: Error,
    onFatalError: (error: Error) => void
  ): void {
    const loadIsPending = this.isLoadingPhase || this.recoveryLoadActive;
    if (errorType === networkErrorType) {
      if (loadIsPending) {
        onFatalError(error);
        return;
      }

      // A fatal hls.js network error means its internal retries are exhausted.
      // Restart loading without replacing the media element or graph, then let
      // the no-progress watchdog decide whether HLS must be recreated.
      hls.startLoad();
      this.beginRecoveryWatchdog(error);
      return;
    }

    if (errorType === mediaErrorType) {
      if (this.hlsMediaRecoveryAttempt === 0) {
        this.hlsMediaRecoveryAttempt = 1;
        hls.recoverMediaError();
        if (!loadIsPending) {
          this.beginRecoveryWatchdog(error);
        }
        return;
      }

      if (loadIsPending) {
        onFatalError(error);
      } else {
        this.beginRecoveryWatchdog(error);
      }
      return;
    }

    if (loadIsPending) {
      onFatalError(error);
    } else {
      this.handlePlaybackFailure(error);
    }
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
    this.recoveryLoadActive = false;
  }

  private handlePlaybackFailure(error: Error): void {
    if (!(this.shouldResumeAfterLoad && this.currentInput)) {
      this.reportTerminalError(error);
      return;
    }

    // Finite platform media can have expiring URLs. Preserve the existing DJ
    // continuation contract for those sources instead of repeatedly loading a
    // URL which needs to be re-resolved. Live radio reports an infinite
    // duration and is recovered locally.
    if (Number.isFinite(this.audio.duration)) {
      this.callbacks.onStreamError?.(this.audio.currentTime);
      this.reportTerminalError(error);
      return;
    }

    this.beginRecoveryWatchdog(error);
  }

  private reportTerminalError(error: Error): void {
    this.clearRecoveryTimers();
    this._status = "error";
    this.setBuffering(false);
    this.callbacks.onError?.(error);
  }

  private beginRecoveryWatchdog(error: Error, markBuffering = true): void {
    if (!(this.shouldResumeAfterLoad && this.currentInput)) {
      return;
    }

    this.pendingRecoveryError = error;
    this.noMediaProgressSince ??= Date.now();
    if (markBuffering) {
      this._status = "buffering";
      this.setBuffering(true);
    }

    if (this.isOffline() || this.noProgressTimer !== null) {
      return;
    }

    const generation = this.generation;
    const observedTime = this.audio.currentTime;
    const observedProgressEpoch = this.progressEpoch;
    const observedReadyState = this.audio.readyState;
    this.noProgressTimer = setTimeout(() => {
      this.noProgressTimer = null;
      if (
        generation !== this.generation ||
        !this.shouldResumeAfterLoad ||
        !this.currentInput
      ) {
        return;
      }

      const currentTime = this.audio.currentTime;
      if (
        Number.isFinite(currentTime) &&
        currentTime >= observedTime + MIN_MEDIA_TIME_PROGRESS_SECONDS
      ) {
        this.pendingRecoveryError = null;
        this.noMediaProgressSince = null;
        this.reconnectAttempt = 0;
        this._status = "streaming";
        this.setBuffering(false);
        return;
      }

      // Fetch progress or a newly playable buffer is useful even when the
      // media clock is still stopped. Give native buffering another watchdog
      // window before doing a destructive source reload.
      if (
        (this.progressEpoch !== observedProgressEpoch ||
          this.audio.readyState > observedReadyState) &&
        Date.now() - (this.noMediaProgressSince ?? Date.now()) <
          MAX_FETCH_WITHOUT_MEDIA_PROGRESS_MS
      ) {
        if (this.audio.paused) {
          this.audio.play().catch(() => {
            // A later user gesture or reconnect attempt can resume playback.
          });
        }
        this.beginRecoveryWatchdog(error);
        return;
      }

      this.scheduleReconnect(error, generation);
    }, NO_PROGRESS_WATCHDOG_MS);
  }

  private scheduleReconnect(error: Error, generation: number): void {
    if (
      generation !== this.generation ||
      !this.shouldResumeAfterLoad ||
      !this.currentInput
    ) {
      return;
    }

    this.pendingRecoveryError = error;
    this.clearNoProgressTimer();
    if (this.isOffline() || this.reconnectTimer !== null) {
      return;
    }

    const delay =
      this.reconnectAttempt === 0
        ? 0
        : Math.min(
            1000 * 2 ** Math.min(this.reconnectAttempt - 1, 10),
            MAX_RECONNECT_DELAY_MS
          );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.recoverCurrentSource(generation).catch((recoveryError: unknown) => {
        this.handlePlaybackFailure(
          recoveryError instanceof Error
            ? recoveryError
            : new Error("Audio stream recovery failed")
        );
      });
    }, delay);
  }

  private async recoverCurrentSource(generation: number): Promise<void> {
    const input = this.currentInput;
    if (
      !input ||
      generation !== this.generation ||
      !this.shouldResumeAfterLoad ||
      this.isOffline()
    ) {
      return;
    }

    this._status = "connecting";
    this.setBuffering(true);
    this.recoveryLoadActive = true;
    try {
      await this.waitForReadyState(
        input.src,
        generation,
        input.format === "hls",
        input.credentials,
        input.allowNativeHls ?? false
      );
      if (generation !== this.generation || !this.shouldResumeAfterLoad) {
        return;
      }

      this.audio.autoplay = true;
      if (this.audio.paused) {
        await this.audio.play();
      }
    } catch (error) {
      if (generation !== this.generation || !this.shouldResumeAfterLoad) {
        return;
      }
      this.scheduleReconnect(
        error instanceof Error ? error : new Error("Audio playback failed"),
        generation
      );
    } finally {
      if (generation === this.generation) {
        this.recoveryLoadActive = false;
      }
    }
  }

  private cancelRecovery(): void {
    if (this.recoveryLoadActive) {
      this.mediaLoadAttempt += 1;
    }
    this.clearRecoveryTimers();
    this.reconnectAttempt = 0;
    this.pendingRecoveryError = null;
    this.noMediaProgressSince = null;
    this.hlsMediaRecoveryAttempt = 0;
    this.recoveryLoadActive = false;
  }

  private clearRecoveryTimers(): void {
    this.clearNoProgressTimer();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearNoProgressTimer(): void {
    if (this.noProgressTimer !== null) {
      clearTimeout(this.noProgressTimer);
      this.noProgressTimer = null;
    }
  }

  private isOffline(): boolean {
    return typeof navigator !== "undefined" && navigator.onLine === false;
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
    this.hlsMediaRecoveryAttempt = 0;
  }

  private readonly handlePlaying = (): void => {
    this.clearRecoveryTimers();
    this.pendingRecoveryError = null;
    this.noMediaProgressSince = null;
    this.reconnectAttempt = 0;
    this.hlsMediaRecoveryAttempt = 0;
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
    this.beginRecoveryWatchdog(
      new Error("Audio playback is waiting for buffered media")
    );
  };

  private readonly handleStalled = (): void => {
    if (this._status === "idle" || this._status === "ended") {
      return;
    }

    // `stalled` means the fetch stopped making progress; playback may still
    // have buffered media. Do not show a buffering interruption until the
    // element also lacks future data.
    const isActuallyBuffering =
      this.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
    if (isActuallyBuffering) {
      this._status = "buffering";
      this.setBuffering(true);
    }
    this.beginRecoveryWatchdog(
      new Error("Audio stream stopped making network progress"),
      isActuallyBuffering
    );
  };

  private readonly handleCanPlay = (): void => {
    this.progressEpoch += 1;
    if (
      this.shouldResumeAfterLoad &&
      this._status === "buffering" &&
      this.audio.paused
    ) {
      this.audio.play().catch(() => {
        // Keep recovery armed; browser policy may require another gesture.
      });
    }
  };

  private readonly handleProgress = (): void => {
    this.progressEpoch += 1;
  };

  private readonly handlePause = (): void => {
    if (
      this.suppressPauseCallback ||
      this.recoveryLoadActive ||
      this.audio.ended
    ) {
      return;
    }

    this.callbacks.onPaused?.();
  };

  private readonly handleEnded = (): void => {
    this.shouldResumeAfterLoad = false;
    this.cancelRecovery();
    this._status = "ended";
    this.setBuffering(false);
    this.callbacks.onEnded?.();
  };

  private readonly handleMediaError = (): void => {
    if (this.isLoadingPhase || this.recoveryLoadActive) {
      return;
    }

    const error = createMediaError(this.audio);
    this.handlePlaybackFailure(error);
  };

  private readonly handleOffline = (): void => {
    if (!(this.shouldResumeAfterLoad && this.currentInput)) {
      return;
    }

    this.pendingRecoveryError ??= new Error("Network connection is offline");
    this.clearRecoveryTimers();
    if (
      this.audio.paused ||
      this.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      this._status = "buffering";
      this.setBuffering(true);
    }
  };

  private readonly handleOnline = (): void => {
    if (!(this.shouldResumeAfterLoad && this.currentInput)) {
      return;
    }

    // A network handoff does not imply media stopped advancing. Re-arm the
    // progress watchdog and preserve buffered playback; only reload if the
    // media clock remains frozen through the watchdog window.
    this.beginRecoveryWatchdog(
      this.pendingRecoveryError ?? new Error("Network connection restored"),
      this._isBuffering
    );
  };

  private setBuffering(isBuffering: boolean): void {
    if (this._isBuffering === isBuffering) {
      return;
    }

    this._isBuffering = isBuffering;
    this.callbacks.onBuffering?.(isBuffering);
  }
}
