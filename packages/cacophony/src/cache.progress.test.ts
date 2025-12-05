import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";
import { AudioCache } from "./cache.js";

describe("AudioCache Progress Tracking", () => {
  let audioContextMock: AudioContext;
  let cache: AudioCache;
  let mockCallbacks: {
    onLoadingStart?: (event: any) => void;
    onLoadingProgress?: (event: any) => void;
    onLoadingComplete?: (event: any) => void;
    onLoadingError?: (event: any) => void;
    onCacheHit?: (event: any) => void;
    onCacheMiss?: (event: any) => void;
    onCacheError?: (event: any) => void;
  };

  beforeEach(() => {
    audioContextMock = new AudioContext();
    cache = new AudioCache();
    mockCallbacks = {
      onLoadingStart: mock(),
      onLoadingProgress: mock(),
      onLoadingComplete: mock(),
      onLoadingError: mock(),
      onCacheHit: mock(),
      onCacheMiss: mock(),
      onCacheError: mock(),
    };
    mock.clearAllMocks();
  });

  afterEach(() => {
    cache.clearMemoryCache();
  });

  // Mock ReadableStream utilities for testing
  function createMockReadableStream(
    chunks: Uint8Array[]
  ): ReadableStream<Uint8Array> {
    let chunkIndex = 0;
    return new ReadableStream({
      start(controller) {
        function pump() {
          if (chunkIndex >= chunks.length) {
            controller.close();
            return;
          }
          controller.enqueue(chunks[chunkIndex]);
          chunkIndex += 1;
          // Use setTimeout to simulate async chunk delivery
          setTimeout(pump, 10);
        }
        pump();
      },
    });
  }

  function createMockResponse(
    arrayBuffer: ArrayBuffer,
    options: {
      contentLength?: number;
      status?: number;
      headers?: Record<string, string>;
    } = {}
  ): Response {
    const { contentLength, status = 200, headers = {} } = options;

    // Create chunks for streaming simulation
    const uint8Array = new Uint8Array(arrayBuffer);
    const chunkSize = Math.max(1, Math.floor(uint8Array.length / 4)); // 4 chunks
    const chunks: Uint8Array[] = [];

    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      chunks.push(uint8Array.slice(i, i + chunkSize));
    }

    const responseHeaders = new Headers(headers);
    if (contentLength !== undefined) {
      responseHeaders.set("content-length", contentLength.toString());
    }

    const mockResponse = {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Not Modified",
      headers: responseHeaders,
      body: createMockReadableStream(chunks),
      arrayBuffer: () => Promise.resolve(arrayBuffer.slice(0)),
      clone: () => mockResponse,
    } as unknown as Response;

    return mockResponse;
  }

  describe("Mock Utilities Validation", () => {
    it("should create mock ReadableStream that delivers chunks", async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      const chunks = [testData.slice(0, 2), testData.slice(2)];
      const stream = createMockReadableStream(chunks);

      const reader = stream.getReader();
      const result1 = await reader.read();
      const result2 = await reader.read();
      const result3 = await reader.read();

      expect(result1.done).toBe(false);
      expect(result1.value).toEqual(chunks[0]);
      expect(result2.done).toBe(false);
      expect(result2.value).toEqual(chunks[1]);
      expect(result3.done).toBe(true);
    });

    it("should create mock Response with proper headers", () => {
      const arrayBuffer = new ArrayBuffer(1024);
      const response = createMockResponse(arrayBuffer, {
        contentLength: 1024,
        headers: { etag: '"test-etag"' },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("1024");
      expect(response.headers.get("etag")).toBe('"test-etag"');
      expect(response.body).toBeDefined();
    });
  });

  describe("Progress Tracking Tests (Should Fail Initially)", () => {
    beforeEach(() => {
      // Clear any existing cache
      cache.clearMemoryCache();

      // Mock caches.open to return a working cache
      global.caches = {
        open: mock(() =>
          Promise.resolve({
            match: mock(() => Promise.resolve(null)),
            put: mock(() => Promise.resolve(undefined)),
            delete: mock(() => Promise.resolve(true)),
          })
        ),
      } as any;
    });

    it("should track progress with known Content-Length", async () => {
      const testUrl = "https://example.com/audio-with-length.mp3";
      const mockArrayBuffer = new ArrayBuffer(1024);
      const mockAudioBuffer = new AudioBuffer({
        length: 100,
        sampleRate: 44_100,
      });

      // Mock fetch to return response with Content-Length
      global.fetch = mock(() =>
        Promise.resolve(
          createMockResponse(mockArrayBuffer, {
            contentLength: 1024,
            headers: { "content-type": "audio/mpeg" },
          })
        )
      ) as any;

      audioContextMock.decodeAudioData = mock(() =>
        Promise.resolve(mockAudioBuffer)
      );

      await cache.getAudioBuffer(
        audioContextMock as any,
        testUrl,
        undefined,
        mockCallbacks
      );

      // Verify progress callback was called with proper data structure
      expect(mockCallbacks.onLoadingProgress).toHaveBeenCalled();

      // Check the calls have correct data format
      const progressCalls = (mockCallbacks.onLoadingProgress as any).mock.calls;
      expect(progressCalls.length).toBeGreaterThan(0);

      // Verify each progress call has correct structure
      for (const call of progressCalls) {
        const event = call[0];
        // Check structure and types
        expect(event.url).toBe(testUrl);
        expect(event.total).toBe(1024);
        expect(typeof event.loaded).toBe("number");
        expect(typeof event.progress).toBe("number");
        expect(typeof event.timestamp).toBe("number");
        // Check value ranges
        expect(event.progress).toBeGreaterThanOrEqual(0);
        expect(event.progress).toBeLessThanOrEqual(1);
        expect(event.loaded).toBeGreaterThanOrEqual(0);
        expect(event.loaded).toBeLessThanOrEqual(1024);
      }

      // Verify final progress is 100%
      const finalCall = progressCalls.at(-1)?.[0];
      if (finalCall) {
        expect(finalCall.loaded).toBe(1024);
        expect(finalCall.progress).toBe(1);
      }
    });

    it("should track progress without Content-Length (progress: -1)", async () => {
      const testUrl = "https://example.com/audio-no-length.mp3";
      const mockArrayBuffer = new ArrayBuffer(512);
      const mockAudioBuffer = new AudioBuffer({
        length: 50,
        sampleRate: 44_100,
      });

      // Mock fetch to return response WITHOUT Content-Length
      global.fetch = mock(() =>
        Promise.resolve(
          createMockResponse(mockArrayBuffer, {
            // No contentLength specified
            headers: { "content-type": "audio/mpeg" },
          })
        )
      ) as any;

      audioContextMock.decodeAudioData = mock(() =>
        Promise.resolve(mockAudioBuffer)
      );

      await cache.getAudioBuffer(
        audioContextMock as any,
        testUrl,
        undefined,
        mockCallbacks
      );

      // Verify progress callback was called
      expect(mockCallbacks.onLoadingProgress).toHaveBeenCalled();

      const progressCalls = (mockCallbacks.onLoadingProgress as any).mock.calls;
      expect(progressCalls.length).toBeGreaterThan(0);

      // Verify each progress call has correct structure for unknown length
      for (const call of progressCalls) {
        const event = call[0];
        // Check structure and types
        expect(event.url).toBe(testUrl);
        expect(event.total).toBeNull();
        expect(event.progress).toBe(-1);
        expect(typeof event.loaded).toBe("number");
        expect(typeof event.timestamp).toBe("number");
        // Check value ranges
        expect(event.loaded).toBeGreaterThan(0);
      }
    });

    it("should handle AbortSignal during progress tracking", async () => {
      const testUrl = "https://example.com/audio-abort.mp3";
      const mockArrayBuffer = new ArrayBuffer(2048);

      // Create AbortController and signal
      const abortController = new AbortController();

      // Mock fetch with delay to allow abortion
      global.fetch = mock(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(
                createMockResponse(mockArrayBuffer, {
                  contentLength: 2048,
                })
              );
            }, 50);
          })
      ) as any;

      // Start the request
      const requestPromise = cache.getAudioBuffer(
        audioContextMock as any,
        testUrl,
        abortController.signal,
        mockCallbacks
      );

      // Abort after a short delay
      setTimeout(() => abortController.abort(), 25);

      // Should throw AbortError
      await expect(requestPromise).rejects.toThrow("Operation was aborted");

      // Progress callbacks should have been called before abort
      expect(mockCallbacks.onLoadingStart).toHaveBeenCalled();
    });

    it("should deduplicate callbacks for concurrent requests", async () => {
      const testUrl = "https://example.com/audio-concurrent.mp3";
      const mockArrayBuffer = new ArrayBuffer(256);
      const mockAudioBuffer = new AudioBuffer({
        length: 25,
        sampleRate: 44_100,
      });

      const callbacks1 = { onLoadingProgress: mock() };
      const callbacks2 = { onLoadingProgress: mock() };

      // Mock fetch with slight delay
      global.fetch = mock(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  createMockResponse(mockArrayBuffer, { contentLength: 256 })
                ),
              20
            )
          )
      ) as any;

      audioContextMock.decodeAudioData = mock(() =>
        Promise.resolve(mockAudioBuffer)
      );

      // Start two concurrent requests
      const [result1, result2] = await Promise.all([
        cache.getAudioBuffer(audioContextMock as any, testUrl, undefined, callbacks1),
        cache.getAudioBuffer(audioContextMock as any, testUrl, undefined, callbacks2),
      ]);

      expect(result1).toBe(result2); // Same buffer instance from deduplication
      expect(global.fetch).toHaveBeenCalledTimes(1); // Only one fetch

      // Both callbacks should have received progress events
      expect(callbacks1.onLoadingProgress).toHaveBeenCalled();
      expect(callbacks2.onLoadingProgress).toHaveBeenCalled();

      // Progress data should be identical
      const calls1 = (callbacks1.onLoadingProgress as any).mock.calls;
      const calls2 = (callbacks2.onLoadingProgress as any).mock.calls;
      expect(calls1.length).toBe(calls2.length);
      expect(calls1).toEqual(calls2);
    });

    it("should not emit progress for 304 Not Modified responses", async () => {
      const testUrl = "https://example.com/audio-304.mp3";
      const mockArrayBuffer = new ArrayBuffer(128);
      const mockAudioBuffer = new AudioBuffer({
        length: 12,
        sampleRate: 44_100,
      });

      // Mock cache with existing content
      global.caches = {
        open: mock(() =>
          Promise.resolve({
            match: mock((url) => {
              if (url.endsWith(":meta")) {
                return Promise.resolve({
                  ok: true,
                  json: () =>
                    Promise.resolve({
                      url: testUrl,
                      etag: '"cached-version"',
                      timestamp: Date.now() - 1000,
                    }),
                });
              }
              if (url === testUrl) {
                return Promise.resolve({
                  ok: true,
                  arrayBuffer: () => Promise.resolve(mockArrayBuffer),
                });
              }
              return Promise.resolve(null);
            }),
            put: mock(),
            delete: mock(),
          })
        ),
      } as any;

      // Mock 304 response
      global.fetch = mock(() =>
        Promise.resolve({
          status: 304,
          statusText: "Not Modified",
          ok: false,
          headers: new Headers(),
        })
      ) as any;

      audioContextMock.decodeAudioData = mock(() =>
        Promise.resolve(mockAudioBuffer)
      );

      await cache.getAudioBuffer(
        audioContextMock as any,
        testUrl,
        undefined,
        mockCallbacks
      );

      // Should not call progress callback for 304 responses
      expect(mockCallbacks.onLoadingProgress).not.toHaveBeenCalled();
      expect(mockCallbacks.onCacheHit).toHaveBeenCalled();
    });
  });
});
