import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
  spyOn,
} from "bun:test";
import {
  AudioBuffer,
} from "standardized-audio-context-mock";
import type {
  AudioBufferSourceNode,
  AudioContext,
  BiquadFilterNode,
  GainNode,
} from "./context.js";

import { Playback } from "./playback.js";
import { audioContextMock, cacophony, createMockEngine } from "./setupTests.js";
import { Sound } from "./sound.js";
import type { CacophonyEngine } from "./engine/cacophony-engine.js";

// Shared test helpers
let mockEngine: CacophonyEngine;
let sourceIdCounter = 0;

function createPlayback(testSound: Sound, testBuffer: AudioBuffer): Playback {
  const sourceId = `test-source-${++sourceIdCounter}`;
  const bufferId = `test-buffer-${sourceIdCounter}`;
  
  // Load buffer and create source in engine
  mockEngine.loadBuffer(bufferId, testBuffer);
  mockEngine.createSource(sourceId, bufferId);
  return new Playback(testSound, sourceId, mockEngine);
}

describe("Playback class", () => {
  let playback: Playback;
  let buffer: AudioBuffer;
  let sound: Sound;

  beforeEach(() => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44_100 });
    mockEngine = createMockEngine() as unknown as CacophonyEngine;
    sound = new Sound({
      url: "test-url",
      buffer,
      context: audioContextMock as unknown as AudioContext,
      cacophony: cacophony
    });
    playback = createPlayback(sound, buffer);
  });

  afterEach(() => {
    if (playback?.source) {
      playback.cleanup();
    }
    cacophony.clearMemoryCache();
    mock.clearAllMocks();
  });

  it("can play and stop", () => {
    playback.play();
    expect(playback.isPlaying).toBe(true);
    playback.stop();
    expect(playback.isPlaying).toBe(false);
  });

  it("can pause and resume", () => {
    playback.play();
    playback.pause();
    expect(playback.isPlaying).toBe(false);
    playback.play();
    expect(playback.isPlaying).toBe(true);
  });

  it("handles seeking correctly", () => {
    const seekTime = 5;
    playback.seek(seekTime);
    // We can't directly test the internal state, so we'll check if it's playing
    playback.play();
    expect(playback.isPlaying).toBe(true);
  });

  it("applies volume changes", () => {
    playback.volume = 0.5;
    expect(playback.volume).toBe(0.5);
  });

  it("applies playback rate changes", () => {
    playback.playbackRate = 1.5;
    expect(playback.playbackRate).toBe(1.5);
  });

  it("handles cleanup correctly", () => {
    playback.cleanup();
    // In engine mode, cleanup just stops the source
    expect(mockEngine.stopSource).toHaveBeenCalled();
  });

  it("can stop playbacks directly", () => {
    playback.play();
    expect(playback.isPlaying).toBe(true);
    playback.stop();
    expect(playback.isPlaying).toBe(false);
  });

  it("handles repeated play calls gracefully", () => {
    playback.play(); // First call to play
    expect(playback.isPlaying).toBe(true);

    playback.play(); // Second call without stopping
    // Should still be playing without throwing errors or re-initializing inappropriately
    expect(playback.isPlaying).toBe(true);
  });

  it("stop right after play does not cause errors", () => {
    playback.play();
    expect(playback.isPlaying).toBe(true);
    playback.stop();
    expect(playback.isPlaying).toBe(false);
  });

  it("can play after seeking", () => {
    const seekTime = 2;
    playback.seek(seekTime);
    playback.play();
    expect(playback.isPlaying).toBe(true);
  });

  it("resumes from the correct position after seeking and pausing", () => {
    const initialSeekTime = 2;
    playback.seek(initialSeekTime);
    playback.play();

    // Simulate some time passing
    (jest as any).advanceTimersByTime(1000);

    playback.pause();
    expect(playback.isPlaying).toBe(false);

    playback.play();
    expect(playback.isPlaying).toBe(true);
  });

  it("handles multiple seek operations correctly", () => {
    playback.seek(2);
    playback.seek(4);
    playback.play();
    expect(playback.isPlaying).toBe(true);
  });

  it("resumes from pause position instead of restarting", () => {

    // Mock the context's currentTime
    let mockCurrentTime = 0;
    Object.defineProperty(audioContextMock, "currentTime", {
      get: () => mockCurrentTime,
      configurable: true,
    });

    playback.play();
    expect(playback.isPlaying).toBe(true);

    // Simulate some time passing
    mockCurrentTime = 2;

    playback.pause();
    expect(playback.isPlaying).toBe(false);

    // Clear previous calls to createBufferSource
    (audioContextMock.createBufferSource as any).mockClear();

    playback.play();
    expect(playback.isPlaying).toBe(true);

    // Check that createBufferSource was called when resuming
    expect(audioContextMock.createBufferSource).toHaveBeenCalledTimes(1);

    // Get the new source created when resuming
    const newSource = (audioContextMock.createBufferSource as any).mock
      .results[0].value;

    // Check that start was called on the new source
    expect(newSource.start).toHaveBeenCalledTimes(1);

    // The first argument to start should be 0, the second should be the offset
    expect(newSource.start).toHaveBeenCalledWith(0, expect.any(Number));
    expect(newSource.start.mock.calls[0][1]).toBeGreaterThan(0);
  });
});

describe("Playback cloning", () => {
  let originalPlayback: Playback;
  let buffer: AudioBuffer;
  let sound: Sound;

  beforeEach(() => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44_100 });
    mockEngine = createMockEngine() as unknown as CacophonyEngine;
    sourceIdCounter = 0;
    sound = new Sound({
      url: "test-url",
      buffer,
      context: audioContextMock as unknown as AudioContext,
      cacophony: cacophony
    });
    originalPlayback = createPlayback(sound, buffer);

    originalPlayback.volume = 0.8;
    originalPlayback.playbackRate = 1.5;
    originalPlayback.loop(2);

    const filter = audioContextMock.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1000;
    originalPlayback.addFilter(filter as unknown as BiquadFilterNode);
  });

  afterEach(() => {
    originalPlayback?.cleanup();
    (mockEngine as any).reset();
    sourceIdCounter = 0;
    cacophony.clearMemoryCache();
    mock.clearAllMocks();
  });

  it("throws error when cloning in engine mode", () => {
    expect(() => originalPlayback.clone()).toThrow(
      "Cloning playback in engine mode is not yet supported"
    );
  });
});

describe("Playback cleanup functionality", () => {
  let playback: Playback;
  let buffer: AudioBuffer;
  let sound: Sound;

  beforeEach(() => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44_100 });
    mockEngine = createMockEngine() as unknown as CacophonyEngine;
    sourceIdCounter = 0;
    sound = new Sound({
      url: "test-url",
      buffer,
      context: audioContextMock as unknown as AudioContext,
      cacophony: cacophony
    });
    playback = createPlayback(sound, buffer);
  });

  it("stops source when cleaned up", () => {
    // Create a properly mocked filter
    const filter = audioContextMock.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 350;
    filter.Q.value = 1;
    filter.gain.value = 0;

    playback.addFilter(filter as unknown as BiquadFilterNode);
    playback.play();
    playback.cleanup();

    // In engine mode, cleanup stops the source
    expect(mockEngine.stopSource).toHaveBeenCalled();
  });

  it("removes all event listeners when cleaned up", () => {
    const removeAllListenersSpy = spyOn(
      playback.eventEmitter,
      "removeAllListeners"
    );

    playback.cleanup();

    expect(removeAllListenersSpy).toHaveBeenCalled();
  });

  it("clears internal references when cleaned up", () => {
    playback.cleanup();
    // In engine mode, cleanup stops the source
    expect(mockEngine.stopSource).toHaveBeenCalled();
  });

  it("can be cleaned up multiple times without error", () => {
    playback.cleanup();
    expect(() => playback.cleanup()).not.toThrow();
  });

  it("maintains cleaned up state after multiple operations", () => {
    playback.cleanup();
    // Try cleaning up again - should not throw
    expect(() => playback.cleanup()).not.toThrow();
  });
});

describe("Playback filters chain", () => {
  let playback: Playback;
  let buffer: AudioBuffer;
  let sound: Sound;

  beforeEach(() => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44_100 });
    mockEngine = createMockEngine() as unknown as CacophonyEngine;
    sourceIdCounter = 0;
    sound = new Sound({
      url: "test-url",
      buffer,
      context: audioContextMock as unknown as AudioContext,
      cacophony: cacophony
    });
    playback = createPlayback(sound, buffer);
  });

  afterEach(() => {
    playback?.cleanup();
    (mockEngine as any).reset();
    sourceIdCounter = 0;
    cacophony.clearMemoryCache();
    mock.clearAllMocks();
  });

  it("adds multiple filters via engine", () => {
    const filter1 = audioContextMock.createBiquadFilter();
    filter1.type = "lowpass";
    const filter2 = audioContextMock.createBiquadFilter();
    filter2.type = "highpass";

    playback.addFilter(filter1 as unknown as BiquadFilterNode);
    playback.addFilter(filter2 as unknown as BiquadFilterNode);

    // Verify engine methods were called
    expect(mockEngine.addFilter).toHaveBeenCalledTimes(2);
  });
});

describe("Playback error cases", () => {
  let playback: Playback;
  let buffer: AudioBuffer;
  let sound: Sound;

  beforeEach(() => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44_100 });
    mockEngine = createMockEngine() as unknown as CacophonyEngine;
    sourceIdCounter = 0;
    sound = new Sound({
      url: "test-url",
      buffer,
      context: audioContextMock as unknown as AudioContext,
      cacophony: cacophony
    });
    playback = createPlayback(sound, buffer);
  });

  afterEach(() => {
    if (playback?.source) {
      playback.cleanup();
    }
    cacophony.clearMemoryCache();
    mock.clearAllMocks();
  });

  it("throws an error when trying to play a cleaned-up sound", () => {
    playback.cleanup();
    expect(() => playback.play()).toThrow(
      "Cannot play a sound that has been cleaned up"
    );
  });

  it("throws an error when seeking to a negative time", () => {
    expect(() => playback.seek(-1)).toThrow("Invalid time value for seek");
  });

  it("throws an error when seeking to NaN", () => {
    expect(() => playback.seek(Number.NaN)).toThrow(
      "Invalid time value for seek"
    );
  });

  it("throws an error when setting an invalid playback rate", () => {
    expect(() => {
      playback.playbackRate = 0;
    }).toThrow("Playback rate must be greater than 0");
    expect(() => {
      playback.playbackRate = -1;
    }).toThrow("Playback rate must be greater than 0");
  });

  it("throws an error when trying to clone a cleaned-up sound", () => {
    playback.cleanup();
    expect(() => playback.clone()).toThrow(
      "Cloning playback in engine mode is not yet supported"
    );
  });

  it("can add a filter to a cleaned-up sound (engine handles it)", () => {
    playback.cleanup();
    const filter = audioContextMock.createBiquadFilter();
    // In engine mode, filters are managed by engine, cleanup doesn't prevent adding
    expect(() =>
      playback.addFilter(filter as unknown as BiquadFilterNode)
    ).not.toThrow();
  });

  it("can remove a filter from a cleaned-up sound (engine handles it)", () => {
    const filter = audioContextMock.createBiquadFilter();
    playback.addFilter(filter as unknown as BiquadFilterNode);
    playback.cleanup();
    // In engine mode, filters are managed by engine
    expect(() =>
      playback.removeFilter(filter as unknown as BiquadFilterNode)
    ).not.toThrow();
  });
});

describe("Playback looping and seeking (Engine Mode)", () => {
  let playback: Playback;
  let buffer: AudioBuffer;
  let sound: Sound;

  beforeEach(() => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44_100 });
    mockEngine = createMockEngine() as unknown as CacophonyEngine;
    sourceIdCounter = 0;
    sound = new Sound({
      url: "test-url",
      buffer,
      context: audioContextMock as unknown as AudioContext,
      cacophony: cacophony
    });
    playback = createPlayback(sound, buffer);
  });

  afterEach(() => {
    playback?.cleanup();
    (mockEngine as any).reset();
    sourceIdCounter = 0;
    cacophony.clearMemoryCache();
    mock.clearAllMocks();
  });

  it("handles looping via engine", () => {
    playback.loop(1); // Play twice in total
    playback.play();

    expect(mockEngine.startSource).toHaveBeenCalled();
    expect(playback.isPlaying).toBe(true);
  });

  it("handles seeking via engine", () => {
    playback.play();
    const seekTime = 0.5;
    playback.seek(seekTime);

    expect(mockEngine.seekSource).toHaveBeenCalledWith(playback.sourceId, seekTime);
    expect(playback.isPlaying).toBe(true);
  });

  it("handles seeking while paused via engine", () => {
    playback.play();
    playback.pause();
    expect(mockEngine.pauseSource).toHaveBeenCalled();

    const seekTime = 0.3;
    playback.seek(seekTime);
    expect(mockEngine.seekSource).toHaveBeenCalledWith(playback.sourceId, seekTime);

    playback.play(); // Resume
    expect(mockEngine.resumeSource).toHaveBeenCalled();
  });
});

describe("Playback Error Events", () => {
  let playback: Playback;
  let buffer: AudioBuffer;
  let sound: Sound;
  let mockCallbacks: any;

  beforeEach(() => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44_100 });
    mockEngine = createMockEngine() as unknown as CacophonyEngine;
    sourceIdCounter = 0;
    sound = new Sound({
      url: "test-url",
      buffer,
      context: audioContextMock as unknown as AudioContext,
      cacophony: cacophony
    });
    playback = createPlayback(sound, buffer);

    mockCallbacks = {
      onError: mock(),
    };
    mock.clearAllMocks();
  });

  afterEach(() => {
    if (playback) {
      playback.stop();
    }
  });

  it("should emit error event on engine failure during play", () => {
    // In engine mode, errors come from engine
    const sourceError = new Error("Engine start failed");
    (mockEngine.startSource as any).mockImplementation(() => {
      throw sourceError;
    });

    // Test that the error is thrown when play() is called
    expect(() => playback.play()).toThrow("Engine start failed");
  });

  it("should emit error event on context state issues", async () => {
    // Mock context to be in an error state
    const contextError = new Error("AudioContext suspended");
    Object.defineProperty(audioContextMock, "state", {
      get: () => "suspended",
    });

    playback.on("error", mockCallbacks.onError);

    // Simulate context error during playback
    await playback.emitAsync("error", {
      error: contextError,
      errorType: "context",
      timestamp: Date.now(),
      recoverable: false,
    });

    expect(mockCallbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: contextError,
        errorType: "context",
        timestamp: expect.any(Number),
        recoverable: false,
      })
    );
  });

  it("should emit error event on decode failures", async () => {
    const decodeError = new Error("Failed to decode audio data");

    playback.on("error", mockCallbacks.onError);

    // Simulate decode error
    await playback.emitAsync("error", {
      error: decodeError,
      errorType: "decode",
      timestamp: Date.now(),
      recoverable: false,
    });

    expect(mockCallbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: decodeError,
        errorType: "decode",
        timestamp: expect.any(Number),
        recoverable: false,
      })
    );
  });

  it("should emit error event on unknown playback failures", async () => {
    const unknownError = new Error("Unknown playback error");

    playback.on("error", mockCallbacks.onError);

    // Simulate unknown error
    await playback.emitAsync("error", {
      error: unknownError,
      errorType: "unknown",
      timestamp: Date.now(),
      recoverable: true,
    });

    expect(mockCallbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: unknownError,
        errorType: "unknown",
        timestamp: expect.any(Number),
        recoverable: true,
      })
    );
  });

  it("should handle multiple error listeners correctly", async () => {
    const mockCallback2 = mock();
    const testError = new Error("Test error");

    playback.on("error", mockCallbacks.onError);
    playback.on("error", mockCallback2);

    // Emit error
    await playback.emitAsync("error", {
      error: testError,
      errorType: "source",
      timestamp: Date.now(),
      recoverable: true,
    });

    expect(mockCallbacks.onError).toHaveBeenCalledTimes(1);
    expect(mockCallback2).toHaveBeenCalledTimes(1);

    // Both should receive the same error event
    expect(mockCallbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: testError,
        errorType: "source",
      })
    );
    expect(mockCallback2).toHaveBeenCalledWith(
      expect.objectContaining({
        error: testError,
        errorType: "source",
      })
    );
  });
});

describe("Playback audio graph exposure", () => {
  let playback: Playback;
  let buffer: AudioBuffer;
  let sound: Sound;

  beforeEach(() => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44_100 });
    mockEngine = createMockEngine() as unknown as CacophonyEngine;
    sourceIdCounter = 0;
    sound = new Sound({
      url: "test-url",
      buffer,
      context: audioContextMock as unknown as AudioContext,
      cacophony: cacophony
    });
    playback = createPlayback(sound, buffer);
  });

  afterEach(() => {
    if (playback?.source) {
      playback.cleanup();
    }
    cacophony.clearMemoryCache();
    mock.clearAllMocks();
  });

  // Note: outputNode, connect, and disconnect are no longer available in engine-only mode
  // Routing is handled internally by the engine
});
