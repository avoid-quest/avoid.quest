import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";
import { createStream } from "./stream.js";

describe("Stream operations with AbortController", () => {
  let audioContextMock: AudioContext;
  let mockFetch: any;
  let mockReader: any;
  let mockResponse: any;
  let consoleSpy: any;
  let mockEngine: any;

  beforeEach(() => {
    audioContextMock = new AudioContext();
    mockEngine = {
        addStreamChunk: mock(),
    };

    // Mock console to avoid test output noise
    consoleSpy = spyOn(console, "error").mockImplementation(() => {
      // Suppress console errors in test
    });
    const _consoleLogSpy = spyOn(console, "log").mockImplementation(() => {
      // Suppress console logs in test
    });

    // Mock fetch and response body reader
    mockReader = {
      read: mock(),
      cancel: mock(() => Promise.resolve(undefined)),
    };

    mockResponse = {
      ok: true,
      status: 200,
      body: {
        getReader: mock(() => mockReader),
        cancel: mock(),
      },
    };

    mockFetch = mock(() => Promise.resolve(mockResponse));
    global.fetch = mockFetch;

    // Mock decodeAudioData to prevent infinite recursion
    // Mock decodeAudioData to prevent infinite recursion
    audioContextMock.decodeAudioData = mock((buffer: any, success?: any, error?: any) => {
        const mockBuffer = new AudioBuffer({ length: 100, sampleRate: 44_100 });
        if (success) {
            setTimeout(() => success(mockBuffer), 0);
            return Promise.resolve(mockBuffer);
        }
        return Promise.resolve(mockBuffer);
    }) as any;
  });

  afterEach(() => {
    mock.clearAllMocks();
    consoleSpy.mockRestore();
    audioContextMock.close();
  });

  it("should pass AbortSignal to fetch request", () => {
    const controller = new AbortController();

    // Mock simple completion to avoid infinite loop
    mockReader.read = mock(() =>
      Promise.resolve({ value: undefined, done: true })
    );

    createStream(
      "https://example.com/audio.wav",
      audioContextMock as any,
      mockEngine,
      "test-source",
      controller.signal
    );

    expect(mockFetch).toHaveBeenCalledWith("https://example.com/audio.wav", {
      signal: controller.signal,
    });
  });

  it("should work without AbortSignal (backward compatibility)", () => {
    // Mock simple completion to avoid infinite loop
    mockReader.read = mock(() =>
      Promise.resolve({ value: undefined, done: true })
    );

    createStream(
      "https://example.com/audio.wav",
      audioContextMock as any,
      mockEngine,
      "test-source"
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/audio.wav",
      undefined
    );
  });

  it("should return early when signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();

    createStream(
      "https://example.com/audio.wav",
      audioContextMock as any,
      mockEngine,
      "test-source",
      controller.signal
    );

    // Should not call fetch when already aborted
    expect(mockFetch).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      "Stream error:",
      expect.any(DOMException)
    );
  });

  it("should handle fetch rejection gracefully", async () => {
    mockFetch = mock(() => Promise.reject(new Error("Network error")));
    global.fetch = mockFetch;

    createStream(
      "https://example.com/audio.wav",
      audioContextMock as any,
      mockEngine,
      "test-source"
    );

    // Wait for promise rejection to be handled
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith("Stream error:", expect.any(Error));
  });

  it("should handle HTTP errors", async () => {
    mockResponse.ok = false;
    mockResponse.status = 404;

    createStream(
      "https://example.com/audio.wav",
      audioContextMock as any,
      mockEngine,
      "test-source"
    );

    // Wait for promise rejection to be handled
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith("Stream error:", expect.any(Error));
  });

  it("should handle missing response body", async () => {
    mockResponse.body = null;

    createStream(
      "https://example.com/audio.wav",
      audioContextMock as any,
      mockEngine,
      "test-source"
    );

    // Wait for promise rejection to be handled
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith("Stream error:", expect.any(Error));
  });

  it("should setup reader and abort listener", async () => {
    const controller = new AbortController();
    mockReader.read = mock(() =>
      Promise.resolve({ value: undefined, done: true })
    );

    createStream(
      "https://example.com/audio.wav",
      audioContextMock as any,
      mockEngine,
      "test-source",
      controller.signal
    );

    // Wait for fetch to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockResponse.body.getReader).toHaveBeenCalled();
  });
});
