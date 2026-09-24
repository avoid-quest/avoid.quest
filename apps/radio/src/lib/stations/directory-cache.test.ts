import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { cacheMetadata, DIRECTORY_SEARCH_TTL } from "@/lib/metadata/cache";
import { createMetadataCacheFixture } from "@/lib/metadata/cache-test-fixture";
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
  const { cache, entries, put } = createMetadataCacheFixture();
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
  expect(await getCachedRadioGardenItem(cache, "station")).toMatchObject({
    streamUrl: "https://audio.example/live?token=1",
    success: true,
  });
  expect(await getCachedRadioGardenItem(cache, "station")).toMatchObject({
    streamUrl: "https://audio.example/live?token=2",
    success: true,
  });
  expect(attributes).toBe(1);
  expect(streams).toBe(2);
  expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 86_400 });
  expect([...entries.values()].join()).not.toContain("token=");
});

test("Radio Garden caches empty searches but retries upstream failures", async () => {
  const { cache, put } = createMetadataCacheFixture();
  const fetchMock = spyOn(fetchTarget, "fetch").mockResolvedValue(
    new Response(null, { status: 503 })
  );
  await expect(searchCachedRadioGarden(cache, "empty")).rejects.toThrow();
  expect(put).not.toHaveBeenCalled();
  fetchMock.mockImplementation(() =>
    Promise.resolve(Response.json({ hits: { hits: [] } }))
  );
  expect(await searchCachedRadioGarden(cache, "empty")).toEqual([]);
  expect(await searchCachedRadioGarden(cache, "empty")).toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 600 });
});

test("Radio Browser shares validated searches and isolates query and limit", async () => {
  const { cache } = createMetadataCacheFixture();
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
  const first = await searchCachedRadioBrowser(cache, "ambient", 10);
  expect(first.map((station) => station.stationUuid)).toEqual(["valid"]);
  expect(await searchCachedRadioBrowser(cache, "ambient", 10)).toEqual(first);
  expect(searches).toHaveLength(1);
  await searchCachedRadioBrowser(cache, "ambient", 20);
  await searchCachedRadioBrowser(cache, "jazz", 10);
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

test("Radio Browser caches mixed searches and refreshes query-bearing playback in one lookup", async () => {
  const { cache, entries, put } = createMetadataCacheFixture();
  const searches: URL[] = [];
  const lookups: URL[] = [];
  spyOn(fetchTarget, "fetch").mockImplementation((input) => {
    const url = new URL(String(input));
    if (url.pathname === "/json/servers") {
      return Promise.resolve(
        Response.json([{ name: "de1.api.radio-browser.info" }])
      );
    }
    const signed = {
      codec: "MP3",
      lastcheckok: 1,
      name: "Signed",
      stationuuid: "signed",
      url: "https://93.184.216.34/live?session=canonical",
      url_resolved: `https://93.184.216.34/live?token=${searches.length + lookups.length + 1}`,
    };
    const attributed = {
      codec: "MP3",
      lastcheckok: 1,
      name: "Attributed",
      stationuuid: "attributed",
      url_resolved: "https://93.184.216.34/live?utm_source=radio-browser",
    };
    if (url.pathname === "/json/stations/byuuid") {
      lookups.push(url);
      // The UUID endpoint does not promise the search's ordering.
      return Promise.resolve(Response.json([attributed, signed]));
    }
    searches.push(url);
    return Promise.resolve(
      Response.json([
        signed,
        {
          codec: "MP3",
          lastcheckok: 1,
          name: "Public",
          stationuuid: "public",
          url_resolved: "https://93.184.216.34/public",
        },
        attributed,
      ])
    );
  });
  const first = await searchCachedRadioBrowser(cache, "mixed", 10);
  expect(first.map((station) => station.stationUuid)).toEqual([
    "signed",
    "public",
    "attributed",
  ]);
  expect(first[0]?.urlResolved).toContain("token=1");
  expect(put).toHaveBeenCalledTimes(1);
  expect(lookups).toHaveLength(0);
  const second = await searchCachedRadioBrowser(cache, "mixed", 10);
  const third = await searchCachedRadioBrowser(cache, "mixed", 10);
  expect(second.map((station) => station.stationUuid)).toEqual(
    first.map((station) => station.stationUuid)
  );
  expect(second[2]?.urlResolved).toBe(first[2]?.urlResolved);
  expect(second[0]?.urlResolved).toContain("token=2");
  expect(third[0]?.urlResolved).toContain("token=3");
  expect(third[0]?.url).toContain("session=canonical");
  expect(searches).toHaveLength(1);
  expect(lookups.map((url) => url.searchParams.get("uuids"))).toEqual([
    "signed,attributed",
    "signed,attributed",
  ]);
  expect(put).toHaveBeenCalledTimes(1);
  const persisted = [...entries.values()].join();
  expect(persisted).toContain("Attributed");
  expect(persisted).not.toContain("token=");
  expect(persisted).not.toContain("session=");
  expect(persisted).not.toContain("utm_source=");
});

test("Radio Browser retries a DNS outage instead of caching a partial search", async () => {
  const { cache, put } = createMetadataCacheFixture();
  const dnsResponse = mock(() => new Response(null, { status: 503 }));
  let searches = 0;
  spyOn(fetchTarget, "fetch").mockImplementation((input) => {
    const url = new URL(String(input));
    if (url.pathname === "/json/servers") {
      return Promise.resolve(
        Response.json([{ name: "de1.api.radio-browser.info" }])
      );
    }
    if (url.hostname === "cloudflare-dns.com") {
      return Promise.resolve(dnsResponse());
    }
    searches += 1;
    return Promise.resolve(
      Response.json([
        {
          name: "Needs DNS",
          stationuuid: "dns",
          url_resolved: "https://radio.example/live",
        },
        {
          name: "Public IP",
          stationuuid: "public-ip",
          url_resolved: "https://93.184.216.34/live",
        },
      ])
    );
  });
  await expect(searchCachedRadioBrowser(cache, "dns", 10)).rejects.toThrow();
  expect(put).not.toHaveBeenCalled();
  dnsResponse.mockImplementation(() =>
    Response.json({
      Answer: [{ data: "93.184.216.34", type: 1 }],
      Status: 0,
    })
  );
  const recovered = await searchCachedRadioBrowser(cache, "dns", 10);
  expect(recovered.map((station) => station.stationUuid)).toEqual([
    "dns",
    "public-ip",
  ]);
  expect(await searchCachedRadioBrowser(cache, "dns", 10)).toEqual(recovered);
  expect(searches).toBe(2);
  expect(put).toHaveBeenCalledTimes(1);
});

test("Radio Browser retries failed refreshes and only filters unavailable stations from successful lookups", async () => {
  const { cache, put } = createMetadataCacheFixture();
  let state: "initial" | "outage" | "unsafe" | "missing" | "recovered" =
    "initial";
  let searches = 0;
  spyOn(fetchTarget, "fetch").mockImplementation((input) => {
    const url = new URL(String(input));
    if (url.pathname === "/json/servers") {
      return Promise.resolve(
        Response.json([{ name: "de1.api.radio-browser.info" }])
      );
    }
    if (url.pathname === "/json/stations/search") {
      searches += 1;
    } else if (state === "outage") {
      return Promise.resolve(new Response(null, { status: 503 }));
    }
    if (state === "missing") {
      return Promise.resolve(Response.json([]));
    }
    return Promise.resolve(
      Response.json([
        {
          name: "Station",
          stationuuid: "station",
          url_resolved:
            state === "unsafe"
              ? "https://127.0.0.1/live?token=unsafe"
              : `https://93.184.216.34/live?token=${state}`,
        },
        ...(url.pathname === "/json/stations/search"
          ? [
              {
                name: "Public",
                stationuuid: "public",
                url_resolved: "https://93.184.216.34/public",
              },
            ]
          : []),
      ])
    );
  });
  const first = await searchCachedRadioBrowser(cache, "refresh", 10);
  expect(first).toHaveLength(2);
  state = "outage";
  await expect(
    searchCachedRadioBrowser(cache, "refresh", 10)
  ).rejects.toThrow();
  state = "unsafe";
  expect(
    (await searchCachedRadioBrowser(cache, "refresh", 10)).map(
      (station) => station.stationUuid
    )
  ).toEqual(["public"]);
  state = "missing";
  expect(
    (await searchCachedRadioBrowser(cache, "refresh", 10)).map(
      (station) => station.stationUuid
    )
  ).toEqual(["public"]);
  state = "recovered";
  const recovered = await searchCachedRadioBrowser(cache, "refresh", 10);
  expect(recovered.map((station) => station.stationUuid)).toEqual([
    "station",
    "public",
  ]);
  expect(recovered[0]?.urlResolved).toContain("token=recovered");
  expect(searches).toBe(1);
  expect(put).toHaveBeenCalledTimes(1);
});

test("Radio Browser caches valid empty searches and bypasses the old failure-prone key", async () => {
  const { cache, put } = createMetadataCacheFixture();
  await cacheMetadata({
    cache,
    key: ["radio-browser", "search", "empty", 10],
    retrieve: async () => [{ stationUuid: "old-partial-result" }],
    ttl: DIRECTORY_SEARCH_TTL,
  });
  let searches = 0;
  spyOn(fetchTarget, "fetch").mockImplementation((input) => {
    if (String(input).includes("/json/servers")) {
      return Promise.resolve(
        Response.json([{ name: "de1.api.radio-browser.info" }])
      );
    }
    searches += 1;
    return Promise.resolve(Response.json([]));
  });
  expect(await searchCachedRadioBrowser(cache, "empty", 10)).toEqual([]);
  expect(await searchCachedRadioBrowser(cache, "empty", 10)).toEqual([]);
  expect(searches).toBe(1);
  expect(put).toHaveBeenCalledTimes(2);
});
