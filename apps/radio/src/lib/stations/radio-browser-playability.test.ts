import { describe, expect, mock, test } from "bun:test";
import type { RadioBrowserStation } from "@avoid.quest/platforms/radiobrowser";
import {
  filterPlayableRadioBrowserStations,
  RADIO_BROWSER_RESULT_LIMIT,
} from "./radio-browser-playability.js";

function station(
  id: string,
  overrides: Partial<RadioBrowserStation> = {}
): RadioBrowserStation {
  return {
    bitrate: 128,
    codec: "MP3",
    country: "",
    favicon: "",
    hls: false,
    homepage: "",
    lastCheckOk: true,
    lastCheckTime: "",
    name: id,
    state: "",
    stationUuid: id,
    tags: [],
    url: `https://radio.example/${id}`,
    urlResolved: `https://stream.example/${id}`,
    ...overrides,
  };
}

describe("filterPlayableRadioBrowserStations", () => {
  test("uses a direct CORS range request and cancels the response body", async () => {
    const cancel = mock(() => undefined);
    const fetchImpl = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          new ReadableStream({
            cancel,
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
          }),
          { status: 206 }
        )
    );

    await expect(
      filterPlayableRadioBrowserStations([station("one")], { fetchImpl })
    ).resolves.toEqual([station("one")]);

    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      method: "GET",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(new Headers(init?.headers).get("range")).toBe("bytes=0-0");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test("filters failed and non-HTTPS probes while preserving provider order", async () => {
    const fetchImpl = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/first")) {
        await Promise.resolve();
        return new Response("first");
      }
      if (url.endsWith("/failed")) {
        return new Response("failed", { status: 503 });
      }
      return new Response("last");
    });
    const stations = [
      station("first"),
      station("failed"),
      station("http", { urlResolved: "http://stream.example/http" }),
      station("last"),
    ];

    await expect(
      filterPlayableRadioBrowserStations(stations, { fetchImpl })
    ).resolves.toEqual([stations[0], stations[3]]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test("limits the number of probed and returned stations", async () => {
    const fetchImpl = mock(async () => new Response("audio"));
    const stations = Array.from(
      { length: RADIO_BROWSER_RESULT_LIMIT + 2 },
      (_, index) => station(String(index))
    );

    const results = await filterPlayableRadioBrowserStations(stations, {
      fetchImpl,
    });

    expect(results).toEqual(stations.slice(0, RADIO_BROWSER_RESULT_LIMIT));
    expect(fetchImpl).toHaveBeenCalledTimes(RADIO_BROWSER_RESULT_LIMIT);
  });

  test("propagates caller aborts instead of presenting partial results", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("Stopped", "AbortError");
    const fetchImpl = mock(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true }
          );
        })
    );
    const result = filterPlayableRadioBrowserStations([station("one")], {
      fetchImpl,
      signal: controller.signal,
    });

    controller.abort(abortError);

    await expect(result).rejects.toBe(abortError);
  });

  test("filters probes that exceed their timeout", async () => {
    const fetchImpl = mock(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true }
          );
        })
    );

    await expect(
      filterPlayableRadioBrowserStations([station("slow")], {
        fetchImpl,
        timeoutMs: 1,
      })
    ).resolves.toEqual([]);
  });
});
