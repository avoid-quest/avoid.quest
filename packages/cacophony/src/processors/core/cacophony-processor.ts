import { 
  MessageType, 
  type Message, 
  type LoadBufferPayload,
  type StartSourcePayload,
  type StopSourcePayload,
  type PauseSourcePayload,
  type ResumeSourcePayload,
  type SeekSourcePayload,
  type SetSourceVolumePayload,
  type SetSourcePanPayload,
  type SourceEndedPayload,
} from "../../protocol.js";

// Basic AudioWorkletProcessor definition since we don't have the types globally available yet
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor
): void;

import { ChannelStrip } from "../channel-strip.js";
import { Source, BufferSource, StreamSource } from "../source.js";
import { Delay } from "../effects/delay.js";

export class CacophonyProcessor extends AudioWorkletProcessor {
  // Buffer registry
  private buffers: Map<string, Float32Array[]> = new Map();
  private sources: Map<string, Source> = new Map();
  private sourceStates = new Map<string, {
    playing: boolean;
    paused: boolean;
    offset: number;
    startTime: number;
  }>();
  private channelStrip: ChannelStrip;
  private delay: Delay;

  constructor() {
    super();
    this.port.onmessage = this.handleMessage.bind(this);
    // Initialize with default sample rate (usually 44100 or 48000)
    // In a real worklet, globalThis.sampleRate is available
    this.channelStrip = new ChannelStrip(globalThis.sampleRate);
    this.delay = new Delay(globalThis.sampleRate * 2, 128); // 2 seconds max delay
  }

  private handleMessage(event: MessageEvent<Message>) {
    const { type, payload } = event.data;

    switch (type) {
      case MessageType.LOAD_BUFFER:
        this.handleLoadBuffer(payload);
        break;
      case MessageType.SET_PARAM:
        this.handleSetParam(payload);
        break;
      case MessageType.CREATE_SOURCE:
        this.handleCreateSource(payload);
        break;
      case MessageType.ADD_STREAM_CHUNK:
        this.handleAddStreamChunk(payload);
        break;
      case MessageType.START_SOURCE:
        this.handleStartSource(payload);
        break;
      case MessageType.STOP_SOURCE:
        this.handleStopSource(payload);
        break;
      case MessageType.PAUSE_SOURCE:
        this.handlePauseSource(payload);
        break;
      case MessageType.RESUME_SOURCE:
        this.handleResumeSource(payload);
        break;
      case MessageType.SEEK_SOURCE:
      this.handleSeekSource(payload);
      break;
    case MessageType.SET_SOURCE_VOLUME:
      this.handleSetSourceVolume(payload);
      break;
    case MessageType.SET_SOURCE_PAN:
      this.handleSetSourcePan(payload);
      break;
    }
  }

  private handleLoadBuffer(payload: LoadBufferPayload) {
    this.buffers.set(payload.id, payload.buffer);
  }

  private handleCreateSource(payload: any) {
    if (payload.options?.type === "stream") {
        const source = new StreamSource();
        this.sources.set(payload.id, source);
        // Initialize state but don't auto-start
        this.sourceStates.set(payload.id, {
          playing: false,
          paused: false,
          offset: 0,
          startTime: 0,
        });
    } else {
        const buffer = this.buffers.get(payload.bufferId);
        if (buffer) {
          const source = new BufferSource(buffer, payload.options);
          this.sources.set(payload.id, source);
          // Initialize state but don't auto-start
          this.sourceStates.set(payload.id, {
            playing: false,
            paused: false,
            offset: 0,
            startTime: 0,
          });
        }
    }
  }

  private handleAddStreamChunk(payload: any) {
    const source = this.sources.get(payload.sourceId);
    if (source && source instanceof StreamSource) {
        source.addChunk(payload.chunk);
    }
  }

  private handleSetParam(payload: any) {
    if (payload.target === "channelStrip.volume") {
      this.channelStrip.setVolume(payload.value);
    } else if (payload.target === "channelStrip.pan") {
      this.channelStrip.setPan(payload.value);
    } else if (payload.target === "delay.time") {
      this.delay.offset = payload.value * globalThis.sampleRate;
    } else if (payload.target === "delay.feedback") {
      this.delay.feedback = payload.value;
    } else if (payload.target === "delay.mix") {
      this.delay.mix(payload.value, 1 - payload.value);
    }
  }

  private handleStartSource(payload: StartSourcePayload) {
    const source = this.sources.get(payload.sourceId);
    const state = this.sourceStates.get(payload.sourceId);
    
    if (source && state) {
      if (source instanceof BufferSource) {
        source.start(payload.when, payload.offset, payload.duration);
        state.offset = payload.offset || 0;
        state.startTime = payload.when || 0;
      } else if (source instanceof StreamSource) {
        source.start();
      }
      state.playing = true;
      state.paused = false;
    }
  }

  private handleStopSource(payload: StopSourcePayload) {
    const source = this.sources.get(payload.sourceId);
    const state = this.sourceStates.get(payload.sourceId);
    
    if (source && state) {
      if (source instanceof BufferSource) {
        source.stop();
      } else if (source instanceof StreamSource) {
        source.stop();
      }
      state.playing = false;
      state.paused = false;
      
      // Emit SOURCE_ENDED event
      this.port.postMessage({
        type: MessageType.SOURCE_ENDED,
        payload: {
          sourceId: payload.sourceId,
          reason: 'stopped',
        } as SourceEndedPayload,
      });
    }
  }

  private handlePauseSource(payload: PauseSourcePayload) {
    const source = this.sources.get(payload.sourceId);
    const state = this.sourceStates.get(payload.sourceId);
    
    if (source && state) {
      if (source instanceof BufferSource) {
        source.pause();
      } else if (source instanceof StreamSource) {
        source.pause();
      }
      state.playing = false;
      state.paused = true;
    }
  }

  private handleResumeSource(payload: ResumeSourcePayload) {
    const source = this.sources.get(payload.sourceId);
    const state = this.sourceStates.get(payload.sourceId);
    
    if (source && state) {
      if (source instanceof BufferSource) {
        source.resume();
      } else if (source instanceof StreamSource) {
        source.resume();
      }
      state.playing = true;
      state.paused = false;
    }
  }

  private handleSeekSource(payload: SeekSourcePayload) {
    const source = this.sources.get(payload.sourceId);
    const state = this.sourceStates.get(payload.sourceId);
    
    if (source && state && source instanceof BufferSource) {
      source.seek(payload.position);
      state.offset = payload.position;
    }
  }

  private handleSetSourceVolume(payload: SetSourceVolumePayload) {
    const source = this.sources.get(payload.sourceId);
    if (source) {
      if (source instanceof BufferSource || source instanceof StreamSource) {
        source.volume = payload.volume;
      }
    }
  }

  private handleSetSourcePan(payload: SetSourcePanPayload) {
    const source = this.sources.get(payload.sourceId);
    if (source) {
      if (source instanceof BufferSource || source instanceof StreamSource) {
        source.pan = payload.pan;
      }
    }
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    const output = outputs[0];
    if (!output) return true;
    const outputL = output[0];
    const outputR = output[1];

    if (!output || !outputL || !outputR) return true;

    // Mix all sources
    // First, clear the output buffer (it might contain garbage or previous data)
    outputL.fill(0);
    outputR.fill(0);

    // Mix input from AudioWorkletNode connections (e.g. MediaElementSource)
    const input = inputs[0];
    if (input && input.length > 0) {
      const inputL = input[0];
      const inputR = input[1] || input[0]; // Fallback to mono if only 1 channel

      if (inputL) {
        for (let i = 0; i < outputL.length; i++) {
          outputL[i] = (outputL[i] ?? 0) + (inputL[i] ?? 0);
        }
      }
      if (inputR) {
        for (let i = 0; i < outputR.length; i++) {
          outputR[i] = (outputR[i] ?? 0) + (inputR[i] ?? 0);
        }
      }
    }

    const sourcesToRemove: string[] = [];

    for (const [id, source] of this.sources) {
      const active = source.process(outputL, outputR, 0, outputL.length);
      if (!active) {
        sourcesToRemove.push(id);
      }
    }

    // Remove finished sources and emit events
    for (const id of sourcesToRemove) {
      this.sources.delete(id);
      this.sourceStates.delete(id);
      
      // Emit SOURCE_ENDED event
      this.port.postMessage({
        type: MessageType.SOURCE_ENDED,
        payload: {
          sourceId: id,
          reason: 'finished',
        } as SourceEndedPayload,
      });
    }
    
    // Apply Effects
    // Delay (Mono for now, applied to both channels equally or just L? Let's do stereo delay later)
    // For now, simple mono delay on L and R independently or summed?
    // Let's just apply to L and R independently for simplicity in this step
    this.delay.process(outputL, outputL, 0, outputL.length);
    // Note: We need a second delay instance for stereo or a stereo delay class. 
    // For this proof of concept, applying to L only or sharing state is weird.
    // Let's skip R delay processing for a moment or use the same delay (weird)
    // Ideally we'd have StereoDelay.
    
    // Apply Channel Strip (Volume, Pan, etc.)
    // Note: We are processing in-place on the output buffer
    this.channelStrip.process(
        outputL, // Input L (mixed sources)
        outputR, // Input R (mixed sources)
        outputL, // Output L
        outputR, // Output R
        0,
        outputL.length
    );

    return true;
  }
}

registerProcessor("cacophony-processor", CacophonyProcessor);
