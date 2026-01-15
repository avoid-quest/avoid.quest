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
  type StreamReadyPayload,
  type CreateOscillatorSourcePayload,
  type SetOscillatorFrequencyPayload,
  type SetOscillatorDetunePayload,
  type SetOscillatorTypePayload,
  type AddFilterPayload,
  type RemoveFilterPayload,
  type SetFilterParamPayload,
  type AddEffectPayload,
  type RemoveEffectPayload,
  type UpdateEffectPayload,
  type ReorderEffectsPayload,
} from "../../protocol.js";
import { type BiquadFilterType } from "../effects/biquad-filter.js";

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
import { OscillatorSource } from "../oscillator-source.js";

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
  private streamFirstChunkReceived = new Map<string, boolean>();
  private channelStrip: ChannelStrip;

  constructor() {
    super();
    this.port.onmessage = this.handleMessage.bind(this);
    // Initialize with default sample rate (usually 44100 or 48000)
    // In a real worklet, globalThis.sampleRate is available
    this.channelStrip = new ChannelStrip(globalThis.sampleRate);
  }

  private handleMessage(event: MessageEvent<Message>) {
    if (!event.data) {
      console.warn("Received null message in worklet");
      return;
    }
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
    case MessageType.CREATE_OSCILLATOR_SOURCE:
      this.handleCreateOscillatorSource(payload);
      break;
    case MessageType.SET_OSCILLATOR_FREQUENCY:
      this.handleSetOscillatorFrequency(payload);
      break;
    case MessageType.SET_OSCILLATOR_DETUNE:
      this.handleSetOscillatorDetune(payload);
      break;
    case MessageType.SET_OSCILLATOR_TYPE:
      this.handleSetOscillatorType(payload);
      break;
    case MessageType.ADD_FILTER:
      this.handleAddFilter(payload);
      break;
    case MessageType.REMOVE_FILTER:
      this.handleRemoveFilter(payload);
      break;
      case MessageType.SET_FILTER_PARAM:
        this.handleSetFilterParam(payload);
        break;
      case MessageType.ADD_EFFECT:
        this.handleAddEffect(payload);
        break;
      case MessageType.REMOVE_EFFECT:
        this.handleRemoveEffect(payload);
        break;
      case MessageType.UPDATE_EFFECT:
        this.handleUpdateEffect(payload);
        break;
      case MessageType.REORDER_EFFECTS:
        this.handleReorderEffects(payload);
        break;
    }
  }

  private handleAddFilter(payload: AddFilterPayload) {
    const source = this.sources.get(payload.sourceId);
    if (source) {
      source.addFilter(
        payload.filterId, 
        payload.type as BiquadFilterType, 
        payload.frequency, 
        payload.Q, 
        payload.gain
      );
    }
  }

  private handleRemoveFilter(payload: RemoveFilterPayload) {
    const source = this.sources.get(payload.sourceId);
    if (source) {
      source.removeFilter(payload.filterId);
    }
  }

  private handleSetFilterParam(payload: SetFilterParamPayload) {
    const source = this.sources.get(payload.sourceId);
    if (source) {
      source.setFilterParam(payload.filterId, payload.param, payload.value);
    }
  }

  private handleAddEffect(payload: AddEffectPayload) {
    const source = this.sources.get(payload.sourceId);
    if (source) {
      source.addEffect(payload.effectId, payload.type, payload.config, payload.order);
    }
  }

  private handleRemoveEffect(payload: RemoveEffectPayload) {
    const source = this.sources.get(payload.sourceId);
    if (source) {
      source.removeEffect(payload.effectId);
    }
  }

  private handleUpdateEffect(payload: UpdateEffectPayload) {
    const source = this.sources.get(payload.sourceId);
    if (source) {
      source.updateEffect(payload.effectId, payload.config);
    }
  }

  private handleReorderEffects(payload: ReorderEffectsPayload) {
    const source = this.sources.get(payload.sourceId);
    if (source) {
      source.reorderEffects(payload.effectIds);
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
        
        // Emit STREAM_READY event when first chunk is received
        if (!this.streamFirstChunkReceived.get(payload.sourceId)) {
          this.streamFirstChunkReceived.set(payload.sourceId, true);
          this.port.postMessage({
            type: MessageType.STREAM_READY,
            payload: {
              sourceId: payload.sourceId,
            } as StreamReadyPayload,
          });
        }
    }
  }

  private handleSetParam(payload: any) {
    if (payload.target === "channelStrip.volume") {
      this.channelStrip.setVolume(payload.value);
    } else if (payload.target === "channelStrip.pan") {
      this.channelStrip.setPan(payload.value);
    }
    // Delay is now a per-source effect, not global
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
      } else if (source instanceof OscillatorSource) {
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
        // Reset first chunk flag when stream is stopped
        this.streamFirstChunkReceived.delete(payload.sourceId);
      } else if (source instanceof OscillatorSource) {
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
      } else if (source instanceof OscillatorSource) {
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
      } else if (source instanceof OscillatorSource) {
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
      if (source instanceof BufferSource || source instanceof StreamSource || source instanceof OscillatorSource) {
        source.volume = payload.volume;
      }
    }
  }

  private handleSetSourcePan(payload: SetSourcePanPayload) {
    const source = this.sources.get(payload.sourceId);
    if (source) {
      if (source instanceof BufferSource || source instanceof StreamSource || source instanceof OscillatorSource) {
        source.pan = payload.pan;
      }
    }
  }

  private handleCreateOscillatorSource(payload: CreateOscillatorSourcePayload) {
    const source = new OscillatorSource({
      frequency: payload.options?.frequency,
      detune: payload.options?.detune,
      type: payload.options?.type,
    });
    
    if (payload.options?.volume !== undefined) {
      source.volume = payload.options.volume;
    }
    if (payload.options?.pan !== undefined) {
      source.pan = payload.options.pan;
    }
    
    this.sources.set(payload.id, source);
    this.sourceStates.set(payload.id, {
      playing: false,
      paused: false,
      offset: 0,
      startTime: 0,
    });
  }

  private handleSetOscillatorFrequency(payload: SetOscillatorFrequencyPayload) {
    const source = this.sources.get(payload.sourceId);
    if (source && source instanceof OscillatorSource) {
      source.frequency = payload.frequency;
    }
  }

  private handleSetOscillatorDetune(payload: SetOscillatorDetunePayload) {
    const source = this.sources.get(payload.sourceId);
    if (source && source instanceof OscillatorSource) {
      source.detune = payload.detune;
    }
  }

  private handleSetOscillatorType(payload: SetOscillatorTypePayload) {
    const source = this.sources.get(payload.sourceId);
    if (source && source instanceof OscillatorSource) {
      source.type = payload.type;
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
      this.streamFirstChunkReceived.delete(id);
      
      // Emit SOURCE_ENDED event
      this.port.postMessage({
        type: MessageType.SOURCE_ENDED,
        payload: {
          sourceId: id,
          reason: 'finished',
        } as SourceEndedPayload,
      });
    }
    
    // Apply Channel Strip (Volume, Pan, etc.)
    // Note: Effects are applied per-source in Source.applyEffects()
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
