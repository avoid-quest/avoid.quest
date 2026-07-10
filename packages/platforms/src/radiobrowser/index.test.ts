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
            stationuuid: "station-1",
            name: "Test Radio",
            url: "http://radio.example/original",
            url_resolved: "https://radio.example/live.mp3",
            homepage: "https://radio.example",
            favicon: "https://radio.example/icon.png",
            country: "Italy",
            state: "Lazio",
            tags: "ambient, experimental",
            codec: "MP3",
            bitrate: 192,
            hls: 0,
            lastcheckok: 1,
            lastchecktime: "2026-07-10 12:00:00",
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
        stationUuid: "station-1",
        name: "Test Radio",
        url: "http://radio.example/original",
        urlResolved: "https://radio.example/live.mp3",
        homepage: "https://radio.example",
        favicon: "https://radio.example/icon.png",
        country: "Italy",
        state: "Lazio",
        tags: ["ambient", "experimental"],
        codec: "MP3",
        bitrate: 192,
        hls: false,
        lastCheckOk: true,
        lastCheckTime: "2026-07-10 12:00:00",
      },
    ]);
    expect(requested.map((url) => url.hostname)).toEqual([
      "all.api.radio-browser.info",
      "one.api.radio-browser.info",
      "two.api.radio-browser.info",
    ]);
    expect(requested[1]?.searchParams.get("name")).toBe("test radio");
    expect(requested[1]?.searchParams.get("hidebroken")).toBe("true");
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
          stationuuid: "station-1",
          name: "Unsafe metadata",
          url: "javascript:alert(1)",
          url_resolved: "https://radio.example/live.mp3",
          homepage: "javascript:alert(1)",
          favicon: "data:image/svg+xml,unsafe",
        },
        {
          stationuuid: "station-2",
          name: "No playable URL",
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
        stationUuid: "station-1",
        url: "",
        urlResolved: "https://radio.example/live.mp3",
        homepage: "",
        favicon: "",
      }),
    ]);
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
