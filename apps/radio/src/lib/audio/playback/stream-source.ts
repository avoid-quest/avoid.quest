/**
 * Stream Source
 *
 * Handles fetching and decoding of Icecast audio streams (MP3, OGG/Vorbis).
 * Accumulates data, decodes when buffer is sufficient, and emits decoded audio chunks.
 *
 * For OGG/Vorbis streams, header data from the first successful decode is retained
 * and prepended to subsequent chunks, as decodeAudioData() requires codec headers.
 */

import {
  defaultStreamBufferConfig,
  type StreamBufferConfig,
  type StreamSourceConfig,
  type StreamStatus,
} from "./types.js";

// OGG page magic bytes: "OggS"
const OGG_MAGIC_0 = 0x4f; // 'O'
const OGG_MAGIC_1 = 0x67; // 'g'
const OGG_MAGIC_2 = 0x67; // 'g'
const OGG_MAGIC_3 = 0x53; // 'S'

// MP3 frame sync detection
// MP3 frames start with 0xFF followed by 0xE0-0xFF (11 sync bits)
const MP3_SYNC_BYTE1 = 0xff;
const MP3_SYNC_MASK = 0xe0; // Top 3 bits of second byte must be 111

/**
 * Find the next MP3 frame sync position in buffer.
 * MP3 frames start with 11 sync bits (0xFF followed by 0xE0+).
 * Returns byte offset of frame start, or -1 if not found.
 */
function findMp3FrameSync(buffer: Uint8Array, startOffset = 0): number {
  for (let i = startOffset; i < buffer.length - 1; i++) {
    if (
      buffer[i] === MP3_SYNC_BYTE1 &&
      // biome-ignore lint/suspicious/noBitwiseOperators: Intentional bitwise AND for MP3 frame sync
      ((buffer[i + 1] ?? 0) & MP3_SYNC_MASK) === MP3_SYNC_MASK
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Check if buffer looks like MP3 data (has frame sync in first 4KB)
 */
function looksLikeMp3(buffer: Uint8Array): boolean {
  return findMp3FrameSync(buffer, 0) !== -1;
}

/**
 * Find OGG Vorbis header boundary in buffer.
 * OGG header pages have granule_position = 0, audio pages have granule > 0.
 * Returns byte offset where audio data begins (end of headers).
 * Returns null if not OGG or headers incomplete.
 */
function findOggHeaderEnd(buffer: Uint8Array): number | null {
  // Check if this looks like OGG (minimum page header is 27 bytes)
  if (
    buffer.length < 27 ||
    buffer[0] !== OGG_MAGIC_0 ||
    buffer[1] !== OGG_MAGIC_1 ||
    buffer[2] !== OGG_MAGIC_2 ||
    buffer[3] !== OGG_MAGIC_3
  ) {
    return null; // Not OGG
  }

  // Use DataView for reading little-endian values
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  let offset = 0;

  while (offset + 27 < buffer.length) {
    // Verify OggS magic at current offset
    if (
      buffer[offset] !== OGG_MAGIC_0 ||
      buffer[offset + 1] !== OGG_MAGIC_1 ||
      buffer[offset + 2] !== OGG_MAGIC_2 ||
      buffer[offset + 3] !== OGG_MAGIC_3
    ) {
      // Lost sync - shouldn't happen in valid OGG
      return null;
    }

    // Read granule_position (bytes 6-13, little-endian int64)
    // We read as two 32-bit values and check if either is > 0
    const granuleLow = view.getUint32(offset + 6, true);
    const granuleHigh = view.getUint32(offset + 10, true);

    // If granule > 0, this is first audio page - headers end here
    if (granuleLow > 0 || granuleHigh > 0) {
      return offset;
    }

    // Read number of segments to calculate page size
    const numSegments = buffer[offset + 26];
    if (offset + 27 + numSegments > buffer.length) {
      return null; // Need more data
    }

    // Calculate total page size: header (27) + segment table + segment data
    let pageSize = 27 + numSegments;
    for (let i = 0; i < numSegments; i++) {
      pageSize += buffer[offset + 27 + i];
    }

    offset += pageSize;
  }

  return null; // Headers incomplete - need more data
}

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
  /** Emitted when pre-buffer threshold is reached */
  preBufferReady: () => void;
  /** Emitted when buffer level changes (for UI) */
  bufferLevel: (level: { chunks: number; isBuffering: boolean }) => void;
};

/**
 * Callback types for StreamSource
 */
export type StreamSourceCallbacks = {
  onChunk?: (audioBuffer: AudioBuffer) => void;
  onStatus?: (status: StreamStatus) => void;
  onError?: (error: Error) => void;
  onEnded?: () => void;
  onPreBufferReady?: () => void;
  onBufferLevel?: (level: { chunks: number; isBuffering: boolean }) => void;
};

/**
 * StreamSource class for handling Icecast audio streaming
 *
 * Fetches audio data from a URL, accumulates it in a buffer,
 * decodes when enough data is available, and emits decoded chunks.
 * Supports both MP3 (self-sync frames) and OGG/Vorbis (header retention).
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
  private headerData: Uint8Array | null = null;
  private decoding = false;
  private _status: StreamStatus = "idle";
  private hasEmittedFirstChunk = false;

  // Pre-buffering state
  private _chunkCount = 0;
  private _isPreBufferReady = false;
  private _isBuffering = false;

  private isMp3Stream: boolean | null = null; // Detected on first successful decode

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
   * Get current chunk count
   */
  get chunkCount(): number {
    return this._chunkCount;
  }

  /**
   * Check if pre-buffer threshold has been reached
   */
  get isPreBufferReady(): boolean {
    return this._isPreBufferReady;
  }

  /**
   * Check if currently in buffering state (recovering from underrun)
   */
  get isBuffering(): boolean {
    return this._isBuffering;
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
    this.headerData = null;
    this.hasEmittedFirstChunk = false;
    this._chunkCount = 0;
    this._isPreBufferReady = false;
    this._isBuffering = false;
    this.isMp3Stream = null;
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
    this.headerData = null;
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

    // For OGG/Vorbis: prepend header data to buffer before decode
    // OGG requires codec headers in every decode call, unlike MP3 which is self-sync
    let decodeBuffer = this.buffer;
    if (this.headerData && this.hasEmittedFirstChunk) {
      decodeBuffer = new Uint8Array(
        this.headerData.length + this.buffer.length
      );
      decodeBuffer.set(this.headerData, 0);
      decodeBuffer.set(this.buffer, this.headerData.length);
    }

    // Create a copy of the buffer for decoding
    // Use slice with explicit bounds for TypedArray backed by larger ArrayBuffer
    const bufferCopy = decodeBuffer.buffer.slice(
      decodeBuffer.byteOffset,
      decodeBuffer.byteOffset + decodeBuffer.byteLength
    ) as ArrayBuffer;

    this.context
      .decodeAudioData(bufferCopy)
      .then((decoded) => {
        if (this.abortController?.signal.aborted) {
          this.decoding = false;
          return;
        }

        // For OGG: extract and save only the header pages (not audio data)
        // This prevents audio repetition when prepending headers to subsequent chunks
        if (!this.hasEmittedFirstChunk) {
          const headerEnd = findOggHeaderEnd(this.buffer);
          if (headerEnd !== null && headerEnd > 0) {
            this.headerData = new Uint8Array(this.buffer.slice(0, headerEnd));
          }
        }

        // Emit the decoded chunk
        this.emitChunk(decoded);

        // Clear buffer after successful decode (headers preserved in headerData)
        this.buffer = new Uint8Array(0);
        this.decoding = false;

        // Detect stream type on first successful decode
        if (this.isMp3Stream === null) {
          this.isMp3Stream = this.headerData === null; // MP3 has no OGG headers
        }

        // Update status to streaming after first successful decode
        if (!this.hasEmittedFirstChunk) {
          this.hasEmittedFirstChunk = true;
          this.setStatus("streaming");
        }
      })
      .catch(() => {
        this.decoding = false;

        // Progressive error handling to avoid abrupt audio jumps
        this.handleDecodeFailure();
      });
  }

  /**
   * Handle decode failures with progressive trimming
   * Instead of abruptly cutting buffer, try to find valid frame boundaries
   */
  private handleDecodeFailure(): void {
    const bufferLength = this.buffer.length;

    // If buffer is small, just accumulate more data
    if (bufferLength < this.config.maxBufferSize) {
      return;
    }

    // Detect if this is MP3 data
    const isMp3 = this.isMp3Stream ?? looksLikeMp3(this.buffer);

    if (isMp3) {
      // For MP3: try to find next frame sync and trim to that point
      // This preserves frame alignment and reduces audio glitches
      const trimTarget = Math.floor(bufferLength * 0.75); // Keep 75% of buffer
      const syncPos = findMp3FrameSync(this.buffer, bufferLength - trimTarget);

      if (syncPos !== -1) {
        // Found a frame sync - trim to that position
        this.buffer = this.buffer.slice(syncPos);
      } else {
        // No sync found - use progressive trim (keep more data than before)
        const keepAmount = Math.max(
          this.config.retainOnError,
          Math.floor(bufferLength * 0.5)
        );
        this.buffer = this.buffer.slice(-keepAmount);
      }
    } else {
      // For OGG/other formats: progressive trim keeping more data
      // OGG needs headers, so we can't easily resync
      const keepAmount = Math.max(
        this.config.retainOnError,
        Math.floor(bufferLength * 0.5)
      );
      this.buffer = this.buffer.slice(-keepAmount);
    }
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
    this._chunkCount++;

    // Check if we've reached pre-buffer threshold
    if (
      !this._isPreBufferReady &&
      this._chunkCount >= this.config.minPreBufferChunks
    ) {
      this._isPreBufferReady = true;
      this.callbacks.onPreBufferReady?.();
    }

    // Update buffering state based on watermarks
    this.updateBufferingState();

    this.callbacks.onChunk?.(audioBuffer);
  }

  /**
   * Called by audio-manager when a chunk is consumed by the worklet
   */
  notifyChunkConsumed(): void {
    if (this._chunkCount > 0) {
      this._chunkCount--;
      this.updateBufferingState();
    }
  }

  /**
   * Update buffering state based on watermarks
   */
  private updateBufferingState(): void {
    const wasBuffering = this._isBuffering;

    if (this._chunkCount <= this.config.lowWatermarkChunks) {
      this._isBuffering = true;
    } else if (this._chunkCount >= this.config.highWatermarkChunks) {
      this._isBuffering = false;
    }

    // Emit buffer level if changed or if we have a listener
    if (wasBuffering !== this._isBuffering || this.callbacks.onBufferLevel) {
      this.callbacks.onBufferLevel?.({
        chunks: this._chunkCount,
        isBuffering: this._isBuffering,
      });
    }
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
