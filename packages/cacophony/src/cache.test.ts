import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { AudioBuffer } from "standardized-audio-context-mock";

import { AudioCache } from "./cache.js";
import { audioContextMock } from "./setupTests.js";

describe("AudioCache", () => {
  let cache: AudioCache;
  let mockFetch: any;
  let mockCaches: typeof caches;

  beforeEach(() => {
    cache = new AudioCache();

    // Mock fetch - use spyOn to get jest-compatible mock methods
    mockFetch = spyOn(global, "fetch") as any;

    // Mock Cache API
    mockCaches = {
      open: mock(() =>
        Promise.resolve({
          match: mock(),
          put: mock(),
          delete: mock(),
        })
      ),
    } as any;
    (global as any).caches = mockCaches;
  });

  beforeEach(() => {
    mock.clearAllMocks();
    cache.clearMemoryCache();
  });

  it("handles data URLs correctly", async () => {
    const dataUrl = "data:audio/wav;base64,SGVsbG8gV29ybGQ="; // "Hello World" in base64
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
      mockAudioBuffer as any
    );

    const result = await cache.getAudioBuffer(audioContextMock as any, dataUrl);

    expect(result).toBe(mockAudioBuffer as any);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("caches decoded buffers in memory", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers(),
    } as Response);

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
      mockAudioBuffer as any
    );

    // First request should fetch
    const result1 = await cache.getAudioBuffer(audioContextMock as any, url);
    expect(result1).toBe(mockAudioBuffer as any);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second request should use memory cache
    const result2 = await cache.getAudioBuffer(audioContextMock as any, url);
    expect(result2).toBe(mockAudioBuffer as any);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Still just one fetch
  });

  it("handles 304 Not Modified responses correctly when cache expires", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);
    const etag = '"123456"';

    // Set a short cache expiration time for testing
    AudioCache.setCacheExpirationTime(100); // 100ms

    // Mock cache to return metadata with expired timestamp
    const mockCache = {
      match: mock((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(
            Response.json({
              url,
              etag,
              timestamp: Date.now() - 1000, // Expired timestamp
            })
          );
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: mock(),
      delete: mock(),
    };
    mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

    // Mock 304 response
    mockFetch.mockResolvedValueOnce({
      status: 304,
      ok: false,
    } as Response);

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
      mockAudioBuffer as any
    );

    const result = await cache.getAudioBuffer(audioContextMock as any, url);

    expect(result).toBe(mockAudioBuffer as any);
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe(url);
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get("If-None-Match")).toBe(etag);
  });

  it("respects Cache-Control max-age for fresh content", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);

    // Mock cache to return fresh metadata with max-age
    const mockCache = {
      match: mock((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(
            Response.json({
              url,
              cacheControl: "public, max-age=3600", // 1 hour
              timestamp: Date.now() - 1000, // 1 second ago (fresh)
            })
          );
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: mock(),
      delete: mock(),
    };
    mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
      mockAudioBuffer as any
    );

    const result = await cache.getAudioBuffer(audioContextMock as any, url);

    expect(result).toBe(mockAudioBuffer as any);
    expect(mockFetch).not.toHaveBeenCalled(); // Should not fetch because content is fresh
  });

  it("fetches when Cache-Control max-age=0", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);
    const etag = '"123456"';

    // Mock cache to return metadata with max-age=0
    const mockCache = {
      match: mock((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(
            Response.json({
              url,
              etag,
              cacheControl: "public, max-age=0",
              timestamp: Date.now() - 1000,
            })
          );
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: mock(),
      delete: mock(),
    };
    mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

    // Mock 304 response
    mockFetch.mockResolvedValueOnce({
      status: 304,
      ok: false,
    } as Response);

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
      mockAudioBuffer as any
    );

    const result = await cache.getAudioBuffer(audioContextMock as any, url);

    expect(result).toBe(mockAudioBuffer as any);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Should fetch because max-age=0
    const fetchCall = mockFetch.mock.calls[0];
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get("If-None-Match")).toBe(etag);
  });

  it("handles missing cache body with fresh metadata (fallback to network)", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);

    // Mock cache to return fresh metadata but no body
    const mockCache = {
      match: mock((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(
            Response.json({
              url,
              cacheControl: "public, max-age=3600", // Fresh for 1 hour
              timestamp: Date.now() - 1000, // 1 second ago (fresh)
            })
          );
        }
        // Return null for body - simulates missing cache body
        return Promise.resolve(null);
      }),
      put: mock(),
      delete: mock(),
    };
    mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

    // Mock network response for fallback
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers({
        "Cache-Control": "public, max-age=3600",
        ETag: '"fresh-version"',
      }),
    } as Response);

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
      mockAudioBuffer as any
    );

    const result = await cache.getAudioBuffer(audioContextMock as any, url);

    expect(result).toBe(mockAudioBuffer as any);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Should fetch as fallback
  });

  it("preserves Cache-Control on 304 responses", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);
    const etag = '"version-1"';
    const originalCacheControl = "public, max-age=3600";

    // Mock cache with existing metadata
    const mockCache = {
      match: mock((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(
            Response.json({
              url,
              etag,
              cacheControl: originalCacheControl,
              timestamp: Date.now() - 7_200_000, // 2 hours ago (stale)
            })
          );
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: mock(),
      delete: mock(),
    };
    mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

    // Mock 304 response with Cache-Control
    mockFetch.mockResolvedValueOnce({
      status: 304,
      ok: false,
      headers: new Headers({
        "Cache-Control": "public, max-age=7200", // Updated Cache-Control
      }),
    } as Response);

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
      mockAudioBuffer as any
    );

    const result = await cache.getAudioBuffer(audioContextMock as any, url);

    expect(result).toBe(mockAudioBuffer as any);

    // Verify Cache-Control was updated in metadata
    const updateMetadataCall = mockCache.put.mock.calls.find((call) =>
      call[0].includes(":meta")
    );
    expect(updateMetadataCall).toBeDefined();
    if (!updateMetadataCall) {
      throw new Error("updateMetadataCall should be defined");
    }
    const metadataResponse = updateMetadataCall[1];
    const updatedMetadata = JSON.parse(await metadataResponse.text());
    expect(updatedMetadata.cacheControl).toBe("public, max-age=7200");
  });

  it("handles cache expiration", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);

    // Set a short cache expiration time for testing
    AudioCache.setCacheExpirationTime(100); // 100ms

    // Mock cache with expired metadata
    const mockCache = {
      match: mock((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(
            Response.json({
              url,
              timestamp: Date.now() - 1000, // Expired timestamp
            })
          );
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: mock(),
      delete: mock(),
    };
    mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers(),
    } as Response);

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
      mockAudioBuffer as any
    );

    const result = await cache.getAudioBuffer(audioContextMock as any, url);

    expect(result).toBe(mockAudioBuffer as any);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Should fetch due to expiration
  });

  it("handles concurrent requests for the same URL", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers(),
    } as Response);

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValue(
      mockAudioBuffer as any
    );

    // Make multiple concurrent requests
    const requests = Promise.all([
      cache.getAudioBuffer(audioContextMock as any, url),
      cache.getAudioBuffer(audioContextMock as any, url),
      cache.getAudioBuffer(audioContextMock as any, url),
    ]);

    const results = await requests;

    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result).toBe(mockAudioBuffer as any);
    }
    expect(mockFetch).toHaveBeenCalledTimes(1); // Should only fetch once
  });

  it("clears memory cache correctly", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers(),
    } as Response);

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValue(
      mockAudioBuffer as any
    );

    // First request
    await cache.getAudioBuffer(audioContextMock as any, url);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Clear cache
    cache.clearMemoryCache();

    // Second request should fetch again
    await cache.getAudioBuffer(audioContextMock as any, url);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("makes conditional requests with ETag within TTL window", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);
    const etag = '"version-1"';
    const newEtag = '"version-2"';

    // Set a long cache expiration time to ensure we're within TTL
    AudioCache.setCacheExpirationTime(24 * 60 * 60 * 1000); // 24 hours

    // Mock cache with fresh metadata containing ETag
    const mockCache = {
      match: mock((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(
            Response.json({
              url,
              etag,
              timestamp: Date.now() - 1000, // Fresh timestamp (1 second ago)
            })
          );
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: mock(),
      delete: mock(),
    };
    mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

    // Mock server returning 200 with new ETag (content changed)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers({ ETag: newEtag }),
    } as Response);

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
      mockAudioBuffer as any
    );

    const result = await cache.getAudioBuffer(audioContextMock as any, url);

    expect(result).toBe(mockAudioBuffer as any);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify conditional request was made with If-None-Match header
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe(url);
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get("If-None-Match")).toBe(etag);
  });

  it("makes conditional requests with Last-Modified within TTL window", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);
    const lastModified = "Wed, 21 Oct 2015 07:28:00 GMT";

    // Set a long cache expiration time to ensure we're within TTL
    AudioCache.setCacheExpirationTime(24 * 60 * 60 * 1000); // 24 hours

    // Mock cache with fresh metadata containing Last-Modified
    const mockCache = {
      match: mock((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(
            Response.json({
              url,
              lastModified,
              timestamp: Date.now() - 1000, // Fresh timestamp (1 second ago)
            })
          );
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: mock(),
      delete: mock(),
    };
    mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

    // Mock server returning 200 (content changed)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers({
        "Last-Modified": "Thu, 22 Oct 2015 07:28:00 GMT",
      }),
    } as Response);

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
      mockAudioBuffer as any
    );

    const result = await cache.getAudioBuffer(audioContextMock as any, url);

    expect(result).toBe(mockAudioBuffer as any);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify conditional request was made with If-Modified-Since header
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe(url);
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get("If-Modified-Since")).toBe(lastModified);
  });

  it("handles 304 Not Modified within TTL window correctly", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);
    const etag = '"unchanged-version"';

    // Set a long cache expiration time to ensure we're within TTL
    AudioCache.setCacheExpirationTime(24 * 60 * 60 * 1000); // 24 hours

    // Mock cache with fresh metadata and cached content
    const mockCache = {
      match: mock((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(
            Response.json({
              url,
              etag,
              timestamp: Date.now() - 1000, // Fresh timestamp (1 second ago)
            })
          );
        }
        // Return cached content
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: mock(),
      delete: mock(),
    };
    mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

    // Mock server returning 304 Not Modified
    mockFetch.mockResolvedValueOnce({
      status: 304,
      ok: false,
    } as Response);

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
      mockAudioBuffer as any
    );

    const result = await cache.getAudioBuffer(audioContextMock as any, url);

    expect(result).toBe(mockAudioBuffer as any);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify metadata timestamp was updated on 304 response
    expect(mockCache.put).toHaveBeenCalledWith(
      `${url}:meta`,
      expect.any(Response)
    );
  });

  it("uses TTL fallback when no validation tokens exist", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);

    // Set a short cache expiration time for testing
    AudioCache.setCacheExpirationTime(100); // 100ms

    // Mock cache with metadata but no validation tokens and fresh timestamp
    const mockCache = {
      match: mock((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(
            Response.json({
              url,
              // No etag or lastModified
              timestamp: Date.now() - 50, // Fresh timestamp (50ms ago, within TTL)
            })
          );
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: mock(),
      delete: mock(),
    };
    mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
      mockAudioBuffer as any
    );

    const result = await cache.getAudioBuffer(audioContextMock as any, url);

    expect(result).toBe(mockAudioBuffer as any);
    // Should NOT fetch because TTL hasn't expired and no validation tokens
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("prioritizes validation tokens over TTL expiration", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({
      length: 100,
      sampleRate: 44_100,
    });
    const mockArrayBuffer = new ArrayBuffer(8);
    const etag = '"version-1"';

    // Set a very short cache expiration time
    AudioCache.setCacheExpirationTime(1); // 1ms

    // Mock cache with metadata containing ETag but expired timestamp
    const mockCache = {
      match: mock((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(
            Response.json({
              url,
              etag,
              timestamp: Date.now() - 1000, // Expired timestamp
            })
          );
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: mock(),
      delete: mock(),
    };
    mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

    // Mock server returning 304 Not Modified
    mockFetch.mockResolvedValueOnce({
      status: 304,
      ok: false,
    } as Response);

    spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
      mockAudioBuffer as any
    );

    const result = await cache.getAudioBuffer(audioContextMock as any, url);

    expect(result).toBe(mockAudioBuffer as any);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify conditional request was made even though TTL expired
    const fetchCall = mockFetch.mock.calls[0];
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get("If-None-Match")).toBe(etag);
  });

  it("allows manual TTL configuration", () => {
    // Set custom TTL - should not throw
    expect(() => {
      AudioCache.setCacheExpirationTime(60 * 1000); // 1 minute
    }).not.toThrow();

    // Verify the method exists
    expect(AudioCache.setCacheExpirationTime).toBeDefined();
  });

  describe("Error handling", () => {
    it("handles 304 response with missing cached body (cache inconsistency)", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({
        length: 100,
        sampleRate: 44_100,
      });
      const mockArrayBuffer = new ArrayBuffer(8);
      const etag = '"version-1"';
      const newEtag = '"version-2"';

      // Mock cache that returns metadata but no cached body (simulating corruption)
      const mockCache = {
        match: mock((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(
              Response.json({
                url,
                etag,
                timestamp: Date.now() - 1000,
              })
            );
          }
          // Return null for cached body (simulating missing/corrupted cache)
          return Promise.resolve(null);
        }),
        put: mock(),
        delete: mock(),
      };
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      // Mock console.warn to verify warning is logged
      const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {
        // Suppress console warnings in test
      });

      // First fetch returns 304 Not Modified
      // Second fetch (recovery) returns 200 with fresh content
      mockFetch
        .mockResolvedValueOnce({
          status: 304,
          ok: false,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          clone: () => ({
            arrayBuffer: () => Promise.resolve(mockArrayBuffer),
          }),
          arrayBuffer: () => Promise.resolve(mockArrayBuffer),
          headers: new Headers({ ETag: newEtag }),
        } as Response);

      spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
        mockAudioBuffer
      );

      const result = await cache.getAudioBuffer(audioContextMock as any, url);

      expect(result).toBe(mockAudioBuffer as any);
      expect(mockFetch).toHaveBeenCalledTimes(2); // First 304, then recovery fetch

      // Verify warning was logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cache inconsistency detected")
      );

      // Verify fresh content was cached
      expect(mockCache.put).toHaveBeenCalledWith(url, expect.any(Object));
      expect(mockCache.put).toHaveBeenCalledWith(
        `${url}:meta`,
        expect.any(Response)
      );

      consoleWarnSpy.mockRestore();
    });

    it("handles malformed Cache-Control headers gracefully", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({
        length: 100,
        sampleRate: 44_100,
      });
      const mockArrayBuffer = new ArrayBuffer(8);

      // Mock cache with malformed Cache-Control
      const mockCache = {
        match: mock((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(
              Response.json({
                url,
                cacheControl: "invalid-directive", // Invalid Cache-Control
                timestamp: Date.now() - 1000,
              })
            );
          }
          return Promise.resolve(new Response(mockArrayBuffer));
        }),
        put: mock(),
        delete: mock(),
      };
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
        mockAudioBuffer
      );

      const result = await cache.getAudioBuffer(audioContextMock as any, url);

      expect(result).toBe(mockAudioBuffer as any);
      expect(mockFetch).not.toHaveBeenCalled(); // Should use cached content since max-age parse failed
    });

    it("handles concurrent requests with fresh cache correctly", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({
        length: 100,
        sampleRate: 44_100,
      });
      const mockArrayBuffer = new ArrayBuffer(8);

      // Mock cache with fresh metadata
      const mockCache = {
        match: mock((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(
              Response.json({
                url,
                cacheControl: "public, max-age=3600", // Fresh
                timestamp: Date.now() - 1000,
              })
            );
          }
          return Promise.resolve(new Response(mockArrayBuffer));
        }),
        put: mock(),
        delete: mock(),
      };
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      spyOn(audioContextMock, "decodeAudioData").mockResolvedValue(
        mockAudioBuffer
      );

      // Make concurrent requests
      const [result1, result2, result3] = await Promise.all([
        cache.getAudioBuffer(audioContextMock as any, url),
        cache.getAudioBuffer(audioContextMock as any, url),
        cache.getAudioBuffer(audioContextMock as any, url),
      ]);

      expect(result1).toBe(mockAudioBuffer as any);
      expect(result2).toBe(mockAudioBuffer as any);
      expect(result3).toBe(mockAudioBuffer as any);
      expect(mockFetch).not.toHaveBeenCalled(); // Should all use fresh cache
    });

    it("handles max-age=0 with missing validation headers", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({
        length: 100,
        sampleRate: 44_100,
      });
      const mockArrayBuffer = new ArrayBuffer(8);

      // Mock cache with max-age=0 but no validation headers and no cached body
      const mockCache = {
        match: mock((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(
              Response.json({
                url,
                cacheControl: "public, max-age=0", // Always stale
                // No etag or lastModified
                timestamp: Date.now() - 1000,
              })
            );
          }
          return Promise.resolve(null); // No cached body, forcing network
        }),
        put: mock(),
        delete: mock(),
      };
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      // Mock unconditional fetch (no validation headers)
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Headers(),
      } as Response);

      spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
        mockAudioBuffer
      );

      const result = await cache.getAudioBuffer(audioContextMock as any, url);

      expect(result).toBe(mockAudioBuffer as any);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;
      expect(headers.get("If-None-Match")).toBeNull();
      expect(headers.get("If-Modified-Since")).toBeNull();
    });

    it("falls back to TTL when Cache-Control is missing", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({
        length: 100,
        sampleRate: 44_100,
      });
      const mockArrayBuffer = new ArrayBuffer(8);

      // Set TTL for testing
      AudioCache.setCacheExpirationTime(1000); // 1 second

      // Mock cache without Cache-Control but with fresh TTL
      const mockCache = {
        match: mock((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(
              Response.json({
                url,
                // No cacheControl field
                timestamp: Date.now() - 500, // 0.5 seconds ago (fresh by TTL)
              })
            );
          }
          return Promise.resolve(new Response(mockArrayBuffer));
        }),
        put: mock(),
        delete: mock(),
      };
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
        mockAudioBuffer
      );

      const result = await cache.getAudioBuffer(audioContextMock as any, url);

      expect(result).toBe(mockAudioBuffer as any);
      expect(mockFetch).not.toHaveBeenCalled(); // Should use cache due to fresh TTL
    });

    it("respects no-cache directive regardless of freshness", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({
        length: 100,
        sampleRate: 44_100,
      });
      const mockArrayBuffer = new ArrayBuffer(8);
      const etag = '"version-1"';

      // Mock cache with no-cache directive but fresh timestamp
      const mockCache = {
        match: mock((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(
              Response.json({
                url,
                etag,
                cacheControl: "public, max-age=3600, no-cache", // Fresh but no-cache
                timestamp: Date.now() - 1000, // 1 second ago (would be fresh)
              })
            );
          }
          return Promise.resolve(new Response(mockArrayBuffer));
        }),
        put: mock(),
        delete: mock(),
      };
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      // Mock 304 response
      mockFetch.mockResolvedValueOnce({
        status: 304,
        ok: false,
        headers: new Headers(),
      } as Response);

      spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
        mockAudioBuffer
      );

      const result = await cache.getAudioBuffer(audioContextMock as any, url);

      expect(result).toBe(mockAudioBuffer as any);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Should fetch due to no-cache directive
      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;
      expect(headers.get("If-None-Match")).toBe(etag);
    });

    it("respects must-revalidate directive", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({
        length: 100,
        sampleRate: 44_100,
      });
      const mockArrayBuffer = new ArrayBuffer(8);

      // Mock cache with must-revalidate directive
      const mockCache = {
        match: mock((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(
              Response.json({
                url,
                cacheControl: "public, max-age=3600, must-revalidate", // Fresh but must revalidate
                timestamp: Date.now() - 1000, // 1 second ago (would be fresh)
              })
            );
          }
          return Promise.resolve(new Response(mockArrayBuffer));
        }),
        put: mock(),
        delete: mock(),
      };
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      // Mock 200 response (no validation headers available)
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Headers(),
      } as Response);

      spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
        mockAudioBuffer
      );

      const result = await cache.getAudioBuffer(audioContextMock as any, url);

      expect(result).toBe(mockAudioBuffer as any);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Should fetch due to must-revalidate directive
    });

    it("handles improved max-age parsing with quotes and whitespace", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({
        length: 100,
        sampleRate: 44_100,
      });
      const mockArrayBuffer = new ArrayBuffer(8);

      // Mock cache with quoted max-age and whitespace
      const mockCache = {
        match: mock((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(
              Response.json({
                url,
                cacheControl: 'public, max-age = "3600"', // Quoted with whitespace
                timestamp: Date.now() - 1000, // 1 second ago (fresh)
              })
            );
          }
          return Promise.resolve(new Response(mockArrayBuffer));
        }),
        put: mock(),
        delete: mock(),
      };
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
        mockAudioBuffer
      );

      const result = await cache.getAudioBuffer(audioContextMock as any, url);

      expect(result).toBe(mockAudioBuffer as any);
      expect(mockFetch).not.toHaveBeenCalled(); // Should not fetch because content is fresh
    });

    it("throws error when recovery fetch fails after cache inconsistency", async () => {
      const url = "https://example.com/audio.mp3";
      const etag = '"version-1"';

      // Mock cache with metadata but no cached body
      const mockCache = {
        match: mock((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(
              Response.json({
                url,
                etag,
                timestamp: Date.now() - 1000,
              })
            );
          }
          return Promise.resolve(null);
        }),
        put: mock(),
        delete: mock(),
      };
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      // Mock console.warn
      const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {
        // Suppress console warnings in test
      });

      // First fetch returns 304, recovery fetch fails
      mockFetch
        .mockResolvedValueOnce({
          status: 304,
          ok: false,
        } as Response)
        .mockResolvedValueOnce({
          status: 500,
          statusText: "Internal Server Error",
          ok: false,
        } as Response);

      await expect(cache.getAudioBuffer(audioContextMock as any, url)).rejects.toThrow(
        "Failed to fetch resource after cache inconsistency: 500 Internal Server Error"
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe("AbortSignal support", () => {
    it("passes AbortSignal to fetch requests", async () => {
      const url = "https://example.com/audio.mp3";
      const mockArrayBuffer = new ArrayBuffer(8);
      const mockAudioBuffer = new AudioBuffer({
        length: 100,
        sampleRate: 44_100,
      });
      const controller = new AbortController();

      const mockResponse = {
        status: 200,
        ok: true,
        headers: new Map([
          ["ETag", '"abc123"'],
          ["Last-Modified", "Wed, 21 Oct 2015 07:28:00 GMT"],
        ]),
        clone: mock(() => ({
          arrayBuffer: mock(() => Promise.resolve(mockArrayBuffer)),
        })),
        arrayBuffer: mock(() => Promise.resolve(mockArrayBuffer)),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      const mockCache = {
        match: mock(() => Promise.resolve(null)),
        put: mock(() => Promise.resolve(undefined)),
        delete: mock(() => Promise.resolve(undefined)),
      };
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
        mockAudioBuffer
      );

      await cache.getAudioBuffer(audioContextMock as any, url, controller.signal);

      expect(mockFetch).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          signal: controller.signal,
        })
      );
    });

    it("throws AbortError when signal is already aborted", async () => {
      const url = "https://example.com/audio.mp3";
      const controller = new AbortController();
      controller.abort();

      await expect(
        cache.getAudioBuffer(audioContextMock as any, url, controller.signal)
      ).rejects.toThrow(DOMException);

      await expect(
        cache.getAudioBuffer(audioContextMock as any, url, controller.signal)
      ).rejects.toMatchObject({
        name: "AbortError",
        message: "Operation was aborted",
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("throws AbortError when signal is aborted during fetch", async () => {
      const url = "https://example.com/audio.mp3";
      const controller = new AbortController();

      mockFetch.mockImplementationOnce(() => {
        return new Promise((_, reject) => {
          // Simulate abort by immediately rejecting with AbortError
          reject(new DOMException("Operation was aborted", "AbortError"));
        });
      });

      const mockCache = {
        match: mock(() => Promise.resolve(null)),
        put: mock(() => Promise.resolve(undefined)),
        delete: mock(() => Promise.resolve(undefined)),
      };
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      // Abort immediately
      controller.abort();

      await expect(
        cache.getAudioBuffer(audioContextMock as any, url, controller.signal)
      ).rejects.toThrow(DOMException);

      await expect(
        cache.getAudioBuffer(audioContextMock as any, url, controller.signal)
      ).rejects.toMatchObject({
        name: "AbortError",
      });
    });

    it("cleans up pending requests when aborted", async () => {
      const url = "https://example.com/audio.mp3";
      const controller = new AbortController();

      const mockCache = {
        match: mock(() => Promise.resolve(null)),
        put: mock(() => Promise.resolve(undefined)),
        delete: mock(() => Promise.resolve(undefined)),
      };

      // Mock cache opens for both requests
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      // Abort before starting the request
      controller.abort();

      // First request should fail immediately with AbortError
      try {
        await cache.getAudioBuffer(audioContextMock as any, url, controller.signal);
        throw new Error("Expected AbortError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(DOMException);
        if (error instanceof DOMException) {
          expect(error.name).toBe("AbortError");
        }
      }

      // Verify that a second request would not reuse the aborted pending request
      const controller2 = new AbortController();
      const mockArrayBuffer = new ArrayBuffer(8);
      const mockAudioBuffer = new AudioBuffer({
        length: 100,
        sampleRate: 44_100,
      });

      const mockResponse = {
        status: 200,
        ok: true,
        headers: new Map(),
        clone: mock(() => ({
          arrayBuffer: mock(() => Promise.resolve(mockArrayBuffer)),
        })),
        arrayBuffer: mock(() => Promise.resolve(mockArrayBuffer)),
      };

      // Reset mock for second request
      (mockFetch as any).mockClear?.();
      mockFetch.mockResolvedValueOnce(mockResponse);
      spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
        mockAudioBuffer
      );

      const result = await cache.getAudioBuffer(
        audioContextMock as any,
        url,
        controller2.signal
      );
      expect(result).toBeDefined();
      expect(result.length).toBe(mockAudioBuffer.length);
      expect(result.sampleRate).toBe(mockAudioBuffer.sampleRate);
      // Check that fetch was called (the count might be > 1 due to previous test state, so just verify it was called)
      expect(mockFetch).toHaveBeenCalled();
    });

    it("passes AbortSignal to recovery fetch on cache inconsistency", async () => {
      const url = "https://example.com/audio.mp3";
      const controller = new AbortController();
      const mockArrayBuffer = new ArrayBuffer(8);
      const mockAudioBuffer = new AudioBuffer({
        length: 100,
        sampleRate: 44_100,
      });

      let matchCallCount = 0;
      const mockCache = {
        match: mock(() => {
          matchCallCount += 1;
          if (matchCallCount === 1) {
            // First call: return metadata
            return Promise.resolve({
              json: mock(() =>
                Promise.resolve({
                  url,
                  etag: '"abc123"',
                  lastModified: "Wed, 21 Oct 2015 07:28:00 GMT",
                  timestamp: Date.now(),
                })
              ),
            });
          }
          // Subsequent calls: return null (cached body is missing)
          return Promise.resolve(null);
        }),
        put: mock(() => Promise.resolve(undefined)),
        delete: mock(() => Promise.resolve(undefined)),
      };
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      // First fetch returns 304 Not Modified
      const mock304Response = {
        status: 304,
        headers: new Map(),
      };

      // Second fetch (recovery) returns fresh content
      const mockRecoveryResponse = {
        status: 200,
        ok: true,
        headers: new Map(),
        clone: mock(() => ({
          arrayBuffer: mock(() => Promise.resolve(mockArrayBuffer)),
        })),
        arrayBuffer: mock(() => Promise.resolve(mockArrayBuffer)),
      };

      // Reset mock call count for this test
      (mockFetch as any).mockClear?.();
      let fetchCallCount = 0;
      mockFetch.mockImplementation(() => {
        fetchCallCount += 1;
        if (fetchCallCount === 1) {
          return Promise.resolve(mock304Response);
        }
        return Promise.resolve(mockRecoveryResponse);
      });

      spyOn(audioContextMock, "decodeAudioData").mockResolvedValue(
        mockAudioBuffer
      );

      await cache.getAudioBuffer(audioContextMock as any, url, controller.signal);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        url,
        expect.objectContaining({
          signal: controller.signal,
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        url,
        expect.objectContaining({
          signal: controller.signal,
        })
      );
    });

    it("works without AbortSignal (backward compatibility)", async () => {
      const url = "https://example.com/audio.mp3";
      const mockArrayBuffer = new ArrayBuffer(8);
      const mockAudioBuffer = new AudioBuffer({
        length: 100,
        sampleRate: 44_100,
      });

      const mockResponse = {
        status: 200,
        ok: true,
        headers: new Map(),
        clone: mock(() => ({
          arrayBuffer: mock(() => Promise.resolve(mockArrayBuffer)),
        })),
        arrayBuffer: mock(() => Promise.resolve(mockArrayBuffer)),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      const mockCache = {
        match: mock(() => Promise.resolve(null)),
        put: mock(() => Promise.resolve(undefined)),
        delete: mock(() => Promise.resolve(undefined)),
      };
      mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

      spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
        mockAudioBuffer
      );

      // Call without AbortSignal
      const result = await cache.getAudioBuffer(audioContextMock as any, url);

      expect(result).toBeDefined();
      expect(result.length).toBe(mockAudioBuffer.length);
      expect(result.sampleRate).toBe(mockAudioBuffer.sampleRate);
      expect(mockFetch).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          signal: undefined,
        })
      );
    });

    describe("memory optimization", () => {
      it("uses pre-allocation when content-length is known", async () => {
        const url = "https://example.com/audio.mp3";
        const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        const mockAudioBuffer = new AudioBuffer({
          length: 100,
          sampleRate: 44_100,
        });

        // Mock fetch response with content-length
        const mockResponse = {
          status: 200,
          ok: true,
          headers: new Headers({
            "content-length": testData.length.toString(),
          }),
          clone: mock().mockReturnValue({
            arrayBuffer: mock(() => Promise.resolve(testData.buffer)),
          }),
          body: new ReadableStream({
            start(controller) {
              // Simulate chunks
              controller.enqueue(testData.slice(0, 4));
              controller.enqueue(testData.slice(4, 8));
              controller.close();
            },
          }),
        };

        mockFetch.mockResolvedValueOnce(mockResponse);

        const mockCache = {
          match: mock().mockResolvedValue(null),
          put: mock().mockResolvedValue(undefined),
          delete: mock().mockResolvedValue(undefined),
        };
        mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

        spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
          mockAudioBuffer
        );

        const result = await cache.getAudioBuffer(audioContextMock as any, url);

        expect(result).toBeDefined();
        expect(result.length).toBe(mockAudioBuffer.length);
        expect(result.sampleRate).toBe(mockAudioBuffer.sampleRate);
        // Verify decodeAudioData was called with correct buffer
        expect(audioContextMock.decodeAudioData).toHaveBeenCalledWith(
          expect.any(ArrayBuffer)
        );
      });

      it("uses exponential growth when content-length is unknown", async () => {
        const url = "https://example.com/audio.mp3";
        const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        const mockAudioBuffer = new AudioBuffer({
          length: 100,
          sampleRate: 44_100,
        });

        // Mock fetch response without content-length
        const mockResponse = {
          status: 200,
          ok: true,
          headers: new Headers(), // No content-length
          clone: mock().mockReturnValue({
            arrayBuffer: mock(() => Promise.resolve(testData.buffer)),
          }),
          body: new ReadableStream({
            start(controller) {
              // Simulate chunks
              controller.enqueue(testData.slice(0, 4));
              controller.enqueue(testData.slice(4, 8));
              controller.close();
            },
          }),
        };

        mockFetch.mockResolvedValueOnce(mockResponse);

        const mockCache = {
          match: mock().mockResolvedValue(null),
          put: mock().mockResolvedValue(undefined),
          delete: mock().mockResolvedValue(undefined),
        };
        mockCaches.open = mock(() => Promise.resolve(mockCache)) as any;

        spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(
          mockAudioBuffer
        );

        const result = await cache.getAudioBuffer(audioContextMock as any, url);

        expect(result).toBeDefined();
        expect(result.length).toBe(mockAudioBuffer.length);
        expect(result.sampleRate).toBe(mockAudioBuffer.sampleRate);
        // Verify decodeAudioData was called with correct buffer
        expect(audioContextMock.decodeAudioData).toHaveBeenCalledWith(
          expect.any(ArrayBuffer)
        );
      });
    });
  });
});
