/**
 * Mock CacophonyEngine for testing engine-based audio features.
 * 
 * This mock:
 * - Tracks all method calls for assertions
 * - Simulates ready state
 * - Allows triggering events (sourceEnded, sourceError, etc.)
 */
import { mock } from "bun:test";
import type { AudioBuffer } from "standardized-audio-context-mock";

export type MockEventCallback = (payload: any) => void;

export interface MockEngineState {
  buffers: Map<string, { id: string; channels: number; sampleRate: number }>;
  sources: Map<string, {
    id: string;
    bufferId?: string;
    type: "buffer" | "stream" | "oscillator";
    playing: boolean;
    paused: boolean;
    volume: number;
    pan: number;
    loop?: boolean;
    playbackRate?: number;
  }>;
  globalVolume: number;
  globalPan: number;
}

export class MockCacophonyEngine {
  private eventCallbacks = new Map<string, MockEventCallback[]>();
  private _isReady = true;
  
  // Track state for assertions
  state: MockEngineState = {
    buffers: new Map(),
    sources: new Map(),
    globalVolume: 1,
    globalPan: 0,
  };
  
  // Mock functions for call tracking
  loadBuffer = mock((id: string, buffer: AudioBuffer) => {
    this.state.buffers.set(id, {
      id,
      channels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
    });
  });

  createSource = mock((id: string, bufferId: string, options: { loop?: boolean; playbackRate?: number } = {}) => {
    this.state.sources.set(id, {
      id,
      bufferId,
      type: "buffer",
      playing: false,
      paused: false,
      volume: 1,
      pan: 0,
      loop: options.loop,
      playbackRate: options.playbackRate ?? 1,
    });
  });

  createStreamSource = mock((id: string) => {
    this.state.sources.set(id, {
      id,
      type: "stream",
      playing: false,
      paused: false,
      volume: 1,
      pan: 0,
    });
  });

  addStreamChunk = mock((_sourceId: string, _buffer: AudioBuffer) => {
    // Track chunk addition if needed
  });

  startSource = mock((sourceId: string, _options: { when?: number; offset?: number; duration?: number } = {}) => {
    const source = this.state.sources.get(sourceId);
    if (source) {
      source.playing = true;
      source.paused = false;
    }
  });

  stopSource = mock((sourceId: string) => {
    const source = this.state.sources.get(sourceId);
    if (source) {
      source.playing = false;
      source.paused = false;
    }
  });

  pauseSource = mock((sourceId: string) => {
    const source = this.state.sources.get(sourceId);
    if (source) {
      source.playing = false;
      source.paused = true;
    }
  });

  resumeSource = mock((sourceId: string) => {
    const source = this.state.sources.get(sourceId);
    if (source) {
      source.playing = true;
      source.paused = false;
    }
  });

  seekSource = mock((_sourceId: string, _position: number) => {
    // Track seek if needed
  });

  setSourceVolume = mock((sourceId: string, volume: number) => {
    const source = this.state.sources.get(sourceId);
    if (source) {
      source.volume = volume;
    }
  });

  setSourcePan = mock((sourceId: string, pan: number) => {
    const source = this.state.sources.get(sourceId);
    if (source) {
      source.pan = pan;
    }
  });

  setVolume = mock((volume: number) => {
    this.state.globalVolume = volume;
  });

  setPan = mock((pan: number) => {
    this.state.globalPan = pan;
  });

  setDelayTime = mock((_time: number) => {});
  setDelayFeedback = mock((_feedback: number) => {});
  setDelayMix = mock((_mix: number) => {});

  connectInput = mock((_node: AudioNode) => {});
  
  // Effect methods
  addEffect = mock((_sourceId: string, _effectId: string, _type: string, _config: Record<string, number>, _order: number) => {});
  removeEffect = mock((_sourceId: string, _effectId: string) => {});
  updateEffect = mock((_sourceId: string, _effectId: string, _config: Partial<Record<string, number>>) => {});
  reorderEffects = mock((_sourceId: string, _effectIds: string[]) => {});
  
  cleanup = mock(() => {
    this.state.buffers.clear();
    this.state.sources.clear();
  });

  // Event system
  on(event: string, callback: MockEventCallback) {
    if (!this.eventCallbacks.has(event)) {
      this.eventCallbacks.set(event, []);
    }
    this.eventCallbacks.get(event)!.push(callback);
  }

  off(event: string, callback: MockEventCallback) {
    const callbacks = this.eventCallbacks.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  // Test helper: emit an event
  emitEvent(event: string, payload: any) {
    const callbacks = this.eventCallbacks.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(payload));
    }
  }

  // Test helper: simulate source ended
  simulateSourceEnded(sourceId: string, reason: "finished" | "stopped" | "error" = "finished") {
    const source = this.state.sources.get(sourceId);
    if (source) {
      source.playing = false;
    }
    this.emitEvent("sourceEnded", { sourceId, reason });
  }

  // Test helper: simulate source error
  simulateSourceError(sourceId: string, error: string) {
    this.emitEvent("sourceError", { sourceId, error });
  }

  // Ready state
  get isReady(): boolean {
    return this._isReady;
  }

  setReady(ready: boolean) {
    this._isReady = ready;
  }

  async ready() {
    return Promise.resolve();
  }

  // Reset all mocks and state
  reset() {
    this.loadBuffer.mockClear();
    this.createSource.mockClear();
    this.createStreamSource.mockClear();
    this.addStreamChunk.mockClear();
    this.startSource.mockClear();
    this.stopSource.mockClear();
    this.pauseSource.mockClear();
    this.resumeSource.mockClear();
    this.seekSource.mockClear();
    this.setSourceVolume.mockClear();
    this.setSourcePan.mockClear();
    this.setVolume.mockClear();
    this.setPan.mockClear();
    this.setDelayTime.mockClear();
    this.setDelayFeedback.mockClear();
    this.setDelayMix.mockClear();
    this.connectInput.mockClear();
    this.addEffect.mockClear();
    this.removeEffect.mockClear();
    this.updateEffect.mockClear();
    this.reorderEffects.mockClear();
    this.cleanup.mockClear();
    
    this.state.buffers.clear();
    this.state.sources.clear();
    this.state.globalVolume = 1;
    this.state.globalPan = 0;
    this.eventCallbacks.clear();
    this._isReady = true;
  }
}

/**
 * Create a mock engine with default ready state.
 */
export function createMockEngine(): MockCacophonyEngine {
  return new MockCacophonyEngine();
}
