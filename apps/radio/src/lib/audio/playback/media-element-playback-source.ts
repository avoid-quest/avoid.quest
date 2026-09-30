import {
  type FatalHlsEvent,
  MediaElementAttachment,
  mediaElementError,
} from "./media-element-attachment.js";
import { MediaPlaybackRecovery } from "./media-playback-recovery.js";
import type {
  PlaybackInput,
  PlaybackSource,
  PlaybackSourceCallbacks,
} from "./playback-source.js";
import type { StreamStatus } from "./types.js";

export class MediaElementPlaybackSource implements PlaybackSource {
  private readonly callbacks: PlaybackSourceCallbacks;
  private readonly sourceId: string;
  private readonly audio: HTMLAudioElement;
  private readonly attachment: MediaElementAttachment;
  private readonly mediaSourceNode: MediaElementAudioSourceNode | null;
  private readonly outputNode: GainNode | null;

  private _status: StreamStatus = "idle";
  private _isBuffering = false;
  private generation = 0;
  private playbackIntent = 0;
  private playbackRate = 1;
  private shouldResumeAfterLoad: boolean;
  private currentLoadPromise: Promise<void> | null = null;
  private currentInput: PlaybackInput | null = null;
  private isLoadingPhase: boolean;
  private ignoredPauseEvents = 0;
  private readonly recovery: MediaPlaybackRecovery;

  constructor(
    context: AudioContext | null,
    sourceId: string,
    callbacks: PlaybackSourceCallbacks = {}
  ) {
    this.callbacks = callbacks;
    this.sourceId = sourceId;
    this.shouldResumeAfterLoad = false;
    this.isLoadingPhase = false;
    this.audio = new Audio();
    if (context) {
      this.audio.crossOrigin = "anonymous";
    }
    this.audio.preload = "auto";
    this.audio.autoplay = false;
    this.audio.setAttribute("playsinline", "");
    this.attachment = new MediaElementAttachment(this.audio);
    this.recovery = new MediaPlaybackRecovery({
      abortReload: () => this.attachment.cancelLoad(),
      getSnapshot: () => ({
        currentTime: this.audio.currentTime,
        duration: this.audio.duration,
        generation: this.generation,
        input: this.currentInput,
        isBuffering: this._isBuffering,
        isOffline:
          typeof navigator !== "undefined" && navigator.onLine === false,
        paused: this.audio.paused,
        readyState: this.audio.readyState,
        shouldResume: this.shouldResumeAfterLoad,
        status: this._status,
      }),
      onStreamError: (position) => this.callbacks.onStreamError?.(position),
      onTerminalError: (error) => {
        this._status = "error";
        this.setBuffering(false);
        this.callbacks.onError?.(error);
      },
      reload: (input, generation) => this.loadAttachedSource(input, generation),
      resume: async () => {
        this.audio.autoplay = true;
        if (this.audio.paused) {
          await this.audio.play();
        }
      },
      setState: (status, isBuffering) => {
        this._status = status;
        this.setBuffering(isBuffering);
      },
    });

    this.mediaSourceNode =
      context?.createMediaElementSource(this.audio) ?? null;
    this.outputNode = context?.createGain() ?? null;
    if (this.mediaSourceNode && this.outputNode) {
      this.outputNode.gain.value = 1;
      this.mediaSourceNode.connect(this.outputNode);
    }

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

  get output(): AudioNode | null {
    return this.outputNode;
  }

  get status(): StreamStatus {
    return this._status;
  }

  get volume(): number {
    return this.outputNode?.gain.value ?? this.audio.volume;
  }

  set volume(value: number) {
    const volume = Math.max(0, Math.min(1, value));
    if (this.outputNode) {
      this.outputNode.gain.value = volume;
    } else {
      this.audio.volume = volume;
    }
  }

  async load(input: PlaybackInput): Promise<void> {
    this.generation += 1;
    const { generation } = this;
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
    this.playbackIntent += 1;
    const { playbackIntent } = this;
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
    if (!this.audio.paused) {
      this.ignoredPauseEvents += 1;
    }
    this.audio.pause();
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
    try {
      this.mediaSourceNode?.disconnect();
    } catch {
      // Ignore disconnect errors during teardown.
    }
    try {
      this.outputNode?.disconnect();
    } catch {
      // Ignore disconnect errors during teardown.
    }
    this._status = "idle";
    this.setBuffering(false);
    this.currentLoadPromise = null;
    this.isLoadingPhase = false;
    this.currentInput = null;
    this.cancelRecovery();
  }

  setPlaybackRate(rate: number): void {
    const clampedRate = Math.max(0.5, Math.min(2, rate));
    this.playbackRate = clampedRate;
    // A load resets the rate to the default one; keep them together.
    this.audio.defaultPlaybackRate = clampedRate;
    this.audio.playbackRate = clampedRate;
  }

  /** Key lock. The element keeps it across loads. */
  setPreservesPitch(preservesPitch: boolean): void {
    this.audio.preservesPitch = preservesPitch;
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
      await this.loadAttachedSource(input, generation);
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

  private async loadAttachedSource(
    input: PlaybackInput,
    generation: number
  ): Promise<void> {
    await this.attachment.load(
      input,
      () => generation === this.generation,
      (event) => this.handleFatalHlsEvent(event)
    );
    if (generation !== this.generation) {
      throw new DOMException("Load aborted", "AbortError");
    }
    this._status = this.audio.paused ? "buffering" : "streaming";
    this.setBuffering(false);
    this.callbacks.onReady?.();
  }

  private handleFatalHlsEvent(event: FatalHlsEvent): boolean {
    const loadIsPending = this.isLoadingPhase || this.recovery.isReloading;
    if (!(loadIsPending || this.shouldResumeAfterLoad)) {
      return false;
    }
    if (event.recoveredInPlace) {
      if (!loadIsPending) {
        this.recovery.watch(event.error);
      }
      return false;
    }
    if (loadIsPending) {
      return true;
    }
    this.recovery.failed(event.error);
    return false;
  }

  private resetMediaElement(options: {
    preservePlaybackIntent?: boolean;
    resetProgress: boolean;
  }): void {
    this.attachment.detach({
      ...options,
      onPause: () => {
        this.ignoredPauseEvents += 1;
      },
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
    this.attachment.cancelLoad();
    this.currentLoadPromise = null;
    this.isLoadingPhase = false;
  }

  private cancelRecovery(): void {
    this.recovery.cancel();
    this.attachment.markPlaybackProgress();
  }

  private isPlaybackIntentCanceled(playbackIntent: number): boolean {
    return (
      playbackIntent !== this.playbackIntent || !this.shouldResumeAfterLoad
    );
  }

  private readonly handlePlaying = (): void => {
    if (this.recovery.playing()) {
      this.attachment.markPlaybackProgress();
      this.callbacks.onPlaying?.();
    }
  };

  private readonly handleWaiting = (): void => {
    this.recovery.waiting();
  };

  private readonly handleStalled = (): void => {
    this.recovery.stalled();
  };

  private readonly handleCanPlay = (): void => {
    this.recovery.canPlay();
  };

  private readonly handleProgress = (): void => {
    this.recovery.networkProgress();
  };

  private readonly handlePause = (): void => {
    if (this.ignoredPauseEvents > 0) {
      this.ignoredPauseEvents -= 1;
      return;
    }
    if (this.isLoadingPhase || this.recovery.isReloading || this.audio.ended) {
      return;
    }

    this.callbacks.onPaused?.();
  };

  private readonly handleEnded = (): void => {
    if (this.isLoadingPhase || this.recovery.isReloading || !this.audio.ended) {
      return;
    }
    this.shouldResumeAfterLoad = false;
    this.cancelRecovery();
    this._status = "ended";
    this.setBuffering(false);
    this.callbacks.onEnded?.();
  };

  private readonly handleMediaError = (): void => {
    if (this.isLoadingPhase || this.recovery.isReloading) {
      return;
    }

    const error = mediaElementError(this.audio);
    this.recovery.failed(error);
  };

  private readonly handleOffline = (): void => {
    this.recovery.offline();
  };

  private readonly handleOnline = (): void => {
    this.recovery.online();
  };

  private setBuffering(isBuffering: boolean): void {
    if (this._isBuffering === isBuffering) {
      return;
    }

    this._isBuffering = isBuffering;
    this.callbacks.onBuffering?.(isBuffering);
  }
}
