/**
 * Tests for the MockCacophonyEngine and test helpers.
 * 
 * These tests verify the mock engine properly tracks method calls
 * and simulates events for testing engine-based audio features.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { AudioBuffer } from "standardized-audio-context-mock";
import { 
  MockCacophonyEngine, 
  createMockEngine,
} from "./engine-mock.js";

describe("MockCacophonyEngine", () => {
  let mockEngine: MockCacophonyEngine;

  beforeEach(() => {
    mockEngine = createMockEngine();
    mockEngine.reset();
  });

  describe("Buffer and Source Management", () => {
    it("tracks buffer loading", () => {
      const buffer = new AudioBuffer({ length: 100, sampleRate: 44100, numberOfChannels: 2 });
      
      mockEngine.loadBuffer("test-buffer", buffer);
      
      expect(mockEngine.loadBuffer).toHaveBeenCalledWith("test-buffer", buffer);
      expect(mockEngine.state.buffers.has("test-buffer")).toBe(true);
      expect(mockEngine.state.buffers.get("test-buffer")).toEqual({
        id: "test-buffer",
        channels: 2,
        sampleRate: 44100,
      });
    });

    it("tracks source creation", () => {
      mockEngine.createSource("source-1", "buffer-1", { loop: true, playbackRate: 1.5 });
      
      expect(mockEngine.createSource).toHaveBeenCalledWith("source-1", "buffer-1", { loop: true, playbackRate: 1.5 });
      expect(mockEngine.state.sources.has("source-1")).toBe(true);
      
      const source = mockEngine.state.sources.get("source-1");
      expect(source?.type).toBe("buffer");
      expect(source?.loop).toBe(true);
      expect(source?.playbackRate).toBe(1.5);
    });

    it("tracks stream source creation", () => {
      mockEngine.createStreamSource("stream-1");
      
      expect(mockEngine.createStreamSource).toHaveBeenCalledWith("stream-1");
      expect(mockEngine.state.sources.has("stream-1")).toBe(true);
      expect(mockEngine.state.sources.get("stream-1")?.type).toBe("stream");
    });
  });

  describe("Source Lifecycle", () => {
    beforeEach(() => {
      mockEngine.createSource("source-1", "buffer-1");
    });

    it("tracks source start", () => {
      mockEngine.startSource("source-1", { offset: 1.0 });
      
      expect(mockEngine.startSource).toHaveBeenCalledWith("source-1", { offset: 1.0 });
      expect(mockEngine.state.sources.get("source-1")?.playing).toBe(true);
    });

    it("tracks source stop", () => {
      mockEngine.startSource("source-1");
      mockEngine.stopSource("source-1");
      
      expect(mockEngine.stopSource).toHaveBeenCalledWith("source-1");
      expect(mockEngine.state.sources.get("source-1")?.playing).toBe(false);
    });

    it("tracks source pause/resume", () => {
      mockEngine.startSource("source-1");
      mockEngine.pauseSource("source-1");
      
      expect(mockEngine.state.sources.get("source-1")?.paused).toBe(true);
      expect(mockEngine.state.sources.get("source-1")?.playing).toBe(false);
      
      mockEngine.resumeSource("source-1");
      
      expect(mockEngine.state.sources.get("source-1")?.paused).toBe(false);
      expect(mockEngine.state.sources.get("source-1")?.playing).toBe(true);
    });

    it("tracks source volume and pan", () => {
      mockEngine.setSourceVolume("source-1", 0.5);
      mockEngine.setSourcePan("source-1", -0.3);
      
      expect(mockEngine.setSourceVolume).toHaveBeenCalledWith("source-1", 0.5);
      expect(mockEngine.setSourcePan).toHaveBeenCalledWith("source-1", -0.3);
      expect(mockEngine.state.sources.get("source-1")?.volume).toBe(0.5);
      expect(mockEngine.state.sources.get("source-1")?.pan).toBe(-0.3);
    });
  });

  describe("Global Controls", () => {
    it("tracks global volume", () => {
      mockEngine.setVolume(0.7);
      
      expect(mockEngine.setVolume).toHaveBeenCalledWith(0.7);
      expect(mockEngine.state.globalVolume).toBe(0.7);
    });

    it("tracks global pan", () => {
      mockEngine.setPan(0.5);
      
      expect(mockEngine.setPan).toHaveBeenCalledWith(0.5);
      expect(mockEngine.state.globalPan).toBe(0.5);
    });
  });

  describe("Event Simulation", () => {
    it("simulates source ended event", () => {
      mockEngine.createSource("source-1", "buffer-1");
      mockEngine.startSource("source-1");
      
      const endedCallback = mock(() => {});
      mockEngine.on("sourceEnded", endedCallback);
      
      mockEngine.simulateSourceEnded("source-1", "finished");
      
      expect(endedCallback).toHaveBeenCalledWith({ sourceId: "source-1", reason: "finished" });
      expect(mockEngine.state.sources.get("source-1")?.playing).toBe(false);
    });

    it("simulates source error event", () => {
      mockEngine.createSource("source-1", "buffer-1");
      
      const errorCallback = mock(() => {});
      mockEngine.on("sourceError", errorCallback);
      
      mockEngine.simulateSourceError("source-1", "Decode failed");
      
      expect(errorCallback).toHaveBeenCalledWith({ sourceId: "source-1", error: "Decode failed" });
    });

    it("allows removing event listeners", () => {
      const callback = mock(() => {});
      mockEngine.on("sourceEnded", callback);
      mockEngine.off("sourceEnded", callback);
      
      mockEngine.emitEvent("sourceEnded", { sourceId: "test" });
      
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("Ready State", () => {
    it("defaults to ready", () => {
      expect(mockEngine.isReady).toBe(true);
    });

    it("can be set to not ready", () => {
      mockEngine.setReady(false);
      expect(mockEngine.isReady).toBe(false);
    });

    it("ready() resolves immediately", async () => {
      await expect(mockEngine.ready()).resolves.toBeUndefined();
    });
  });

  describe("Reset", () => {
    it("clears all state and mocks", () => {
      const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      mockEngine.loadBuffer("buffer-1", buffer);
      mockEngine.createSource("source-1", "buffer-1");
      mockEngine.setVolume(0.5);
      
      mockEngine.reset();
      
      expect(mockEngine.loadBuffer).not.toHaveBeenCalled();
      expect(mockEngine.state.buffers.size).toBe(0);
      expect(mockEngine.state.sources.size).toBe(0);
      expect(mockEngine.state.globalVolume).toBe(1);
      expect(mockEngine.isReady).toBe(true);
    });
  });
});
