import { afterEach, expect, spyOn, test } from "bun:test";
import { createMetadataKvFixture } from "@/lib/metadata/kv-test-fixture";
import {
  getCachedRadioGardenItem,
  searchCachedRadioBrowser,
  searchCachedRadioGarden,
} from "./directory-cache";

const originalFetch = globalThis.fetch;
const fetchTarget: {
  fetch: (
    input: string | URL | Request,
    init?: RequestInit
  ) => Promise<Response>;
} = globalThis;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Radio Garden shares station attributes but resolves playback on every request", async () => {
  const { kv, entries, put } = createMetadataKvFixture();
  let attributes = 0;
  let streams = 0;
  spyOn(fetchTarget, "fetch").mockImplementation((input) => {
    if (String(input).includes("/listen/")) {
      streams += 1;
      return Promise.resolve(
        new Response(null, {
          headers: { location: `https://audio.example/live?token=${streams}` },
          status: 302,
        })
      );
    }
    attributes += 1;
    return Promise.resolve(
      Response.json({
        data: {
          country: { title: "Italy" },
          id: "station",
          place: { id: "city", title: "Rome" },
          title: "Station",
          url: "/listen/station/station",
        },
      })
    );
  });
  expect(await getCachedRadioGardenItem(kv, "station")).toMatchObject({
    streamUrl: "https://audio.example/live?token=1",
    success: true,
  });
  expect(await getCachedRadioGardenItem(kv, "station")).toMatchObject({
    streamUrl: "https://audio.example/live?token=2",
    success: true,
  });
  expect(attributes).toBe(1);
  expect(streams).toBe(2);
  expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 86_400 });
  expect([...entries.values()].join()).not.toContain("token=");
});

test("Radio Garden caches empty searches but retries upstream failures", async () => {
  const { kv, put } = createMetadataKvFixture();
  const fetchMock = spyOn(fetchTarget, "fetch").mockResolvedValue(
    new Response(null, { status: 503 })
  );
  await expect(searchCachedRadioGarden(kv, "empty")).rejects.toThrow();
  expect(put).not.toHaveBeenCalled();
  fetchMock.mockImplementation(() =>
    Promise.resolve(Response.json({ hits: { hits: [] } }))
  );
  expect(await searchCachedRadioGarden(kv, "empty")).toEqual([]);
  expect(await searchCachedRadioGarden(kv, "empty")).toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 600 });
});

test("Radio Browser shares validated searches and isolates query and limit", async () => {
  const { kv } = createMetadataKvFixture();
  const searches: URL[] = [];
  spyOn(fetchTarget, "fetch").mockImplementation((input) => {
    const url = new URL(String(input));
    if (url.pathname === "/json/servers") {
      return Promise.resolve(
        Response.json([{ name: "de1.api.radio-browser.info" }])
      );
    }
    if (url.hostname === "cloudflare-dns.com") {
      return Promise.resolve(
        Response.json({
          Answer: [{ data: "93.184.216.34", type: 1 }],
          Status: 0,
        })
      );
    }
    searches.push(url);
    return Promise.resolve(
      Response.json([
        {
          codec: "MP3",
          lastcheckok: 1,
          name: "Public",
          stationuuid: "valid",
          url_resolved: "https://radio.example/live",
        },
        {
          codec: "MP3",
          lastcheckok: 1,
          name: "Private",
          stationuuid: "private",
          url_resolved: "https://127.0.0.1/live",
        },
      ])
    );
  });
  const first = await searchCachedRadioBrowser(kv, "ambient", 10);
  expect(first.map((station) => station.stationUuid)).toEqual(["valid"]);
  expect(await searchCachedRadioBrowser(kv, "ambient", 10)).toEqual(first);
  expect(searches).toHaveLength(1);
  await searchCachedRadioBrowser(kv, "ambient", 20);
  await searchCachedRadioBrowser(kv, "jazz", 10);
  expect(
    searches.map((url) => [
      url.searchParams.get("name"),
      url.searchParams.get("limit"),
    ])
  ).toEqual([
    ["ambient", "10"],
    ["ambient", "20"],
    ["jazz", "10"],
  ]);
});

test("Radio Browser keeps potentially signed playback URLs outside KV", async () => {
  const { kv, put } = createMetadataKvFixture();
  spyOn(fetchTarget, "fetch").mockImplementation((input) => {
    if (String(input).includes("/json/servers")) {
      return Promise.resolve(
        Response.json([{ name: "de1.api.radio-browser.info" }])
      );
    }
    return Promise.resolve(
      Response.json([
        {
          codec: "MP3",
          lastcheckok: 1,
          name: "Signed",
          stationuuid: "signed",
          url_resolved: "https://93.184.216.34/live?token=signature",
        },
      ])
    );
  });
  const results = await searchCachedRadioBrowser(kv, "signed", 10);
  expect(results).toHaveLength(1);
  expect(results[0]?.urlResolved).toContain("token=signature");
  expect(put).not.toHaveBeenCalled();
});
