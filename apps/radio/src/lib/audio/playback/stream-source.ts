/**
 * Stream Source
 *
 * Handles fetching and decoding of Icecast MP3 streams.
 * Accumulates data, decodes when buffer is sufficient, and emits decoded audio chunks.
 */

import {
  defaultStreamBufferConfig,
  type StreamBufferConfig,
  type StreamSourceConfig,
  type StreamStatus,
} from "./types.js";

/**
 * Events emitted by StreamSource
 */
export type StreamSourceEvents = {
  /** Emitted when a chunk is successfully decoded */
  chunk: (audioBuffer: AudioBuffer) => void;
  /** Emitted when stream status changes */
  status: (status: StreamStatus) => void;
  /** Emitted when an error occurs */
  error: (error: Error) => void;
  /** Emitted when stream ends naturally */
  ended: () => void;
};

/**
 * Callback types for StreamSource
 */
export type StreamSourceCallbacks = {
  onChunk?: (audioBuffer: AudioBuffer) => void;
  onStatus?: (status: StreamStatus) => void;
  onError?: (error: Error) => void;
  onEnded?: () => void;
};

/**
 * StreamSource class for handling Icecast MP3 streaming
 *
 * Fetches audio data from a URL, accumulates it in a buffer,
 * decodes when enough data is available, and emits decoded chunks.
 */
export class StreamSource {
  private readonly url: string;
  private readonly sourceId: string;
  private readonly context: AudioContext;
  private readonly config: StreamBufferConfig;
  private readonly callbacks: StreamSourceCallbacks;

  private abortController: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buffer: Uint8Array = new Uint8Array(0);
  private decoding = false;
  private _status: StreamStatus = "idle";
  private hasEmittedFirstChunk = false;

  constructor(
    context: AudioContext,
    config: StreamSourceConfig,
    callbacks: StreamSourceCallbacks = {},
    bufferConfig: Partial<StreamBufferConfig> = {}
  ) {
    this.context = context;
    this.url = config.url;
    this.sourceId = config.sourceId;
    this.callbacks = callbacks;
    this.config = { ...defaultStreamBufferConfig, ...bufferConfig };

    // If external signal provided, listen to it
    if (config.signal) {
      config.signal.addEventListener("abort", () => this.stop());
    }
  }

  /**
   * Get current stream status
   */
  get status(): StreamStatus {
    return this._status;
  }

  /**
   * Get source ID
   */
  get id(): string {
    return this.sourceId;
  }

  /**
   * Start streaming from the URL
   */
  async start(): Promise<void> {
    if (
      this._status !== "idle" &&
      this._status !== "ended" &&
      this._status !== "error"
    ) {
      return;
    }

    this.abortController = new AbortController();
    this.buffer = new Uint8Array(0);
    this.hasEmittedFirstChunk = false;
    this.setStatus("connecting");

    try {
      const response = await fetch(this.url, {
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(
          `HTTP error: ${response.status} ${response.statusText}`
        );
      }

      if (!response.body) {
        throw new Error("No response body - streaming not supported");
      }

      this.reader = response.body.getReader();
      this.setStatus("buffering");

      // Start the read loop
      this.readLoop();
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Stop streaming and cleanup
   */
  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.reader) {
      // Intentionally ignoring cancel errors during stop
      this.reader.cancel("Stopped").catch(() => undefined);
      this.reader = null;
    }

    this.buffer = new Uint8Array(0);
    this.decoding = false;

    if (this._status !== "error") {
      this.setStatus("ended");
    }
  }

  /**
   * Check if stream is active
   */
  get isActive(): boolean {
    return (
      this._status === "connecting" ||
      this._status === "buffering" ||
      this._status === "streaming"
    );
  }

  /**
   * Main read loop - fetches chunks from the stream
   */
  private readLoop(): void {
    if (!this.reader || this.abortController?.signal.aborted) {
      return;
    }

    this.reader
      .read()
      .then(({ value, done }) => {
        if (this.abortController?.signal.aborted) {
          return;
        }

        if (done) {
          this.handleStreamEnd();
          return;
        }

        if (value) {
          this.appendToBuffer(value);
          this.tryDecode();
        }

        // Continue reading
        this.readLoop();
      })
      .catch((error) => {
        if (
          error.name !== "AbortError" &&
          !this.abortController?.signal.aborted
        ) {
          this.handleError(error);
        }
      });
  }

  /**
   * Append new data to the buffer
   */
  private appendToBuffer(chunk: Uint8Array): void {
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer, 0);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;
  }

  /**
   * Attempt to decode the buffer if we have enough data
   */
  private tryDecode(): void {
    if (
      this.decoding ||
      this.abortController?.signal.aborted ||
      this.buffer.length < this.config.minBufferSize
    ) {
      return;
    }

    this.decoding = true;

    // Create a copy of the buffer for decoding
    // Cast to ArrayBuffer as decodeAudioData doesn't accept SharedArrayBuffer
    const bufferCopy = this.buffer.buffer.slice(0) as ArrayBuffer;

    this.context
      .decodeAudioData(bufferCopy)
      .then((decoded) => {
        if (this.abortController?.signal.aborted) {
          this.decoding = false;
          return;
        }

        // Emit the decoded chunk
        this.emitChunk(decoded);

        // Clear buffer after successful decode
        this.buffer = new Uint8Array(0);
        this.decoding = false;

        // Update status to streaming after first successful decode
        if (!this.hasEmittedFirstChunk) {
          this.hasEmittedFirstChunk = true;
          this.setStatus("streaming");
        }
      })
      .catch(() => {
        this.decoding = false;

        // Decode failed - if buffer is too large, trim it to prevent memory issues
        if (this.buffer.length >= this.config.maxBufferSize) {
          // Keep the last portion in case it contains a frame start
          this.buffer = this.buffer.slice(-this.config.retainOnError);
        }
        // Otherwise keep accumulating - we might need more data
      });
  }

  /**
   * Handle natural stream end
   */
  private handleStreamEnd(): void {
    // Try to decode any remaining data
    if (this.buffer.length > 0) {
      const bufferCopy = this.buffer.buffer.slice(0) as ArrayBuffer;

      this.context
        .decodeAudioData(bufferCopy)
        .then((decoded) => {
          if (!this.abortController?.signal.aborted) {
            this.emitChunk(decoded);
          }
        })
        .catch(() => {
          // Final decode may fail with incomplete data - this is expected
        })
        .finally(() => {
          this.buffer = new Uint8Array(0);
          this.setStatus("ended");
          this.callbacks.onEnded?.();
        });
    } else {
      this.setStatus("ended");
      this.callbacks.onEnded?.();
    }
  }

  /**
   * Handle errors
   */
  private handleError(error: Error): void {
    this.setStatus("error");
    this.callbacks.onError?.(error);
    this.stop();
  }

  /**
   * Set status and notify listeners
   */
  private setStatus(status: StreamStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.callbacks.onStatus?.(status);
    }
  }

  /**
   * Emit a decoded chunk
   */
  private emitChunk(audioBuffer: AudioBuffer): void {
    this.callbacks.onChunk?.(audioBuffer);
  }
}

/**
 * Create a stream source
 *
 * Factory function for creating StreamSource instances.
 *
 * @param context - AudioContext for decoding
 * @param config - Stream configuration (url, sourceId, signal)
 * @param callbacks - Event callbacks
 * @param bufferConfig - Optional buffer configuration overrides
 */
export function createStreamSource(
  context: AudioContext,
  config: StreamSourceConfig,
  callbacks: StreamSourceCallbacks = {},
  bufferConfig: Partial<StreamBufferConfig> = {}
): StreamSource {
  return new StreamSource(context, config, callbacks, bufferConfig);
}
