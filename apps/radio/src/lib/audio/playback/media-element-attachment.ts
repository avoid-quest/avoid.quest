import { createValidatedHlsFetchSetup } from "./hls-request.js";
import type { PlaybackInput } from "./playback-source.js";

const MEDIA_READY_TIMEOUT_MS = 20_000;
type HlsConstructor = typeof import("hls.js").default;
type HlsInstance = InstanceType<HlsConstructor>;
type HlsFetchSetup = ReturnType<typeof createValidatedHlsFetchSetup>;
type MediaSourceGlobal = typeof globalThis & {
  ManagedMediaSource?: typeof MediaSource;
  WebKitMediaSource?: typeof MediaSource;
};

export type FatalHlsEvent = {
  error: Error;
  recoveredInPlace: boolean;
};

type DetachOptions = {
  onPause: () => void;
  preservePlaybackIntent?: boolean;
  resetProgress: boolean;
};

function preferredMediaSourceConstructor(): typeof MediaSource | null {
  const mediaSourceGlobal = globalThis as MediaSourceGlobal;
  return (
    mediaSourceGlobal.ManagedMediaSource ??
    mediaSourceGlobal.MediaSource ??
    mediaSourceGlobal.WebKitMediaSource ??
    null
  );
}

export function mediaElementError(element: HTMLMediaElement): Error {
  const code = element.error?.code;
  if (code === MediaError.MEDIA_ERR_ABORTED) {
    return new Error("Audio playback was aborted");
  }
  if (code === MediaError.MEDIA_ERR_NETWORK) {
    return new Error("Audio stream failed to load");
  }
  if (code === MediaError.MEDIA_ERR_DECODE) {
    return new Error("Audio stream could not be decoded");
  }
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return new Error("Audio stream format is not supported");
  }
  return new Error("Audio playback failed");
}

/** Owns source attachment, HLS lifetime, and gesture-preserving object URLs. */
export class MediaElementAttachment {
  private readonly audio: HTMLAudioElement;
  private hls: HlsInstance | null = null;
  private readonly hlsFetchSetups = new Map<
    RequestCredentials,
    HlsFetchSetup
  >();
  private hlsMediaRecoveryAttempt = 0;
  private loadController: AbortController | null = null;
  private pendingMediaSourceObjectUrl: string | null = null;

  constructor(audio: HTMLAudioElement) {
    this.audio = audio;
  }

  cancelLoad(): void {
    this.loadController?.abort();
    this.loadController = null;
  }

  async load(
    input: PlaybackInput,
    isCurrentGeneration: () => boolean,
    onFatal: (event: FatalHlsEvent) => boolean
  ): Promise<void> {
    this.cancelLoad();
    const controller = new AbortController();
    this.loadController = controller;
    try {
      await this.waitUntilReady(
        input,
        () => isCurrentGeneration() && !controller.signal.aborted,
        controller,
        onFatal
      );
    } finally {
      if (this.loadController === controller) {
        this.loadController = null;
      }
    }
  }

  detach(options: DetachOptions): void {
    if (!(options.preservePlaybackIntent || this.audio.paused)) {
      options.onPause();
      this.audio.pause();
    }
    this.revokeObjectUrl();
    this.destroyHls();
    this.audio.removeAttribute("src");
    if (options.resetProgress && Number.isFinite(this.audio.duration)) {
      try {
        this.audio.currentTime = 0;
      } catch {
        // Streams and not-yet-seekable media can reject currentTime writes.
      }
    }
    this.audio.load();
  }

  markPlaybackProgress(): void {
    this.hlsMediaRecoveryAttempt = 0;
  }

  private async attachSource(
    input: PlaybackInput,
    isCurrent: () => boolean,
    onFatal: (event: FatalHlsEvent) => void
  ): Promise<void> {
    this.revokeObjectUrl();
    this.destroyHls();

    if (input.format !== "hls") {
      this.attachUrl(input.src);
      return;
    }

    if (
      input.allowNativeHls &&
      this.audio.canPlayType("application/vnd.apple.mpegurl")
    ) {
      this.attachUrl(input.src);
      return;
    }

    const mediaSource = this.attachGestureSource();
    const { default: Hls, FetchLoader } = await import("hls.js");
    if (!isCurrent()) {
      throw new DOMException("Load aborted", "AbortError");
    }
    if (!Hls.isSupported()) {
      this.revokeObjectUrl();
      throw new Error("HLS is not supported in this browser");
    }

    const hls = new Hls({
      fetchSetup: this.getFetchSetup(input.credentials),
      liveMaxLatencyDurationCount: 10,
      liveSyncDurationCount: 4,
      loader: FetchLoader,
      lowLatencyMode: false,
      maxBufferLength: 60,
      maxMaxBufferLength: 120,
    });
    this.hls = hls;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!(data.fatal && this.hls === hls && isCurrent())) {
        return;
      }

      const error = new Error(`HLS error: ${data.type} - ${data.details}`);
      if (
        data.type === Hls.ErrorTypes.MEDIA_ERROR &&
        this.hlsMediaRecoveryAttempt === 0
      ) {
        this.hlsMediaRecoveryAttempt = 1;
        hls.recoverMediaError();
        onFatal({ error, recoveredInPlace: true });
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
        onFatal({ error, recoveredInPlace: true });
        return;
      }
      onFatal({ error, recoveredInPlace: false });
    });
    hls.attachMedia(
      mediaSource ? { media: this.audio, mediaSource } : this.audio
    );
    hls.loadSource(input.src);
  }

  private attachUrl(url: string): void {
    this.audio.src = url;
    this.audio.load();
  }

  private attachGestureSource(): MediaSource | null {
    const MediaSourceConstructor = preferredMediaSourceConstructor();
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
    this.attachUrl(objectUrl);
    return mediaSource;
  }

  private destroyHls(): void {
    const { hls } = this;
    this.hls = null;
    hls?.destroy();
    this.hlsMediaRecoveryAttempt = 0;
  }

  private getFetchSetup(
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

  private revokeObjectUrl(): void {
    if (!this.pendingMediaSourceObjectUrl) {
      return;
    }
    URL.revokeObjectURL(this.pendingMediaSourceObjectUrl);
    this.pendingMediaSourceObjectUrl = null;
  }

  private waitUntilReady(
    input: PlaybackInput,
    isCurrent: () => boolean,
    controller: AbortController,
    onFatal: (event: FatalHlsEvent) => boolean
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let sourceAttached = false;

      const cleanup = () => {
        this.audio.removeEventListener("canplay", handleReady);
        this.audio.removeEventListener("error", handleError);
        this.audio.removeEventListener("abort", handleAbort);
        controller.signal.removeEventListener("abort", handleAbort);
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };
      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        callback();
      };
      const handleReady = () => {
        if (
          !sourceAttached ||
          this.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
        ) {
          return;
        }
        if (!isCurrent()) {
          finish(() => reject(new DOMException("Load aborted", "AbortError")));
          return;
        }
        finish(resolve);
      };
      const handleError = () => {
        finish(() => reject(mediaElementError(this.audio)));
      };
      const handleAbort = () => {
        finish(() => reject(new DOMException("Load aborted", "AbortError")));
      };
      const handleTimeout = () => {
        finish(() =>
          reject(
            new Error(
              `Audio stream timed out after ${MEDIA_READY_TIMEOUT_MS}ms`
            )
          )
        );
      };

      this.audio.addEventListener("canplay", handleReady, { once: true });
      this.audio.addEventListener("error", handleError, { once: true });
      this.audio.addEventListener("abort", handleAbort, { once: true });
      controller.signal.addEventListener("abort", handleAbort, { once: true });

      this.attachSource(input, isCurrent, (event) => {
        if (onFatal(event)) {
          finish(() => reject(event.error));
        }
      }).then(
        () => {
          if (!isCurrent()) {
            finish(() =>
              reject(new DOMException("Load aborted", "AbortError"))
            );
            return;
          }
          sourceAttached = true;
          // The readiness clock begins after lazy HLS setup and attachment.
          timeoutId = setTimeout(handleTimeout, MEDIA_READY_TIMEOUT_MS);
          handleReady();
        },
        (error: unknown) => {
          finish(() =>
            reject(
              error instanceof Error
                ? error
                : new Error("Audio playback failed")
            )
          );
        }
      );
    });
  }
}
