import { expect, test } from "bun:test";
import { cacheMetadata, EPISODE_METADATA_TTL } from "./cache";
import {
  tryAirtimeLiveInfo,
  tryHkcrSchedule,
  tryRadioBlackoutApi,
} from "./external-providers";
import { createMetadataStoreFixture } from "./store-test-fixture";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const START = Date.parse("2026-09-04T13:30:00Z");
const json = (data: unknown) => Promise.resolve(Response.json(data));
const IPR_STREAM =
  "https://stream-relay-geo.internetpublicradio.live/stream/main";
const IPR_FEED =
  "https://stream-relay-geo.internetpublicradio.live/api-filtered.php";
const IPR_EPISODE = {
  _id: "episode-id",
  _type: "episode",
  date: "2022-09-20",
  image: { asset: { _ref: "image-abcdef-2000x1125-jpg" } },
  label: "Idle Not Idle",
  resident: { slug: { current: "idle-not-idle" } },
  slug: { current: "idle-not-idle-20th-september-2022" },
};
const IPR_FIELDS = {
  artworkUrl:
    "https://cdn.sanity.io/images/7rbo2iih/production/abcdef-2000x1125.jpg",
  itemUrl:
    "https://www.internetpublicradio.live/idle-not-idle/episodes/idle-not-idle-20th-september-2022",
  title: "Idle Not Idle (R)",
};

test("HKCR caches only show display fields for six hours, independently for each show ID", async () => {
  const { store, entries, put } = createMetadataStoreFixture();
  let time = START;
  let scheduleCalls = 0;
  let replayCalls = 0;
  const showCalls = new Map<string, number>();
  const read = (showId: string) =>
    tryHkcrSchedule({
      expiresAt: time + 60_000,
      fetchImpl: (url) => {
        if (url.includes("/schedule/")) {
          scheduleCalls += 1;
          return json([]);
        }
        if (url.includes("/replay-slots/")) {
          replayCalls += 1;
          return json({
            slots: [
              {
                end: new Date(time + 60_000).toISOString(),
                replay: {
                  storagePath: "private-replay-storage",
                  title: `Programme ${showId}`,
                  url: "https://audio.example/replay?token=replay-secret",
                },
                show: showId,
                start: new Date(time - 1000).toISOString(),
              },
            ],
          });
        }
        const id = new URL(url).pathname.split("/").at(-1) ?? "";
        showCalls.set(id, (showCalls.get(id) ?? 0) + 1);
        return json({
          _id: id,
          content: `<p>Description ${id}</p>`,
          medium: { url: `https://cdn.hkcr.live/${id}.jpg` },
          mixcloud: "https://audio.example/show?token=show-secret",
          resident: {
            email: "private-resident-email",
            name: `Resident ${id}`,
            slug: `resident-${id}`,
          },
          slug: id,
          storagePath: "private-show-storage",
          tags: [{ name: "Experimental" }],
          title: `Programme ${id}`,
          tracklist: ["private-tracklist"],
        });
      },
      now: () => time,
      sampledAt: time,
      store,
      streamUrl: "https://stream-test.hkcr.live/hls/main.m3u8",
    });
  expect(await read("first")).toMatchObject({
    artist: "Resident first",
    artworkUrl: "https://cdn.hkcr.live/first.jpg",
    genre: "Experimental",
    itemUrl: "https://hkcr.live/shows/first",
    sampledAt: START,
    stationDescription: "Description first",
  });
  time += 60_000;
  expect(await read("first")).toMatchObject({
    expiresAt: time + 60_000,
    sampledAt: time,
    stationDescription: "Description first",
    title: "Programme first",
  });
  expect(showCalls.get("first")).toBe(1);
  time += 60_000;
  expect(await read("second")).toMatchObject({
    artworkUrl: "https://cdn.hkcr.live/second.jpg",
    stationDescription: "Description second",
    title: "Programme second",
  });
  expect(showCalls.get("second")).toBe(1);
  expect(entries.size).toBe(2);
  expect(put.mock.calls.map((call) => call[2])).toEqual([
    { expirationTtl: 21_600 },
    { expirationTtl: 21_600 },
  ]);
  const stored = [...entries.values()].join();
  for (const excluded of [
    "token=",
    "private-",
    "sampledAt",
    "streamUrl",
    "tracklist",
    "mixcloud",
    "storagePath",
    "email",
  ]) {
    expect(stored).not.toContain(excluded);
  }
  for (const entry of entries.values()) {
    const cached = JSON.parse(entry) as { value: object };
    expect(cached.value).not.toHaveProperty("expiresAt");
  }
  time = START + SIX_HOURS_MS;
  await read("first");
  expect(showCalls.get("first")).toBe(2);
  await read("second");
  expect(showCalls.get("second")).toBe(1);
  expect(scheduleCalls).toBe(5);
  expect(replayCalls).toBe(5);
});

test("BlackOut reuses sanitized full description and genres until six-hour expiry", async () => {
  const { store, entries, put } = createMetadataStoreFixture();
  let time = START;
  let liveCalls = 0;
  let detailCalls = 0;
  const read = () =>
    tryRadioBlackoutApi({
      expiresAt: time + 60_000,
      fetchImpl: (url) => {
        if (url.endsWith("/api/listening")) {
          liveCalls += 1;
          return json({
            excerpt: "Short [&hellip;]",
            featured_media: `https://radioblackout.org/live-${liveCalls}.jpg`,
            link: "https://radioblackout.org/shows/harraga/",
            title: "HARRAGA",
          });
        }
        detailCalls += 1;
        return json([
          {
            content: "<p>Full &amp; decoded description.</p>",
            link: "https://radioblackout.org/shows/harraga/",
            playbackUrl: "https://audio.example/blackout?token=secret",
            privateStorage: "private-show-storage",
            slug: "harraga",
            tags: ["frontiere", "lotte"],
            title: "HARRAGA",
          },
        ]);
      },
      now: () => time,
      sampledAt: time,
      store,
      streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
    });
  expect(await read()).toMatchObject({
    artworkUrl: "https://radioblackout.org/live-1.jpg",
    genre: "frontiere, lotte",
    stationDescription: "Full & decoded description.",
  });
  time += 60_000;
  expect(await read()).toMatchObject({
    artworkUrl: "https://radioblackout.org/live-2.jpg",
    genre: "frontiere, lotte",
    sampledAt: time,
    stationDescription: "Full & decoded description.",
  });
  expect(detailCalls).toBe(1);
  expect(liveCalls).toBe(2);
  expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 21_600 });
  const stored = [...entries.values()].join();
  expect(stored).not.toContain("token=");
  expect(stored).not.toContain("private-show-storage");
  expect(stored).not.toContain("live-1.jpg");
  time = START + SIX_HOURS_MS;
  await read();
  expect(detailCalls).toBe(2);
});

test.each(["http", "json", "network", "abort"])(
  "BlackOut retries %s detail failures before caching recovery",
  async (failure) => {
    const { store, put } = createMetadataStoreFixture();
    let time = START;
    let detailCalls = 0;
    const read = () =>
      tryRadioBlackoutApi({
        expiresAt: time + 60_000,
        fetchImpl: (url) => {
          if (url.endsWith("/api/listening")) {
            return json({
              excerpt: "Short [&hellip;]",
              featured_media: "https://radioblackout.org/harraga.jpg",
              link: "https://radioblackout.org/shows/harraga/",
              title: "HARRAGA",
            });
          }
          detailCalls += 1;
          if (detailCalls === 1) {
            if (failure === "network") {
              return Promise.reject(new Error("Network unavailable"));
            }
            if (failure === "abort") {
              return Promise.reject(new DOMException("Aborted", "AbortError"));
            }
            return Promise.resolve(
              new Response("Unavailable", {
                status: failure === "http" ? 503 : 200,
              })
            );
          }
          return json([
            {
              content: "Full description",
              link: "https://radioblackout.org/shows/harraga/",
              slug: "harraga",
              tags: ["frontiere"],
              title: "HARRAGA",
            },
          ]);
        },
        now: () => time,
        sampledAt: time,
        store,
        streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
      });
    expect(await read()).toMatchObject({
      artworkUrl: "https://radioblackout.org/harraga.jpg",
      genre: null,
      stationDescription: "Short […]",
    });
    expect(put).not.toHaveBeenCalled();
    time += 60_000;
    expect(await read()).toMatchObject({
      genre: "frontiere",
      sampledAt: time,
      stationDescription: "Full description",
    });
    expect(put).toHaveBeenCalledTimes(1);
    time += 60_000;
    expect(await read()).toMatchObject({
      genre: "frontiere",
      sampledAt: time,
      stationDescription: "Full description",
    });
    expect(detailCalls).toBe(2);
  }
);

test("cached empty BlackOut details preserve each fresh live excerpt", async () => {
  const { store, put } = createMetadataStoreFixture();
  let time = START;
  let liveCalls = 0;
  let detailCalls = 0;
  const read = () =>
    tryRadioBlackoutApi({
      expiresAt: time + 60_000,
      fetchImpl: (url) => {
        if (url.endsWith("/api/listening")) {
          liveCalls += 1;
          return json({
            excerpt: `Live excerpt ${liveCalls}`,
            link: "https://radioblackout.org/shows/harraga/",
            title: "HARRAGA",
          });
        }
        detailCalls += 1;
        return json([
          {
            content: "",
            link: "https://radioblackout.org/shows/harraga/",
            slug: "harraga",
            tags: [],
            title: "HARRAGA",
          },
        ]);
      },
      now: () => time,
      sampledAt: time,
      store,
      streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
    });
  expect(await read()).toMatchObject({ stationDescription: "Live excerpt 1" });
  time += 60_000;
  expect(await read()).toMatchObject({
    sampledAt: time,
    stationDescription: "Live excerpt 2",
  });
  expect(detailCalls).toBe(1);
  expect(put).toHaveBeenCalledTimes(1);
});

test.each(["http", "json", "network", "abort", "mismatched document"])(
  "IPR preserves art and its episode link after %s details, then retries and caches",
  async (failure) => {
    const { store, put, entries } = createMetadataStoreFixture();
    let time = START;
    let liveCalls = 0;
    let searchCalls = 0;
    let detailCalls = 0;
    const read = () =>
      tryAirtimeLiveInfo(
        {
          expiresAt: time + 60_000,
          fetchImpl: (url) => {
            if (url === IPR_FEED) {
              liveCalls += 1;
              return json({
                current: {
                  metadata: {
                    comments: "20.09.22",
                    track_title: "Idle Not Idle (R)",
                  },
                },
              });
            }
            if (url.includes("/api/search")) {
              searchCalls += 1;
              return json([IPR_EPISODE]);
            }
            detailCalls += 1;
            if (detailCalls === 1) {
              if (failure === "network") {
                return Promise.reject(new Error("Network unavailable"));
              }
              if (failure === "abort") {
                return Promise.reject(
                  new DOMException("Aborted", "AbortError")
                );
              }
              if (failure === "mismatched document") {
                return json({
                  result: {
                    _id: "other-episode",
                    description: "Wrong description",
                  },
                });
              }
              return Promise.resolve(
                new Response("Unavailable", {
                  status: failure === "http" ? 503 : 200,
                })
              );
            }
            return json({
              result: {
                _id: IPR_EPISODE._id,
                _type: IPR_EPISODE._type,
                description: "Episode description",
                playbackUrl: "https://audio.example/ipr?token=secret",
                slug: IPR_EPISODE.slug,
                title: "Idle Not Idle",
              },
            });
          },
          now: () => time,
          sampledAt: time,
          store,
          streamUrl: IPR_STREAM,
        },
        [IPR_FEED]
      );
    expect(await read()).toMatchObject({
      ...IPR_FIELDS,
      stationDescription: null,
    });
    expect(put).not.toHaveBeenCalled();
    time += 60_000;
    expect(await read()).toMatchObject({
      ...IPR_FIELDS,
      sampledAt: time,
      stationDescription: "Episode description",
    });
    expect(put).toHaveBeenCalledTimes(1);
    time += 60_000;
    expect(await read()).toMatchObject({
      ...IPR_FIELDS,
      sampledAt: time,
      stationDescription: "Episode description",
    });
    expect(liveCalls).toBe(3);
    expect(searchCalls).toBe(2);
    expect(detailCalls).toBe(2);
    expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 21_600 });
    expect([...entries.values()].join()).not.toContain("token=");
  }
);

test("an unexpired empty Airtime v2 entry cannot hide newly available IPR enrichment", async () => {
  const { store, entries } = createMetadataStoreFixture();
  await cacheMetadata({
    key: [
      new URL(IPR_STREAM).hostname,
      "episode-details-v2",
      "Idle Not Idle (R)",
      [null, null, null, null],
      "2022-09-20",
    ],
    now: () => START,
    retrieve: () => Promise.resolve({}),
    store,
    ttl: EPISODE_METADATA_TTL,
  });
  expect(entries.size).toBe(1);
  let detailCalls = 0;
  const result = await tryAirtimeLiveInfo(
    {
      expiresAt: START + 60_000,
      fetchImpl: (url) => {
        if (url === IPR_FEED) {
          return json({
            current: {
              metadata: {
                comments: "20.09.22",
                track_title: "Idle Not Idle (R)",
              },
            },
          });
        }
        if (url.includes("/api/search")) {
          return json([IPR_EPISODE]);
        }
        detailCalls += 1;
        return json({
          result: {
            _id: IPR_EPISODE._id,
            _type: IPR_EPISODE._type,
            description: "New description",
            slug: IPR_EPISODE.slug,
            title: "Idle Not Idle",
          },
        });
      },
      now: () => START,
      sampledAt: START,
      store,
      streamUrl: IPR_STREAM,
    },
    [IPR_FEED]
  );
  expect(result).toMatchObject({
    ...IPR_FIELDS,
    stationDescription: "New description",
  });
  expect(detailCalls).toBe(1);
  expect(entries.size).toBe(2);
});
