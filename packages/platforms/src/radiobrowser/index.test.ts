import { describe, expect, mock, test } from "bun:test";
import { searchRadioBrowser } from "./index.js";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("searchRadioBrowser", () => {
  test("discovers, deduplicates, and retries HTTPS mirrors", async () => {
    const requested: URL[] = [];
    const fetchImpl = mock((input: string | URL | Request) => {
      const url = new URL(String(input));
      requested.push(url);

      if (url.hostname === "all.api.radio-browser.info") {
        return Promise.resolve(
          jsonResponse([
            { name: "one.api.radio-browser.info" },
            { name: "one.api.radio-browser.info" },
            { name: "two.api.radio-browser.info" },
            { name: "malicious.example" },
            { name: "http://not-secure.example" },
          ])
        );
      }
      if (url.hostname === "one.api.radio-browser.info") {
        return Promise.resolve(jsonResponse({ error: "unavailable" }, 503));
      }
      return Promise.resolve(
        jsonResponse([
          {
            bitrate: 192,
            codec: "MP3",
            country: "Italy",
            favicon: "https://radio.example/icon.png",
            hls: 0,
            homepage: "https://radio.example",
            lastcheckok: 1,
            lastchecktime: "2026-07-10 12:00:00",
            name: "Test Radio",
            state: "Lazio",
            stationuuid: "station-1",
            tags: "ambient, experimental",
            url: "http://radio.example/original",
            url_resolved: "https://radio.example/live.mp3",
          },
          {
            name: "Missing stream",
            stationuuid: "station-without-url",
          },
        ])
      );
    });

    const stations = await searchRadioBrowser("  test radio  ", {
      fetchImpl,
      random: () => 0.999,
    });

    expect(stations).toEqual([
      {
        bitrate: 192,
        codec: "MP3",
        country: "Italy",
        favicon: "https://radio.example/icon.png",
        hls: false,
        homepage: "https://radio.example",
        lastCheckOk: true,
        lastCheckTime: "2026-07-10 12:00:00",
        name: "Test Radio",
        state: "Lazio",
        stationUuid: "station-1",
        tags: ["ambient", "experimental"],
        url: "",
        urlResolved: "https://radio.example/live.mp3",
      },
    ]);
    expect(requested.map((url) => url.hostname)).toEqual([
      "all.api.radio-browser.info",
      "one.api.radio-browser.info",
      "two.api.radio-browser.info",
    ]);
    expect(requested[1]?.searchParams.get("name")).toBe("test radio");
    expect(requested[1]?.searchParams.get("hidebroken")).toBe("true");
    expect(requested[1]?.searchParams.get("is_https")).toBe("true");
    expect(requested[1]?.searchParams.get("order")).toBe("clickcount");
    expect(requested[1]?.searchParams.get("reverse")).toBe("true");
    expect(requested[1]?.searchParams.get("limit")).toBe("50");
  });

  test("uses injected servers and clamps the result limit", async () => {
    const fetchImpl = mock((input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://radio-browser.example");
      expect(url.searchParams.get("limit")).toBe("100");
      return Promise.resolve(jsonResponse([]));
    });

    await expect(
      searchRadioBrowser("jazz", {
        fetchImpl,
        limit: 10_000,
        servers: ["http://not-secure.example", "https://radio-browser.example"],
      })
    ).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("rejects an injected list without a valid HTTPS server", async () => {
    await expect(
      searchRadioBrowser("jazz", {
        servers: ["http://not-secure.example", "not a hostname"],
      })
    ).rejects.toThrow("no valid HTTPS servers");
  });

  test("drops unsafe station and navigation URLs", async () => {
    const fetchImpl = mock(async () =>
      jsonResponse([
        {
          favicon: "data:image/svg+xml,unsafe",
          homepage: "javascript:alert(1)",
          name: "Unsafe metadata",
          stationuuid: "station-1",
          url: "javascript:alert(1)",
          url_resolved: "https://radio.example/live.mp3",
        },
        {
          name: "No playable URL",
          stationuuid: "station-2",
          url: "file:///tmp/audio.mp3",
        },
      ])
    );

    await expect(
      searchRadioBrowser("unsafe", {
        fetchImpl,
        servers: ["https://radio-browser.example"],
      })
    ).resolves.toEqual([
      expect.objectContaining({
        favicon: "",
        homepage: "",
        stationUuid: "station-1",
        url: "",
        urlResolved: "https://radio.example/live.mp3",
      }),
    ]);
  });

  test("drops HTTP streams and falls back to an HTTPS canonical URL", async () => {
    const fetchImpl = mock(async () =>
      jsonResponse([
        {
          name: "HTTP only",
          stationuuid: "station-http",
          url: "http://radio.example/original",
          url_resolved: "http://radio.example/live.mp3",
        },
        {
          name: "HTTPS fallback",
          stationuuid: "station-https",
          url: "https://radio.example/original",
          url_resolved: "http://radio.example/live.mp3",
        },
      ])
    );

    await expect(
      searchRadioBrowser("secure", {
        fetchImpl,
        servers: ["https://radio-browser.example"],
      })
    ).resolves.toEqual([
      expect.objectContaining({
        stationUuid: "station-https",
        url: "https://radio.example/original",
        urlResolved: "",
      }),
    ]);
  });

  test("drops stream URLs whose host resolves to a private address", async () => {
    const resolveHostname = mock(async (hostname: string) =>
      hostname === "private.example" ? ["127.0.0.1"] : ["203.0.113.10"]
    );
    const fetchImpl = mock(async () =>
      jsonResponse([
        {
          name: "Private",
          stationuuid: "station-private",
          url_resolved: "https://private.example/live.mp3",
        },
        {
          name: "Public",
          stationuuid: "station-public",
          url: "https://radio.example/original.mp3",
          url_resolved: "https://radio.example/live.mp3",
        },
      ])
    );

    await expect(
      searchRadioBrowser("safe", {
        fetchImpl,
        resolveHostname,
        servers: ["https://radio-browser.example"],
      })
    ).resolves.toEqual([
      expect.objectContaining({
        stationUuid: "station-public",
        url: "https://radio.example/original.mp3",
        urlResolved: "https://radio.example/live.mp3",
      }),
    ]);
    expect(resolveHostname).toHaveBeenCalledTimes(2);
  });

  test("fails closed when a stream hostname cannot be resolved", async () => {
    const resolveHostname = mock(() =>
      Promise.reject(new Error("DNS unavailable"))
    );

    await expect(
      searchRadioBrowser("unresolved", {
        fetchImpl: mock(async () =>
          jsonResponse([
            {
              name: "Unresolved",
              stationuuid: "station-1",
              url: "https://unresolved.example/live.mp3",
            },
          ])
        ),
        resolveHostname,
        servers: ["https://radio-browser.example"],
      })
    ).resolves.toEqual([]);
  });

  test("bounds station hostname resolution by the search timeout", async () => {
    await expect(
      searchRadioBrowser("slow dns", {
        fetchImpl: mock(async () =>
          jsonResponse([
            {
              name: "Slow DNS",
              stationuuid: "station-1",
              url: "https://slow.example/live.mp3",
            },
          ])
        ),
        resolveHostname: () => new Promise(() => undefined),
        servers: ["https://radio-browser.example"],
        timeoutMs: 1,
      })
    ).rejects.toThrow("every discovered server");
  });

  test("stops retries when the caller aborts", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("Stopped", "AbortError");
    const fetchImpl = mock(() => {
      controller.abort(abortError);
      return Promise.reject(abortError);
    });

    await expect(
      searchRadioBrowser("jazz", {
        fetchImpl,
        servers: ["https://one.example", "https://two.example"],
        signal: controller.signal,
      })
    ).rejects.toBe(abortError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
