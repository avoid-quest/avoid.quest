import type { AudioContext, IAudioBuffer } from "standardized-audio-context";
import type { CacophonyEngine } from "./engine/cacophony-engine.js";

// Minimum buffer size before attempting decode (128KB - enough for compressed formats)
const MIN_BUFFER_SIZE = 128 * 1024;
// Maximum buffer size before clearing (512KB - prevent unbounded growth)
const MAX_BUFFER_SIZE = 512 * 1024;

/**
 * Creates a stream from a URL and feeds decoded audio chunks to the engine.
 * Simple approach: accumulate data, decode when we have enough, send chunks to engine.
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
  if (signal?.aborted) {
    return;
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let buffer = new Uint8Array(0);
  let decoding = false;

  fetch(url, signal ? { signal } : undefined)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      if (!response.body) {
        throw new Error("No response body");
      }

      reader = response.body.getReader();

      const abortListener = () => {
        reader?.cancel("Aborted").catch(() => {});
      };
      signal?.addEventListener("abort", abortListener);

      async function tryDecode(): Promise<void> {
        if (decoding || signal?.aborted || buffer.length < MIN_BUFFER_SIZE) {
          return;
        }

        decoding = true;

        try {
          const decoded = await context.decodeAudioData(buffer.buffer.slice(0));
          
          if (signal?.aborted) {
            decoding = false;
            return;
          }

          engine.addStreamChunk(sourceId, decoded as IAudioBuffer);
          
          // Clear buffer after successful decode
          // decodeAudioData doesn't tell us consumption, so we clear and start fresh
          buffer = new Uint8Array(0);
          decoding = false;
        } catch (err) {
          decoding = false;
          
          // Decode failed - clear buffer if too large to prevent memory issues
          if (buffer.length >= MAX_BUFFER_SIZE) {
            // Keep last 64KB in case it contains frame start
            buffer = buffer.slice(-64 * 1024);
          }
          // Otherwise keep accumulating - might need more data
        }
      }

      function read(): void {
        if (signal?.aborted) {
          return;
        }

        reader
          ?.read()
          .then(({ value, done }) => {
            if (signal?.aborted) {
              return;
            }

            if (done) {
              // Try final decode
              if (buffer.length > 0) {
                context
                  .decodeAudioData(buffer.buffer.slice(0))
                  .then((decoded) => {
                    if (!signal?.aborted) {
                      engine.addStreamChunk(sourceId, decoded as IAudioBuffer);
                    }
                  })
                  .catch(() => {});
              }
              signal?.removeEventListener("abort", abortListener);
              return;
            }

            if (value) {
              // Append to buffer
              const newBuffer = new Uint8Array(buffer.length + value.length);
              newBuffer.set(buffer, 0);
              newBuffer.set(value, buffer.length);
              buffer = newBuffer;

              // Try decode if we have enough data
              if (buffer.length >= MIN_BUFFER_SIZE) {
                tryDecode();
              }
            }

            read();
          })
          .catch((error) => {
            if (!signal?.aborted && error.name !== "AbortError") {
              console.error("Stream read error:", error);
            }
          });
      }

      read();
    })
    .catch((error) => {
      console.error("Stream fetch error:", error);
    });
}
