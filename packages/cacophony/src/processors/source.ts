import { type int } from "@opendaw/lib-std";

export abstract class Source {
  abstract process(
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): boolean; // Returns false if finished
}

export class BufferSource extends Source {
  private buffer: Float32Array[];
  private position: number = 0;
  private loop: boolean = false;
  private playbackRate: number = 1.0;
  private isPlaying: boolean = false; // Changed: Don't auto-play
  private isPaused: boolean = false;
  private pausePosition: number = 0;

  constructor(buffer: Float32Array[], options: { loop?: boolean; playbackRate?: number } = {}) {
    super();
    this.buffer = buffer;
    this.loop = options.loop ?? false;
    this.playbackRate = options.playbackRate ?? 1.0;
  }

  // Lifecycle methods
  start(when?: number, offset?: number, duration?: number) {
    this.isPlaying = true;
    this.isPaused = false;
    this.position = (offset ?? 0) * globalThis.sampleRate; // Convert seconds to samples
    // Note: 'when' and 'duration' would require more complex scheduling
    // For now, we start immediately and ignore duration
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.position = 0;
  }

  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.isPaused = true;
      this.pausePosition = this.position;
    }
  }

  resume() {
    if (this.isPaused) {
      this.isPaused = false;
      this.position = this.pausePosition;
    }
  }

  seek(positionInSeconds: number) {
    this.position = positionInSeconds * globalThis.sampleRate;
    this.pausePosition = this.position;
  }

  volume = 1.0;
  pan = 0.0; // -1 (left) to 1 (right)

  process(
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): boolean {
    // If paused, stay active but don't produce audio
    if (this.isPaused) return true;
    
    // If not playing, source is finished
    if (!this.isPlaying) return false;
    
    if (!outputL || !outputR) return false;

    const bufferL = this.buffer[0];
    if (!bufferL) return false;
    const bufferR = this.buffer[1] || bufferL; // Mono fallback
    const bufferLength = bufferL.length;

    // Calculate pan gains (constant power)
    // Simple linear for now, or equal power:
    // L = cos((pan + 1) * PI / 4)
    // R = sin((pan + 1) * PI / 4)
    // For simplicity/speed, let's use linear for now or simple balance
    // Let's use simple linear balance for speed in JS
    let gainL = this.volume;
    let gainR = this.volume;
    
    if (this.pan < 0) {
      gainR *= (1 + this.pan); // Pan left: reduce right
    } else if (this.pan > 0) {
      gainL *= (1 - this.pan); // Pan right: reduce left
    }

    for (let i = fromIndex; i < toIndex; i++) {
      if (this.position >= bufferLength) {
        if (this.loop) {
          this.position = 0;
        } else {
          this.isPlaying = false;
          return false;
        }
      }

      // Simple nearest-neighbor interpolation for now
      const readIndex = Math.floor(this.position);
      
      // Mix into output (additive) with volume/pan
      outputL[i]! += (bufferL[readIndex] ?? 0) * gainL;
      outputR[i]! += (bufferR[readIndex] ?? 0) * gainR;

      this.position += this.playbackRate;
    }

    return true;
  }
}

export class StreamSource extends Source {
  private chunks: Float32Array[][] = [];
  private currentChunkIndex: number = 0;
  private currentSampleIndex: number = 0;
  private isPlaying: boolean = false; // Start paused, consistent with BufferSource
  private isPaused: boolean = false;

  // Volume and pan for per-source control
  volume = 1.0;
  pan = 0.0; // -1 (left) to 1 (right)

  constructor() {
    super();
  }

  // Lifecycle methods - consistent with BufferSource
  start() {
    this.isPlaying = true;
    this.isPaused = false;
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.chunks = [];
    this.currentChunkIndex = 0;
    this.currentSampleIndex = 0;
  }

  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.isPaused = true;
    }
  }

  resume() {
    if (this.isPaused) {
      this.isPaused = false;
    }
  }

  addChunk(chunk: Float32Array[]) {
    this.chunks.push(chunk);
  }

  process(
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): boolean {
    // If paused, stay active but don't produce audio
    if (this.isPaused) return true;
    
    // If not playing, keep alive to receive chunks (streams can restart)
    if (!this.isPlaying) return true;
    
    if (!outputL || !outputR) return false;

    // Calculate pan gains (simple linear balance)
    let gainL = this.volume;
    let gainR = this.volume;
    
    if (this.pan < 0) {
      gainR *= (1 + this.pan); // Pan left: reduce right
    } else if (this.pan > 0) {
      gainL *= (1 - this.pan); // Pan right: reduce left
    }

    for (let i = fromIndex; i < toIndex; i++) {
      if (this.currentChunkIndex >= this.chunks.length) {
        // Underrun - keep alive waiting for more chunks
        return true; 
      }

      const chunk = this.chunks[this.currentChunkIndex];
      if (!chunk) return true; // Safety check

      const chunkL = chunk[0];
      if (!chunkL) return true;
      const chunkR = chunk[1] || chunkL;

      // Apply volume and pan
      outputL[i]! += (chunkL[this.currentSampleIndex] ?? 0) * gainL;
      outputR[i]! += ((chunkR ? chunkR[this.currentSampleIndex] : chunkL[this.currentSampleIndex]) ?? 0) * gainR;

      this.currentSampleIndex++;

      if (this.currentSampleIndex >= chunkL.length) {
        this.currentChunkIndex++;
        this.currentSampleIndex = 0;
        // Clean up old chunks to save memory
        if (this.currentChunkIndex > 10) {
            this.chunks.splice(0, 5);
            this.currentChunkIndex -= 5;
        }
      }
    }

    return true;
  }
}
