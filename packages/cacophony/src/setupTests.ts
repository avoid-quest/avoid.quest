import { mock } from "bun:test";
import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";

import type { ICache } from "./cache.js";

// Mock AudioWorkletNode globally
global.AudioWorkletNode = class AudioWorkletNode {
  port = {
    postMessage: mock(),
    onmessage: null,
  };
  parameters = {
    get: mock().mockReturnValue({
      value: 0,
      linearRampToValueAtTime: mock(),
      exponentialRampToValueAtTime: mock(),
      setTargetAtTime: mock(),
      setValueAtTime: mock(),
      cancelScheduledValues: mock(),
    }),
  };
  connect = mock();
  disconnect = mock();
} as any;

import { Cacophony } from "./cacophony.js";

// Re-export test helpers for engine tests
export { createMockEngine, MockCacophonyEngine } from "./test/engine-mock.js";
export { createTestCacophonyWithMockEngine, mockEngine, createMockBuffer } from "./test/test-helpers.js";

// Create a mock AudioContext for testing
export const audioContextMock = new AudioContext();
Object.defineProperty(audioContextMock, "audioWorklet", {
  value: {
    addModule: mock().mockResolvedValue(undefined),
  },
  writable: true,
});

// Create a mock cache with spyable methods
// Bun's mock() creates a spy function that tracks calls
export const mockCache: ICache = {
  getAudioBuffer: mock().mockResolvedValue(new AudioBuffer({ length: 100, sampleRate: 44100 }) as unknown as AudioBuffer),
  clearMemoryCache: mock(),
};

// Create a Cacophony instance with the mock context and cache
export const cacophony = new Cacophony(
  audioContextMock as any,
  mockCache as any
);
