import type { AudioContext, IAudioBuffer } from "standardized-audio-context";
import type { CacophonyEngine } from "./engine/cacophony-engine.js";

const appendBuffer = (
  buffer1: ArrayBuffer,
  buffer2: ArrayBuffer
): ArrayBuffer => {
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp.buffer;
};

// Minimum buffer size before attempting decode (64KB)
// This helps ensure we have enough data for compressed formats (MP3/AAC)
const MIN_DECODE_BUFFER_SIZE = 64 * 1024;

// Maximum buffer size before forcing a decode attempt (256KB)
// Prevents unbounded memory growth
const MAX_BUFFER_SIZE = 256 * 1024;

function handleStreamDone(
  signal: AbortSignal | undefined,
  abortListener: () => void
): void {
  signal?.removeEventListener("abort", abortListener);
}

/**
 * Creates a stream from a URL and feeds decoded audio chunks to the engine.
 * 
 * @param url - The URL to stream audio from
 * @param context - AudioContext for decoding audio data
 * @param engine - CacophonyEngine to send decoded chunks to
 * @param sourceId - The source ID to associate chunks with
 * @param signal - Optional AbortSignal to cancel the stream
 */
export function createStream(
  url: string,
  context: AudioContext,
  engine: CacophonyEngine,
  sourceId: string,
  signal?: AbortSignal
): void {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  // Check if already aborted
  if (signal?.aborted) {
    console.error(
      "Stream error:",
      new DOMException("Operation was aborted", "AbortError")
    );
    return;
  }

  fetch(url, signal ? { signal } : undefined)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error, status = ${response.status}`);
      }
      if (!response.body) {
        throw new Error("Missing body");
      }

      reader = response.body.getReader();
      
      // Accumulate chunks before decoding (for compressed formats like MP3/AAC)
      let accumulatedBuffer = new ArrayBuffer(0);
      let consecutiveDecodeErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 5; // Stop after 5 consecutive decode errors

      // Set up abort listener to cancel the reader
      const abortListener = () => {
        if (reader) {
          reader.cancel("Stream aborted").catch(() => {
            // Ignore cancel errors - reader might already be closed
          });
        }
      };

      signal?.addEventListener("abort", abortListener);

      function attemptDecode(buffer: ArrayBuffer): void {
        if (signal?.aborted) {
          return;
        }

        // Try to decode the accumulated buffer
        context
          .decodeAudioData(buffer.slice(0)) // Create a copy to avoid issues
          .then((decodedBuffer) => {
            if (signal?.aborted) {
              return;
            }
            
            // Success - reset error counter and send to engine
            consecutiveDecodeErrors = 0;
            engine.addStreamChunk(sourceId, decodedBuffer as IAudioBuffer);
            
            // Remove decoded portion from accumulated buffer
            // For compressed formats, we can't know exact decoded size, so clear buffer
            // The decoder will handle partial frames
            accumulatedBuffer = new ArrayBuffer(0);
          })
          .catch((err) => {
            consecutiveDecodeErrors++;
            
            // If we've had too many consecutive errors, stop trying
            if (consecutiveDecodeErrors >= MAX_CONSECUTIVE_ERRORS) {
              console.error(
                `Stream decode failed after ${MAX_CONSECUTIVE_ERRORS} attempts. This may indicate an unsupported format or corrupted stream.`,
                err
              );
              // Don't continue reading - the stream format is likely incompatible
              if (reader) {
                reader.cancel("Decode failed").catch(() => {
                  // Ignore cancel errors
                });
              }
              return;
            }
            
            // If buffer is getting too large, try to decode what we have
            // This handles cases where we never get a valid frame
            if (buffer.byteLength >= MAX_BUFFER_SIZE) {
              console.warn(
                `Buffer reached max size (${MAX_BUFFER_SIZE} bytes) without successful decode. This may indicate format issues.`
              );
              // Clear buffer to prevent unbounded growth, but continue trying
              accumulatedBuffer = new ArrayBuffer(0);
            }
            // Otherwise, continue accumulating - we might need more data
          });
      }

      function read() {
        if (signal?.aborted) {
          abortListener();
          return Promise.resolve();
        }

        return (
          reader
            ?.read()
            // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Complex stream reading with abort handling and chunk processing
            .then(({ value, done }) => {
              if (signal?.aborted) {
                abortListener();
                return;
              }

              if (done) {
                // Try to decode any remaining accumulated data
                if (accumulatedBuffer.byteLength > 0) {
                  attemptDecode(accumulatedBuffer);
                }
                handleStreamDone(signal, abortListener);
                return;
              }

              if (!value) {
                read();
                return;
              }

              // Accumulate the chunk
              accumulatedBuffer = appendBuffer(
                accumulatedBuffer,
                value.buffer as ArrayBuffer
              );

              // Try to decode if we have enough data
              if (
                accumulatedBuffer.byteLength >= MIN_DECODE_BUFFER_SIZE ||
                accumulatedBuffer.byteLength >= MAX_BUFFER_SIZE
              ) {
                attemptDecode(accumulatedBuffer);
              }

              // Continue reading
              read();
            })
            .catch((error) => {
              if (signal?.aborted || error.name === "AbortError") {
                // Expected abort, cleanup handled by abort listener
                return;
              }
              console.error("Stream read error:", error);
            })
        );
      }
      read();
    })
    .catch((error) => {
      console.error("Stream error:", error);
    });
}
