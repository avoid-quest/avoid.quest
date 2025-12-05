import { type int } from "@opendaw/lib-std";
import { BiquadFilter, type BiquadFilterType } from "./effects/biquad-filter.js";

export abstract class Source {
  protected filters: Map<string, BiquadFilter> = new Map();
  // Filter chain order - array of IDs
  protected filterOrder: string[] = [];

  abstract process(
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): boolean; // Returns false if finished

  addFilter(id: string, type: BiquadFilterType, freq: number, Q: number, gain: number) {
    const filter = new BiquadFilter(globalThis.sampleRate);
    filter.type = type;
    filter.frequency = freq;
    filter.Q = Q;
    filter.gain = gain;
    this.filters.set(id, filter);
    this.filterOrder.push(id);
  }

  removeFilter(id: string) {
    this.filters.delete(id);
    this.filterOrder = this.filterOrder.filter(fid => fid !== id);
  }

  setFilterParam(id: string, param: string, value: number | string) {
    const filter = this.filters.get(id);
    if (!filter) return;

    switch (param) {
      case 'frequency': filter.frequency = value as number; break;
      case 'Q': filter.Q = value as number; break;
      case 'gain': filter.gain = value as number; break;
      case 'type': filter.type = value as BiquadFilterType; break;
    }
  }

  /**
   * Applies filters in chain order to the input buffers (in-place)
   */
  protected applyFilters(
    bufferL: Float32Array,
    bufferR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): void {
    if (this.filterOrder.length === 0) return;

    for (const id of this.filterOrder) {
      const filter = this.filters.get(id);
      if (filter) {
        // Process in-place: input and output are same arrays
        filter.process(bufferL, bufferR, bufferL, bufferR, fromIndex, toIndex);
      }
    }
  }
}

export class BufferSource extends Source {
  private buffer: Float32Array[];
  private position: number = 0;
  private loop: boolean = false;
  private playbackRate: number = 1.0;
  private isPlaying: boolean = false; 
  private isPaused: boolean = false;
  private pausePosition: number = 0;
  
  // Internal buffers for processing before mixing
  private tempL: Float32Array | null = null;
  private tempR: Float32Array | null = null;

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
    this.position = (offset ?? 0) * globalThis.sampleRate;
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.position = 0;
    // Reset filters
    for (const filter of this.filters.values()) filter.reset();
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

    // Initialize temp buffers if needed
    if (!this.tempL || this.tempL.length < outputL.length) {
      this.tempL = new Float32Array(outputL.length);
      this.tempR = new Float32Array(outputR.length);
    }
    
    // Clear temp buffers for this block
    this.tempL!.fill(0, fromIndex, toIndex);
    this.tempR!.fill(0, fromIndex, toIndex);

    const bufferL = this.buffer[0];
    if (!bufferL) return false;
    const bufferR = this.buffer[1] || bufferL; // Mono fallback
    const bufferLength = bufferL.length;

    // Generate audio into temp buffers
    for (let i = fromIndex; i < toIndex; i++) {
        if (this.position >= bufferLength) {
            if (this.loop) {
              this.position = 0;
            } else {
              this.isPlaying = false;
              // If stopped mid-block, we still process what we have so far
              // But we can break generation here.
              // We should still process filters on the silence? Or just break.
              // Breaking is fine.
              break; 
            }
        }
        
        const readIndex = Math.floor(this.position);
        this.tempL![i] = bufferL[readIndex] ?? 0;
        this.tempR![i] = bufferR[readIndex] ?? 0;
        
        this.position += this.playbackRate;
    }

    // Apply filters to temp buffers
    this.applyFilters(this.tempL!, this.tempR!, fromIndex, toIndex);

    // Apply volume/pan and mix to output
    let gainL = this.volume;
    let gainR = this.volume;
    
    if (this.pan < 0) {
      gainR *= (1 + this.pan);
    } else if (this.pan > 0) {
      gainL *= (1 - this.pan);
    }

    for (let i = fromIndex; i < toIndex; i++) {
      outputL[i]! += this.tempL![i]! * gainL;
      outputR[i]! += this.tempR![i]! * gainR;
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
  
  // Internal buffers
  private tempL: Float32Array | null = null;
  private tempR: Float32Array | null = null;

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
    // Reset filters
    for (const filter of this.filters.values()) filter.reset();
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

    // Initialize temp buffers if needed
    if (!this.tempL || this.tempL.length < outputL.length) {
      this.tempL = new Float32Array(outputL.length);
      this.tempR = new Float32Array(outputR.length);
    }
    
    // Clear temp buffers for this block
    this.tempL!.fill(0, fromIndex, toIndex);
    this.tempR!.fill(0, fromIndex, toIndex);

    for (let i = fromIndex; i < toIndex; i++) {
      if (this.currentChunkIndex >= this.chunks.length) {
        // Underrun - can't fetch more data
        // We still process what we have written so far to temp buffers (which is nothing for the remaining part)
        // Actually we initialized to 0, so it's silence.
        break; 
      }

      const chunk = this.chunks[this.currentChunkIndex];
      if (!chunk) break; 

      const chunkL = chunk[0];
      if (!chunkL) break;
      const chunkR = chunk[1] || chunkL;

      // Copy audio to temp buffers
      this.tempL![i] = chunkL[this.currentSampleIndex] ?? 0;
      this.tempR![i] = (chunkR ? chunkR[this.currentSampleIndex] : chunkL[this.currentSampleIndex]) ?? 0;

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
    
    // Apply filters
    this.applyFilters(this.tempL!, this.tempR!, fromIndex, toIndex);

    // Calculate pan gains (simple linear balance)
    let gainL = this.volume;
    let gainR = this.volume;
    
    if (this.pan < 0) {
      gainR *= (1 + this.pan); // Pan left: reduce right
    } else if (this.pan > 0) {
      gainL *= (1 - this.pan); // Pan right: reduce left
    }

    // Mix to output
    for (let i = fromIndex; i < toIndex; i++) {
        outputL[i]! += this.tempL![i]! * gainL;
        outputR[i]! += this.tempR![i]! * gainR;
    }

    return true;
  }
}
