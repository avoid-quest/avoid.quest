/**
 * Test helpers for Cacophony tests that need engine integration.
 * 
 * Usage:
 *   import { createTestCacophonyWithMockEngine, mockEngine } from "./test/test-helpers";
 *   
 *   beforeEach(() => {
 *     mockEngine.reset();
 *   });
 *   
 *   const cacophony = createTestCacophonyWithMockEngine();
 */
import { mock } from "bun:test";
import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";
import { MockCacophonyEngine, createMockEngine } from "./engine-mock.js";
import type { ICache } from "../cache.js";
import { Cacophony } from "../cacophony.js";

// Create a singleton mock engine for tests
export const mockEngine = createMockEngine();

// Create a mock cache with spyable methods
export const mockCache: ICache = {
  getAudioBuffer: mock(() =>
    Promise.resolve(new AudioBuffer({ length: 100, sampleRate: 44_100 }) as any)
  ),
  clearMemoryCache: mock(() => {
    //
  }),
};

/**
 * Creates a Cacophony instance with the engine property replaced by a mock.
 * 
 * This allows testing engine-based features without needing AudioWorklet support.
 */
export function createTestCacophonyWithMockEngine(
  context?: AudioContext,
  cache?: ICache
): Cacophony & { engine: MockCacophonyEngine } {
  const audioContext = context || new AudioContext();
  // Cast to any to work around type differences between mock and real AudioContext
  const cacophony = new Cacophony(audioContext as any, cache || mockCache);
  
  // Replace the real engine with our mock
  (cacophony as any).engine = mockEngine;
  
  return cacophony as Cacophony & { engine: MockCacophonyEngine };
}

/**
 * Creates a mock AudioBuffer for testing.
 */
export function createMockBuffer(
  length = 100,
  sampleRate = 44_100,
  numberOfChannels = 2
): AudioBuffer {
  return new AudioBuffer({ length, sampleRate, numberOfChannels });
}
