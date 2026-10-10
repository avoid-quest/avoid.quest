/**
 * Worklet Manager
 *
 * Manages AudioWorklet lifecycle, message passing, and event handling.
 * This is a simplified version focused on streaming audio for radio playback.
 */

import { AppError, captureError } from "@avoid.quest/error";
import type { EffectType as WorkletEffectType } from "../dsp/effects/types.js";
import type {
  SourceEndedPayload,
  SourceErrorPayload,
  StreamReadyPayload,
} from "./types.js";
import {
  type EventCallback,
  WorkletEventEmitter,
} from "./worklet-manager-events.js";
import {
  type ActiveSource,
  type WorkletManagerEvents as ManagerEvents,
  MessageType,
  type WorkletPortMessage,
} from "./worklet-manager-protocol.js";

export type { EffectType, FilterType } from "../dsp/effects/types.js";
export type { WorkletManagerEvents } from "./worklet-manager-protocol.js";

export type WorkletEffectConfig = Record<string, unknown>;

/**
 * Worklet Manager
 *
 * Manages the AudioWorklet processor for audio playback and effects.
 * Provides methods for source control, streaming, and effects.
 *
 * Audio routing: Worklet → GainNode (hardware volume) → [returned for external routing]
 *
 * Note: The masterGainNode is NOT auto-connected to destination.
 * Use the outputNode getter to get the final output for external routing.
 */
export class WorkletManager {
  private static readonly loadedContexts = new WeakSet<AudioContext>();
  private readonly context: AudioContext;
  private workletNode: AudioWorkletNode | null = null;
  private masterGainNode: GainNode | null = null;
  private readonly eventEmitter = new WorkletEventEmitter();
  private readonly activeSources = new Map<string, ActiveSource>();
  private readonly createdSources = new Set<string>();
  private initPromise: Promise<void> | null = null;
  private initFailed: boolean;
  private readonly processorUrl: string;

  /** Queue for messages sent before worklet is ready */
  private readonly messageQueue: WorkletPortMessage[] = [];

  /** Ramp time for volume changes (ms) */
  private static readonly VOLUME_RAMP_TIME = 0.05; // 50ms for smooth transitions

  /** Timeout for worklet initialization (ms) */
  private static readonly INIT_TIMEOUT_MS = 10_000; // 10 seconds

  /**
   * Create a new WorkletManager
   *
   * @param context - AudioContext to use
   * @param processorUrl - URL to the worklet processor bundle
   */
  constructor(context: AudioContext, processorUrl: string) {
    this.context = context;
    this.processorUrl = processorUrl;
    this.initFailed = false;
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
   * Get the output node for external routing
   * This is the final output of the worklet chain (after hardware volume)
   * Connect this to your destination, delay nodes, or other processing
   */
  get outputNode(): GainNode | null {
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
   * Check if a source has already been created in the worklet processor.
   * Use this before calling createStreamSource to avoid resetting the effect chain.
   */
  hasSource(sourceId: string): boolean {
    return this.createdSources.has(sourceId);
  }

  /**
   * Create a streaming source.
   * If the source already exists (hasSource returns true), this is a no-op —
   * call startSource directly to preserve the existing effect chain.
   */
  createStreamSource(sourceId: string): void {
    if (this.createdSources.has(sourceId)) {
      return;
    }
    this.createdSources.add(sourceId);
    this.postMessage({
      payload: {
        id: sourceId,
        options: { type: "stream" },
      },
      type: MessageType.CREATE_SOURCE,
    });
  }

  /**
   * Destroy a streaming source and remove it from the worklet processor.
   * Call this when the sound is fully cleaned up (e.g. in cleanupSound).
   * After this, createStreamSource will recreate the source fresh.
   */
  destroyStreamSource(sourceId: string): void {
    if (!this.createdSources.has(sourceId)) {
      return;
    }
    this.createdSources.delete(sourceId);
    this.postMessage({
      payload: { sourceId },
      type: MessageType.REMOVE_SOURCE,
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
      payload: {
        duration: options.duration,
        offset: options.offset,
        sourceId,
        when: options.when,
      },
      type: MessageType.START_SOURCE,
    });

    this.activeSources.set(sourceId, {
      offset: options.offset ?? 0,
      playing: true,
    });
  }

  /**
   * Stop a source
   */
  stopSource(sourceId: string): void {
    this.postMessage({
      payload: { sourceId },
      type: MessageType.STOP_SOURCE,
    });

    this.activeSources.delete(sourceId);
  }

  /**
   * Pause a source
   */
  pauseSource(sourceId: string): void {
    this.postMessage({
      payload: { sourceId },
      type: MessageType.PAUSE_SOURCE,
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
      payload: { sourceId },
      type: MessageType.RESUME_SOURCE,
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
      payload: { position, sourceId },
      type: MessageType.SEEK_SOURCE,
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
      payload: { sourceId, volume },
      type: MessageType.SET_SOURCE_VOLUME,
    });
  }

  /**
   * Set source pan (-1 to 1)
   */
  setSourcePan(sourceId: string, pan: number): void {
    this.postMessage({
      payload: { pan, sourceId },
      type: MessageType.SET_SOURCE_PAN,
    });
  }

  /**
   * Set master dry/wet for all effects on a source (0 = bypass, 1 = full)
   */
  setEffectsDryWet(sourceId: string, dryWet: number): void {
    this.postMessage({
      payload: { dryWet, sourceId },
      type: MessageType.SET_EFFECTS_DRY_WET,
    });
  }

  setTempo(sourceId: string, bpm: number): void {
    this.postMessage({
      payload: { bpm, sourceId },
      type: MessageType.SET_TEMPO,
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
    type: WorkletEffectType,
    config: WorkletEffectConfig,
    order: number
  ): void {
    this.postMessage({
      payload: { config, effectId, order, sourceId, type },
      type: MessageType.ADD_EFFECT,
    });
  }

  /**
   * Remove an effect from a source
   */
  removeEffect(sourceId: string, effectId: string): void {
    this.postMessage({
      payload: { effectId, sourceId },
      type: MessageType.REMOVE_EFFECT,
    });
  }

  /**
   * Update effect parameters
   */
  updateEffect(
    sourceId: string,
    effectId: string,
    config: Partial<WorkletEffectConfig>
  ): void {
    this.postMessage({
      payload: { config, effectId, sourceId },
      type: MessageType.UPDATE_EFFECT,
    });
  }

  /**
   * Reorder effects on a source
   */
  reorderEffects(sourceId: string, effectIds: string[]): void {
    this.postMessage({
      payload: { effectIds, sourceId },
      type: MessageType.REORDER_EFFECTS,
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
      payload: {
        target: "channelStrip.pan",
        value: pan,
      },
      type: MessageType.SET_PARAM,
    });
  }

  // ============================================
  // Event Subscription
  // ============================================

  /**
   * Subscribe to worklet events
   */
  on<K extends keyof ManagerEvents>(
    event: K,
    callback: EventCallback<ManagerEvents[K]>
  ): void {
    this.eventEmitter.on(event, callback);
  }

  /**
   * Unsubscribe from worklet events
   */
  off<K extends keyof ManagerEvents>(
    event: K,
    callback: EventCallback<ManagerEvents[K]>
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
    this.messageQueue.length = 0;
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
   * Perform initialization with timeout
   */
  private async doInit(): Promise<void> {
    // Get native AudioContext if using standardized-audio-context wrapper
    const nativeContext =
      (this.context as unknown as { _nativeContext?: AudioContext })
        ._nativeContext ??
      (this.context as unknown as { _nativeAudioContext?: AudioContext })
        ._nativeAudioContext ??
      this.context;

    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `WorkletManager initialization timed out after ${WorkletManager.INIT_TIMEOUT_MS}ms`
          )
        );
      }, WorkletManager.INIT_TIMEOUT_MS);
    });

    try {
      // Race between initialization and timeout
      await Promise.race([this.performInit(nativeContext), timeoutPromise]);

      // Flush any queued messages now that we're ready
      this.flushMessageQueue();
    } catch (error) {
      console.error("Failed to initialize WorkletManager:", error);
      throw error;
    }
  }

  /**
   * Perform the actual initialization work
   */
  private async performInit(nativeContext: AudioContext): Promise<void> {
    if (!WorkletManager.loadedContexts.has(nativeContext)) {
      await this.context.audioWorklet.addModule(this.processorUrl);
      WorkletManager.loadedContexts.add(nativeContext);
    }

    // Create the worklet node
    this.workletNode = new AudioWorkletNode(
      nativeContext,
      "cacophony-processor",
      {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      }
    );

    // Create master GainNode for hardware-accelerated volume control
    // This provides better audio quality than software gain in the worklet
    this.masterGainNode = nativeContext.createGain();
    this.masterGainNode.gain.value = 1;

    // Route: Worklet → GainNode (no auto-connect to destination)
    // External code should connect outputNode to destination or delay nodes
    this.workletNode.connect(this.masterGainNode);

    // Set up message listener
    this.setupMessageListener();
    const worklet = this.workletNode;
    worklet.addEventListener(
      "processorerror",
      () => {
        if (this.workletNode === worklet) {
          captureError(
            new AppError({
              category: "playback",
              code: "AUDIO_PROCESSOR_FAILED",
              context: { backend: "compatibility" },
              safeMessage: "Audio worklet processor stopped",
            }),
            { operation: "runAudioProcessor", surface: "ui" }
          );
        }
      },
      { once: true }
    );
  }

  /**
   * Flush queued messages to the worklet
   */
  private flushMessageQueue(): void {
    if (!this.workletNode) {
      return;
    }

    for (const message of this.messageQueue) {
      this.workletNode.port.postMessage(message);
    }
    this.messageQueue.length = 0;
  }

  /**
   * Set up message listener for worklet events
   */
  private setupMessageListener(): void {
    if (!this.workletNode) {
      return;
    }

    this.workletNode.port.onmessage = (
      event: MessageEvent<WorkletPortMessage>
    ) => {
      this.handleWorkletMessage(event.data);
    };
  }

  /**
   * Handle messages from the worklet
   */
  private handleWorkletMessage(message: WorkletPortMessage): void {
    switch (message.type) {
      case MessageType.SOURCE_ENDED: {
        const payload = message.payload as SourceEndedPayload;
        this.eventEmitter.emit("sourceEnded", payload);
        // Clean up tracking
        if (payload.sourceId) {
          this.activeSources.delete(payload.sourceId);
        }
        break;
      }

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

      default:
        console.warn("Unknown message from worklet:", message);
    }
  }

  /**
   * Post a message to the worklet
   * If worklet isn't ready yet, queues the message to be sent after initialization
   */
  private postMessage(message: WorkletPortMessage): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage(message);
    } else if (this.initFailed) {
      // Don't queue if init already failed
      console.warn(
        "WorkletManager init failed, message dropped:",
        message.type
      );
    } else {
      // Queue the message to be sent when worklet is ready
      this.messageQueue.push(message);
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
