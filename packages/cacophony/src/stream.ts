import type { AudioContext, IAudioBuffer } from "standardized-audio-context";

const appendBuffer = (
  buffer1: ArrayBuffer,
  buffer2: ArrayBuffer
): ArrayBuffer => {
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp.buffer;
};

function processStreamChunk(
  value: Uint8Array,
  header: ArrayBuffer
): { buffer: ArrayBuffer; header: ArrayBuffer } | null {
  let audioBuffer: ArrayBuffer;
  let newHeader = header;

  if (header.byteLength) {
    audioBuffer = appendBuffer(
      header,
      value.buffer as ArrayBuffer
    ) as ArrayBuffer;
  } else {
    //copy first 44 bytes (wav header)
    newHeader = value.buffer.slice(0, 44) as ArrayBuffer;
    audioBuffer = value.buffer as ArrayBuffer;
  }

  return { buffer: audioBuffer, header: newHeader };
}

type DecodeAndScheduleOptions = {
  context: AudioContext;
  audioBuffer: ArrayBuffer;
  audioStack: IAudioBuffer[];
  scheduleBuffers: () => void;
  signal?: AbortSignal;
};

function handleStreamDone(
  signal: AbortSignal | undefined,
  abortListener: () => void
): void {
  console.log("done");
  signal?.removeEventListener("abort", abortListener);
}

function decodeAndSchedule(options: DecodeAndScheduleOptions): void {
  const { context, audioBuffer, audioStack, scheduleBuffers, signal } = options;
  context.decodeAudioData(
    audioBuffer,
    (buffer) => {
      if (signal?.aborted) {
        return;
      }

      audioStack.push(buffer);
      if (audioStack.length) {
        scheduleBuffers();
      }
    },
    (err) => {
      console.log(`err(decodeAudioData): ${err}`);
    }
  );
}

export function createStream(
  url: string,
  context: AudioContext,
  signal?: AbortSignal
) {
  const audioStack: IAudioBuffer[] = [];
  let nextTime = 0;
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
      let header = new ArrayBuffer(0); //first 44bytes

      // Set up abort listener to cancel the reader
      const abortListener = () => {
        audioStack.length = 0; // Clear decoded buffers to free memory
        if (reader) {
          reader.cancel("Stream aborted").catch(() => {
            // Ignore cancel errors - reader might already be closed
          });
        }
      };

      signal?.addEventListener("abort", abortListener);

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
                handleStreamDone(signal, abortListener);
                return;
              }

              if (!value) {
                read();
                return;
              }

              const result = processStreamChunk(value, header);
              if (result) {
                header = result.header;
                decodeAndSchedule({
                  context,
                  audioBuffer: result.buffer,
                  audioStack,
                  scheduleBuffers,
                  signal,
                });
              }
              //read next buffer
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

  function scheduleBuffers() {
    while (audioStack.length) {
      const buffer = audioStack.shift();
      const source = context.createBufferSource();
      if (!buffer) {
        return;
      }
      source.buffer = buffer;
      source.connect(context.destination);
      if (nextTime === 0) {
        nextTime = context.currentTime + 0.02; /// add 50ms latency to work well across systems - tune this if you like
      }
      source.start(nextTime);
      nextTime += source.buffer.duration; // Make the next buffer wait the length of the last buffer before being played
    }
  }
}
