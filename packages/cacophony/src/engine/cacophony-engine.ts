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
  type SourceErrorPayload,
  type StreamReadyPayload,
  type PeakMeterPayload,
  type AddFilterPayload,
  type RemoveFilterPayload,
  type SetFilterParamPayload,
  type AddEffectPayload,
  type RemoveEffectPayload,
  type UpdateEffectPayload,
  type ReorderEffectsPayload,
  type EffectType,
} from "../protocol.js";
import type { AudioBuffer } from "../context.js";
// @ts-ignore - This will be resolved by the build plugin
import processorUrl from "../bundles/cacophony-processor-bundle.js?url";

// Simple event emitter for worklet events
type EventCallback = (payload: any) => void;

class EventEmitter {
  private listeners = new Map<string, EventCallback[]>();

  on(event: string, callback: EventCallback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  emit(event: string, payload: any) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(payload));
    }
  }

  off(event: string, callback: EventCallback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }
}

export class CacophonyEngine {
  private context: AudioContext;
  private workletNode: AudioWorkletNode | null = null;
  private readyPromise: Promise<void>;
  private eventEmitter = new EventEmitter();
  private activeSources = new Map<string, { playing: boolean; offset: number }>();
  private initFailed = false;

  constructor(context: AudioContext) {
    this.context = context;
    this.readyPromise = this.init();
  }

  private async init() {
    // Get native AudioContext from standardized-audio-context wrapper
    // The wrapper stores the native context internally
    const nativeContext = (this.context as any)._nativeContext || 
                          (this.context as any)._nativeAudioContext ||
                          this.context;
    
    try {
      // Use the built-in bundle path - Vite is configured to serve /bundles/ from cacophony package
      await this.context.audioWorklet.addModule(processorUrl);
      
      // Use native context for AudioWorkletNode as it requires actual BaseAudioContext
      this.workletNode = new AudioWorkletNode(nativeContext, "cacophony-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      // Connect engine output directly to destination
      this.workletNode.connect(nativeContext.destination);
      
      // Set up message listener for events from worklet
      this.setupMessageListener();
      
      console.log("CacophonyEngine initialized");
    } catch (error) {
      console.error("Failed to initialize CacophonyEngine:", error);
      this.initFailed = true;
      throw error;
    }
  }

  /**
   * Returns true if the engine worklet is ready for use.
   */
  get isReady(): boolean {
    return this.workletNode !== null && !this.initFailed;
  }

  private setupMessageListener() {
    if (!this.workletNode) return;
    
    this.workletNode.port.onmessage = (event: MessageEvent<Message>) => {
      this.handleWorkletMessage(event.data);
    };
  }

  private handleWorkletMessage(message: Message) {
    switch (message.type) {
      case MessageType.SOURCE_ENDED:
        this.eventEmitter.emit('sourceEnded', message.payload as SourceEndedPayload);
        // Clean up tracking
        if (message.payload?.sourceId) {
          this.activeSources.delete(message.payload.sourceId);
        }
        break;
      case MessageType.SOURCE_ERROR:
        this.eventEmitter.emit('sourceError', message.payload as SourceErrorPayload);
        break;
      case MessageType.STREAM_UNDERRUN:
        this.eventEmitter.emit('streamUnderrun', message.payload);
        break;
      case MessageType.STREAM_READY:
        this.eventEmitter.emit('streamReady', message.payload as StreamReadyPayload);
        break;
      case MessageType.PEAK_METER:
        this.eventEmitter.emit('peakMeter', message.payload as PeakMeterPayload);
        break;
      default:
        console.warn('Unknown message from worklet:', message);
    }
  }

  async ready() {
    return this.readyPromise;
  }

  private postMessage(message: Message) {
    if (this.workletNode) {
      this.workletNode.port.postMessage(message);
    } else {
      console.warn("CacophonyEngine not ready, message dropped:", message);
    }
  }

  loadBuffer(id: string, buffer: AudioBuffer) {
    const channels: Float32Array[] = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    const payload: LoadBufferPayload = {
      id,
      buffer: channels,
      sampleRate: buffer.sampleRate,
    };

    this.postMessage({
      type: MessageType.LOAD_BUFFER,
      payload,
    });
  }

  createSource(id: string, bufferId: string, options: { loop?: boolean; playbackRate?: number } = {}) {
    this.postMessage({
      type: MessageType.CREATE_SOURCE,
      payload: {
        id,
        bufferId,
        options,
      },
    });
  }

  setVolume(volume: number) {
    this.postMessage({
      type: MessageType.SET_PARAM,
      payload: {
        target: "channelStrip.volume",
        value: volume,
      },
    });
  }

  setPan(pan: number) {
    this.postMessage({
      type: MessageType.SET_PARAM,
      payload: {
        target: "channelStrip.pan",
        value: pan,
      },
    });
  }

  createStreamSource(id: string) {
    this.postMessage({
      type: MessageType.CREATE_SOURCE,
      payload: {
        id,
        options: { type: "stream" },
      },
    });
  }

  addStreamChunk(sourceId: string, buffer: AudioBuffer) {
    const channels: Float32Array[] = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    this.postMessage({
      type: MessageType.ADD_STREAM_CHUNK,
      payload: {
        sourceId,
        chunk: channels,
      },
    });
  }

  // Delay is now a per-source effect, use addEffect/updateEffect instead
  // These methods are kept for backward compatibility but deprecated
  setDelayTime(time: number) {
    console.warn("setDelayTime is deprecated, use addEffect/updateEffect with delay effect instead");
  }

  setDelayFeedback(feedback: number) {
    console.warn("setDelayFeedback is deprecated, use addEffect/updateEffect with delay effect instead");
  }

  setDelayMix(mix: number) {
    console.warn("setDelayMix is deprecated, use addEffect/updateEffect with delay effect instead");
  }

  // Source control methods
  startSource(sourceId: string, options: { when?: number; offset?: number; duration?: number } = {}) {
    const payload: StartSourcePayload = {
      sourceId,
      when: options.when,
      offset: options.offset,
      duration: options.duration,
    };
    
    this.postMessage({
      type: MessageType.START_SOURCE,
      payload,
    });
    
    this.activeSources.set(sourceId, { playing: true, offset: options.offset || 0 });
  }

  stopSource(sourceId: string) {
    const payload: StopSourcePayload = { sourceId };
    
    this.postMessage({
      type: MessageType.STOP_SOURCE,
      payload,
    });
    
    this.activeSources.delete(sourceId);
  }

  pauseSource(sourceId: string) {
    const payload: PauseSourcePayload = { sourceId };
    
    this.postMessage({
      type: MessageType.PAUSE_SOURCE,
      payload,
    });
    
    const state = this.activeSources.get(sourceId);
    if (state) {
      state.playing = false;
    }
  }

  resumeSource(sourceId: string) {
    const payload: ResumeSourcePayload = { sourceId };
    
    this.postMessage({
      type: MessageType.RESUME_SOURCE,
      payload,
    });
    
    const state = this.activeSources.get(sourceId);
    if (state) {
      state.playing = true;
    }
  }

  seekSource(sourceId: string, position: number) {
    const payload: SeekSourcePayload = {
      sourceId,
      position,
    };
    
    this.postMessage({
      type: MessageType.SEEK_SOURCE,
      payload,
    });
    
    const state = this.activeSources.get(sourceId);
    if (state) {
      state.offset = position;
    }
  }

  setSourceVolume(sourceId: string, volume: number) {
    const payload: SetSourceVolumePayload = {
      sourceId,
      volume,
    };
    
    this.postMessage({
      type: MessageType.SET_SOURCE_VOLUME,
      payload,
    });
  }

  setSourcePan(sourceId: string, pan: number) {
    const payload: SetSourcePanPayload = {
      sourceId,
      pan,
    };
    
    this.postMessage({
      type: MessageType.SET_SOURCE_PAN,
      payload,
    });
  }

  // Oscillator methods
  createOscillatorSource(
    id: string,
    options: {
      frequency?: number;
      detune?: number;
      type?: "sine" | "sawtooth" | "square" | "triangle";
      volume?: number;
      pan?: number;
    } = {}
  ) {
    this.postMessage({
      type: MessageType.CREATE_OSCILLATOR_SOURCE,
      payload: {
        id,
        options,
      },
    });
  }

  setOscillatorFrequency(sourceId: string, frequency: number) {
    this.postMessage({
      type: MessageType.SET_OSCILLATOR_FREQUENCY,
      payload: {
        sourceId,
        frequency,
      },
    });
  }

  setOscillatorDetune(sourceId: string, detune: number) {
    this.postMessage({
      type: MessageType.SET_OSCILLATOR_DETUNE,
      payload: {
        sourceId,
        detune,
      },
    });
  }

  setOscillatorType(sourceId: string, type: "sine" | "sawtooth" | "square" | "triangle") {
    this.postMessage({
      type: MessageType.SET_OSCILLATOR_TYPE,
      payload: {
        sourceId,
        type,
      },
    });
  }

  // Filter methods
  addFilter(
    sourceId: string,
    filterId: string,
    type: "lowpass" | "highpass" | "bandpass" | "lowshelf" | "highshelf" | "peaking" | "notch" | "allpass",
    frequency: number,
    Q: number,
    gain: number
  ) {
    const payload: AddFilterPayload = {
      sourceId,
      filterId,
      type,
      frequency,
      Q,
      gain,
    };

    this.postMessage({
      type: MessageType.ADD_FILTER,
      payload,
    });
  }

  removeFilter(sourceId: string, filterId: string) {
    const payload: RemoveFilterPayload = {
      sourceId,
      filterId,
    };

    this.postMessage({
      type: MessageType.REMOVE_FILTER,
      payload,
    });
  }

  setFilterParam(sourceId: string, filterId: string, param: 'frequency' | 'Q' | 'gain' | 'type', value: number | string) {
    const payload: SetFilterParamPayload = {
      sourceId,
      filterId,
      param,
      value,
    };

    this.postMessage({
      type: MessageType.SET_FILTER_PARAM,
      payload,
    });
  }

  // Effect methods
  addEffect(
    sourceId: string,
    effectId: string,
    type: EffectType,
    config: Record<string, number>,
    order: number
  ) {
    const payload: AddEffectPayload = {
      sourceId,
      effectId,
      type,
      config,
      order,
    };

    this.postMessage({
      type: MessageType.ADD_EFFECT,
      payload,
    });
  }

  removeEffect(sourceId: string, effectId: string) {
    const payload: RemoveEffectPayload = {
      sourceId,
      effectId,
    };

    this.postMessage({
      type: MessageType.REMOVE_EFFECT,
      payload,
    });
  }

  updateEffect(sourceId: string, effectId: string, config: Partial<Record<string, number>>) {
    const payload: UpdateEffectPayload = {
      sourceId,
      effectId,
      config,
    };

    this.postMessage({
      type: MessageType.UPDATE_EFFECT,
      payload,
    });
  }

  reorderEffects(sourceId: string, effectIds: string[]) {
    const payload: ReorderEffectsPayload = {
      sourceId,
      effectIds,
    };

    this.postMessage({
      type: MessageType.REORDER_EFFECTS,
      payload,
    });
  }

  // Event subscription
  on(event: string, callback: EventCallback) {
    this.eventEmitter.on(event, callback);
  }

  off(event: string, callback: EventCallback) {
    this.eventEmitter.off(event, callback);
  }

  cleanup() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this.activeSources.clear();
  }

  /**
   * Connect an AudioNode to the engine's input.
   * This allows external audio sources to be processed by the engine.
   * Note: With engine-only mode, this is rarely needed as all sources are created in the engine.
   */
  connectInput(node: AudioNode) {
    if (this.workletNode) {
      node.connect(this.workletNode);
    } else {
      console.warn("CacophonyEngine not ready, cannot connect input");
    }
  }
}
