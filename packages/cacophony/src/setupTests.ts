import { mock } from "bun:test";
import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";

import type { ICache } from "./cache";
import { Cacophony } from "./cacophony";

// Create a mock AudioContext for testing
export const audioContextMock = new AudioContext();

// Create a mock cache with spyable methods
// Bun's mock() creates a spy function that tracks calls
export const mockCache: ICache = {
  getAudioBuffer: mock(() =>
    Promise.resolve(new AudioBuffer({ length: 100, sampleRate: 44_100 }))
  ),
  clearMemoryCache: mock(() => {}),
};

// Create a Cacophony instance with the mock context and cache
export const cacophony = new Cacophony(audioContextMock, mockCache);
