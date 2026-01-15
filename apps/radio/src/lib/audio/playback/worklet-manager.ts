/**
 * Worklet Manager
 *
 * Manages AudioWorklet lifecycle, message passing, and event handling.
 * This is a simplified version focused on streaming audio for radio playback.
 */

import type {
  SourceEndedPayload,
  SourceErrorPayload,
  StreamReadyPayload,
} from "./types.js";

/**
 * Event callback type for worklet events
 */
type EventCallback<T = unknown> = (payload: T) => void;

/**
 * Simple typed event emitter for worklet events
 */
class WorkletEventEmitter {
  private readonly listeners = new Map<string, Set<EventCallback>>();

  on<T>(event: string, callback: EventCallback<T>): void {
    const existing = this.listeners.get(event);
    if (existing) {
      existing.add(callback as EventCallback);
    } else {
      this.listeners.set(event, new Set([callback as EventCallback]));
    }
  }

  off<T>(event: string, callback: EventCallback<T>): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback as EventCallback);
      if (callbacks.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  emit<T>(event: string, payload: T): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(payload);
        } catch (error) {
          console.error(`Error in worklet event listener for ${event}:`, error);
        }
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

/**
 * Message types for main thread → worklet communication
 */
const MessageType = {
  // Source lifecycle
  CREATE_SOURCE: "CREATE_SOURCE",
  START_SOURCE: "START_SOURCE",
  STOP_SOURCE: "STOP_SOURCE",
  PAUSE_SOURCE: "PAUSE_SOURCE",
  RESUME_SOURCE: "RESUME_SOURCE",
  SEEK_SOURCE: "SEEK_SOURCE",
  SET_SOURCE_VOLUME: "SET_SOURCE_VOLUME",
  SET_SOURCE_PAN: "SET_SOURCE_PAN",

  // Streaming
  ADD_STREAM_CHUNK: "ADD_STREAM_CHUNK",

  // Effects
  ADD_EFFECT: "ADD_EFFECT",
  REMOVE_EFFECT: "REMOVE_EFFECT",
  UPDATE_EFFECT: "UPDATE_EFFECT",
  REORDER_EFFECTS: "REORDER_EFFECTS",

  // Filter
  ADD_FILTER: "ADD_FILTER",
  REMOVE_FILTER: "REMOVE_FILTER",
  SET_FILTER_PARAM: "SET_FILTER_PARAM",

  // Global
  SET_PARAM: "SET_PARAM",

  // Events (worklet → main)
  SOURCE_ENDED: "SOURCE_ENDED",
  SOURCE_ERROR: "SOURCE_ERROR",
  STREAM_READY: "STREAM_READY",
  STREAM_UNDERRUN: "STREAM_UNDERRUN",
  PEAK_METER: "PEAK_METER",
} as const;

/**
 * Effect types supported by the worklet processor
 */
export type EffectType =
  | "biquadFilter"
  | "reverb"
  | "standardReverb"
  | "phaseVocoder"
  | "distortion"
  | "compressor"
  | "delay"
  | "crusher"
  | "fold"
  | "stereoTool"
  | "revamp"
  | "tidal"
  | "limiter";

/**
 * Filter types supported by the worklet processor
 */
export type FilterType =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "lowshelf"
  | "highshelf"
  | "peaking"
  | "notch"
  | "allpass";

/**
 * Worklet manager events
 */
export type WorkletManagerEvents = {
  sourceEnded: SourceEndedPayload;
  sourceError: SourceErrorPayload;
  streamReady: StreamReadyPayload;
  streamUnderrun: { sourceId: string };
  peakMeter: { peakL: number; peakR: number };
};

/**
 * Active source tracking state
 */
type ActiveSource = {
  playing: boolean;
  offset: number;
};

/**
 * Worklet Manager
 *
 * Manages the AudioWorklet processor for audio playback and effects.
 * Provides methods for source control, streaming, and effects.
 *
 * Audio routing: Worklet → GainNode (hardware volume) → Destination
 */
export class WorkletManager {
  private readonly context: AudioContext;
  private workletNode: AudioWorkletNode | null = null;
  private masterGainNode: GainNode | null = null;
  private readonly eventEmitter = new WorkletEventEmitter();
  private readonly activeSources = new Map<string, ActiveSource>();
  private initPromise: Promise<void> | null = null;
  private initFailed = false;
  private readonly processorUrl: string;

  /** Ramp time for volume changes (ms) */
  private static readonly VOLUME_RAMP_TIME = 0.05; // 50ms for smooth transitions

  /**
   * Create a new WorkletManager
   *
   * @param context - AudioContext to use
   * @param processorUrl - URL to the worklet processor bundle
   */
  constructor(context: AudioContext, processorUrl: string) {
    this.context = context;
    this.processorUrl = processorUrl;
  }

  /**
   * Initialize the worklet
   *
   * Loads the worklet module and creates the AudioWorkletNode.
   * Safe to call multiple times - will return existing promise if already initializing.
   */
  async init(): Promise<void> {
    if (this.isReady) {
      return;
    }

    if (this.initFailed) {
      throw new Error("WorkletManager initialization previously failed");
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInit();

    try {
      await this.initPromise;
    } catch (error) {
      this.initFailed = true;
      throw error;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Check if the worklet is ready for use
   */
  get isReady(): boolean {
    return this.workletNode !== null && !this.initFailed;
  }

  /**
   * Get the AudioWorkletNode (for connecting external nodes)
   */
  get node(): AudioWorkletNode | null {
    return this.workletNode;
  }

  /**
   * Get the master GainNode (for monitoring or external routing)
   */
  get gainNode(): GainNode | null {
    return this.masterGainNode;
  }

  /**
   * Get current master volume
   */
  get volume(): number {
    return this.masterGainNode?.gain.value ?? 1;
  }

  // ============================================
  // Source Lifecycle Methods
  // ============================================

  /**
   * Create a streaming source
   */
  createStreamSource(sourceId: string): void {
    this.postMessage({
      type: MessageType.CREATE_SOURCE,
      payload: {
        id: sourceId,
        options: { type: "stream" },
      },
    });
  }

  /**
   * Start a source
   */
  startSource(
    sourceId: string,
    options: { when?: number; offset?: number; duration?: number } = {}
  ): void {
    this.postMessage({
      type: MessageType.START_SOURCE,
      payload: {
        sourceId,
        when: options.when,
        offset: options.offset,
        duration: options.duration,
      },
    });

    this.activeSources.set(sourceId, {
      playing: true,
      offset: options.offset ?? 0,
    });
  }

  /**
   * Stop a source
   */
  stopSource(sourceId: string): void {
    this.postMessage({
      type: MessageType.STOP_SOURCE,
      payload: { sourceId },
    });

    this.activeSources.delete(sourceId);
  }

  /**
   * Pause a source
   */
  pauseSource(sourceId: string): void {
    this.postMessage({
      type: MessageType.PAUSE_SOURCE,
      payload: { sourceId },
    });

    const state = this.activeSources.get(sourceId);
    if (state) {
      state.playing = false;
    }
  }

  /**
   * Resume a paused source
   */
  resumeSource(sourceId: string): void {
    this.postMessage({
      type: MessageType.RESUME_SOURCE,
      payload: { sourceId },
    });

    const state = this.activeSources.get(sourceId);
    if (state) {
      state.playing = true;
    }
  }

  /**
   * Seek to a position in a source
   */
  seekSource(sourceId: string, position: number): void {
    this.postMessage({
      type: MessageType.SEEK_SOURCE,
      payload: { sourceId, position },
    });

    const state = this.activeSources.get(sourceId);
    if (state) {
      state.offset = position;
    }
  }

  /**
   * Set source volume (0-1)
   */
  setSourceVolume(sourceId: string, volume: number): void {
    this.postMessage({
      type: MessageType.SET_SOURCE_VOLUME,
      payload: { sourceId, volume },
    });
  }

  /**
   * Set source pan (-1 to 1)
   */
  setSourcePan(sourceId: string, pan: number): void {
    this.postMessage({
      type: MessageType.SET_SOURCE_PAN,
      payload: { sourceId, pan },
    });
  }

  // ============================================
  // Streaming Methods
  // ============================================

  /**
   * Add a decoded audio chunk to a streaming source
   */
  addStreamChunk(sourceId: string, buffer: AudioBuffer): void {
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

  // ============================================
  // Effect Methods
  // ============================================

  /**
   * Add an effect to a source
   */
  addEffect(
    sourceId: string,
    effectId: string,
    type: EffectType,
    config: Record<string, number>,
    order: number
  ): void {
    this.postMessage({
      type: MessageType.ADD_EFFECT,
      payload: { sourceId, effectId, type, config, order },
    });
  }

  /**
   * Remove an effect from a source
   */
  removeEffect(sourceId: string, effectId: string): void {
    this.postMessage({
      type: MessageType.REMOVE_EFFECT,
      payload: { sourceId, effectId },
    });
  }

  /**
   * Update effect parameters
   */
  updateEffect(
    sourceId: string,
    effectId: string,
    config: Partial<Record<string, number>>
  ): void {
    this.postMessage({
      type: MessageType.UPDATE_EFFECT,
      payload: { sourceId, effectId, config },
    });
  }

  /**
   * Reorder effects on a source
   */
  reorderEffects(sourceId: string, effectIds: string[]): void {
    this.postMessage({
      type: MessageType.REORDER_EFFECTS,
      payload: { sourceId, effectIds },
    });
  }

  // ============================================
  // Filter Methods
  // ============================================

  /**
   * Add a filter to a source
   */
  addFilter(
    sourceId: string,
    filterId: string,
    type: FilterType,
    frequency: number,
    Q: number,
    gain: number
  ): void {
    this.postMessage({
      type: MessageType.ADD_FILTER,
      payload: { sourceId, filterId, type, frequency, Q, gain },
    });
  }

  /**
   * Remove a filter from a source
   */
  removeFilter(sourceId: string, filterId: string): void {
    this.postMessage({
      type: MessageType.REMOVE_FILTER,
      payload: { sourceId, filterId },
    });
  }

  /**
   * Set a filter parameter
   */
  setFilterParam(
    sourceId: string,
    filterId: string,
    param: "frequency" | "Q" | "gain" | "type",
    value: number | string
  ): void {
    this.postMessage({
      type: MessageType.SET_FILTER_PARAM,
      payload: { sourceId, filterId, param, value },
    });
  }

  // ============================================
  // Global Methods
  // ============================================

  /**
   * Set global volume using hardware-accelerated GainNode
   *
   * Uses exponential ramping for smooth, click-free transitions.
   * This provides better audio quality than software gain processing.
   */
  setVolume(volume: number): void {
    if (!this.masterGainNode) {
      return;
    }

    const now = this.context.currentTime;
    const clampedVolume = Math.max(0.0001, Math.min(1, volume)); // Avoid 0 for exponential ramp

    // Cancel any scheduled changes
    this.masterGainNode.gain.cancelScheduledValues(now);

    // Set current value and ramp to target
    this.masterGainNode.gain.setValueAtTime(
      this.masterGainNode.gain.value,
      now
    );

    // Use exponential ramp for natural-sounding volume changes
    // (linear ramp sounds unnatural to human ears)
    this.masterGainNode.gain.exponentialRampToValueAtTime(
      clampedVolume,
      now + WorkletManager.VOLUME_RAMP_TIME
    );
  }

  /**
   * Set global pan (channel strip)
   */
  setPan(pan: number): void {
    this.postMessage({
      type: MessageType.SET_PARAM,
      payload: {
        target: "channelStrip.pan",
        value: pan,
      },
    });
  }

  // ============================================
  // Event Subscription
  // ============================================

  /**
   * Subscribe to worklet events
   */
  on<K extends keyof WorkletManagerEvents>(
    event: K,
    callback: EventCallback<WorkletManagerEvents[K]>
  ): void {
    this.eventEmitter.on(event, callback);
  }

  /**
   * Unsubscribe from worklet events
   */
  off<K extends keyof WorkletManagerEvents>(
    event: K,
    callback: EventCallback<WorkletManagerEvents[K]>
  ): void {
    this.eventEmitter.off(event, callback);
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.onmessage = null;
      this.workletNode = null;
    }

    if (this.masterGainNode) {
      this.masterGainNode.disconnect();
      this.masterGainNode = null;
    }

    this.activeSources.clear();
    this.eventEmitter.clear();
    this.initPromise = null;
    this.initFailed = false;
  }

  /**
   * Check if a source is active
   */
  isSourceActive(sourceId: string): boolean {
    return this.activeSources.has(sourceId);
  }

  /**
   * Check if a source is playing
   */
  isSourcePlaying(sourceId: string): boolean {
    return this.activeSources.get(sourceId)?.playing ?? false;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Perform initialization
   */
  private async doInit(): Promise<void> {
    // Get native AudioContext if using standardized-audio-context wrapper
    const nativeContext =
      (this.context as unknown as { _nativeContext?: AudioContext })
        ._nativeContext ??
      (this.context as unknown as { _nativeAudioContext?: AudioContext })
        ._nativeAudioContext ??
      this.context;

    try {
      // Load the worklet module
      await this.context.audioWorklet.addModule(this.processorUrl);

      // Create the worklet node
      this.workletNode = new AudioWorkletNode(
        nativeContext,
        "cacophony-processor",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        }
      );

      // Create master GainNode for hardware-accelerated volume control
      // This provides better audio quality than software gain in the worklet
      this.masterGainNode = nativeContext.createGain();
      this.masterGainNode.gain.value = 1;

      // Route: Worklet → GainNode → Destination
      this.workletNode.connect(this.masterGainNode);
      this.masterGainNode.connect(nativeContext.destination);

      // Set up message listener
      this.setupMessageListener();

      console.log("WorkletManager initialized with hardware GainNode");
    } catch (error) {
      console.error("Failed to initialize WorkletManager:", error);
      throw error;
    }
  }

  /**
   * Set up message listener for worklet events
   */
  private setupMessageListener(): void {
    if (!this.workletNode) {
      return;
    }

    this.workletNode.port.onmessage = (
      event: MessageEvent<{ type: string; payload?: unknown }>
    ) => {
      this.handleWorkletMessage(event.data);
    };
  }

  /**
   * Handle messages from the worklet
   */
  private handleWorkletMessage(message: {
    type: string;
    payload?: unknown;
  }): void {
    switch (message.type) {
      case MessageType.SOURCE_ENDED:
        this.eventEmitter.emit(
          "sourceEnded",
          message.payload as SourceEndedPayload
        );
        // Clean up tracking
        if ((message.payload as SourceEndedPayload)?.sourceId) {
          this.activeSources.delete(
            (message.payload as SourceEndedPayload).sourceId
          );
        }
        break;

      case MessageType.SOURCE_ERROR:
        this.eventEmitter.emit(
          "sourceError",
          message.payload as SourceErrorPayload
        );
        break;

      case MessageType.STREAM_READY:
        this.eventEmitter.emit(
          "streamReady",
          message.payload as StreamReadyPayload
        );
        break;

      case MessageType.STREAM_UNDERRUN:
        this.eventEmitter.emit(
          "streamUnderrun",
          message.payload as { sourceId: string }
        );
        break;

      case MessageType.PEAK_METER:
        this.eventEmitter.emit(
          "peakMeter",
          message.payload as { peakL: number; peakR: number }
        );
        break;

      default:
        console.warn("Unknown message from worklet:", message);
    }
  }

  /**
   * Post a message to the worklet
   */
  private postMessage(message: { type: string; payload?: unknown }): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage(message);
    } else {
      console.warn("WorkletManager not ready, message dropped:", message.type);
    }
  }
}

/**
 * Create a WorkletManager instance
 *
 * Factory function for creating WorkletManager instances.
 *
 * @param context - AudioContext to use
 * @param processorUrl - URL to the worklet processor bundle
 */
export function createWorkletManager(
  context: AudioContext,
  processorUrl: string
): WorkletManager {
  return new WorkletManager(context, processorUrl);
}
