import { describe, expect, test } from "bun:test";
import {
  tryAirtimeLiveInfo,
  tryAzuraCastNowPlaying,
  tryHkcrSchedule,
  tryNtsLiveApi,
  tryRadioAlharaApi,
  tryRadioBlackoutApi,
  tryResonanceExtraApi,
  tryShoutcastStatus,
} from "./external-providers";
import { createMetadataKvFixture } from "./kv-test-fixture";
import { RadioMetadataValidationError } from "./upstream-fetch";

test("NTS channels share a live feed and retain its original sampling time", async () => {
  const { kv } = createMetadataKvFixture();
  let time = 1000;
  let calls = 0;
  const read = (channel: "1" | "2") =>
    tryNtsLiveApi(
      {
        expiresAt: time + 60_000,
        fetchImpl: () => {
          calls += 1;
          return Promise.resolve(
            Response.json({
              results: [
                { channel_name: "1", now: { broadcast_title: "First show" } },
                { channel_name: "2", now: { broadcast_title: "Second show" } },
              ],
            })
          );
        },
        kv,
        now: () => time,
        sampledAt: time,
        streamUrl: `https://stream-relay-geo.ntslive.net/stream${channel}`,
      },
      channel
    );
  expect(await read("1")).toMatchObject({
    sampledAt: 1000,
    title: "First show",
  });
  time = 30_000;
  expect(await read("2")).toMatchObject({
    expiresAt: 61_000,
    sampledAt: 1000,
    streamUrl: "https://stream-relay-geo.ntslive.net/stream2",
    title: "Second show",
  });
  expect(calls).toBe(1);
  time = 61_000;
  expect(await read("2")).toMatchObject({
    expiresAt: 121_000,
    sampledAt: 61_000,
  });
  expect(calls).toBe(2);
});

test("Sygma episode enrichment outlives live snapshots without storing playback fields", async () => {
  const { kv, entries, put } = createMetadataKvFixture();
  let time = 1000;
  let episodeCalls = 0;
  let liveCalls = 0;
  const read = () =>
    tryAirtimeLiveInfo(
      {
        expiresAt: time + 60_000,
        fetchImpl: (url) => {
          if (url.includes("backend.radio.syg.ma")) {
            episodeCalls += 1;
            return Promise.resolve(
              Response.json({
                description: "Description",
                picture: { url: "https://radio.syg.ma/art.jpg" },
                slug: "episode",
                stream: "https://audio.example/signed?token=secret",
                title: "Episode",
              })
            );
          }
          liveCalls += 1;
          return Promise.resolve(
            Response.json({
              current: { metadata: { info_url: "episode" }, name: "Episode" },
            })
          );
        },
        kv,
        now: () => time,
        sampledAt: time,
        streamUrl: "https://radio.syg.ma/audio/live",
      },
      ["https://radio.syg.ma/api/live-info"]
    );
  expect(await read()).toMatchObject({
    sampledAt: 1000,
    stationDescription: "Description",
  });
  time += 60_000;
  expect(await read()).toMatchObject({
    sampledAt: time,
    stationDescription: "Description",
  });
  expect(liveCalls).toBe(2);
  expect(episodeCalls).toBe(1);
  expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 21_600 });
  expect([...entries.values()].join()).not.toContain("token=secret");
  time += 21_600_000;
  await read();
  expect(episodeCalls).toBe(2);
});

test.each(["http", "json", "network", "abort"])(
  "retries partial Cashmere enrichment after %s failure without losing artwork",
  async (failure) => {
    const { kv, put } = createMetadataKvFixture();
    let time = 1000;
    let episodeCalls = 0;
    let graphqlCalls = 0;
    let liveCalls = 0;
    const read = () =>
      tryAirtimeLiveInfo({
        expiresAt: time + 60_000,
        fetchImpl: (url) => {
          if (url === "https://backstage.cashmereradio.com/graphql") {
            graphqlCalls += 1;
            return Promise.resolve(
              Response.json({
                data: {
                  episodes: {
                    nodes: [
                      {
                        databaseId: 42,
                        featuredImage: {
                          node: {
                            sourceUrl:
                              "https://media.cashmereradio.com/show.jpg",
                          },
                        },
                        title: "Archive Show",
                        uri: "/episode/archive-show/",
                      },
                    ],
                  },
                },
              })
            );
          }
          if (url.includes("/wp-json/wp/v2/episode/42?")) {
            episodeCalls += 1;
            if (episodeCalls === 1) {
              if (failure === "network") {
                throw new TypeError("fetch failed");
              }
              if (failure === "abort") {
                throw new DOMException("aborted", "AbortError");
              }
              return Promise.resolve(
                new Response("Unavailable", {
                  status: failure === "http" ? 503 : 200,
                })
              );
            }
            return Promise.resolve(
              Response.json({
                content: { rendered: "<p>Recovered description.</p>" },
                id: 42,
                link: "https://backstage.cashmereradio.com/episode/archive-show/",
                slug: "archive-show",
              })
            );
          }
          liveCalls += 1;
          return Promise.resolve(
            Response.json({
              tracks: { current: { name: "Archive Show" } },
            })
          );
        },
        kv,
        now: () => time,
        sampledAt: time,
        streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
      });
    const partial = {
      artworkUrl: "https://media.cashmereradio.com/show.jpg",
      itemUrl: "https://cashmereradio.com/episode/archive-show/",
      title: "Archive Show",
    };
    expect(await read()).toMatchObject({
      ...partial,
      sampledAt: 1000,
      stationDescription: null,
    });
    expect(put).not.toHaveBeenCalled();
    time += 60_000;
    expect(await read()).toMatchObject({
      ...partial,
      sampledAt: time,
      stationDescription: "Recovered description.",
    });
    expect(put).toHaveBeenCalledTimes(1);
    time += 60_000;
    expect(await read()).toMatchObject({
      ...partial,
      sampledAt: time,
      stationDescription: "Recovered description.",
    });
    expect(liveCalls).toBe(3);
    expect(graphqlCalls).toBe(2);
    expect(episodeCalls).toBe(2);
  }
);

test("caches valid empty Cashmere episode and show searches between live samples", async () => {
  const { kv, put } = createMetadataKvFixture();
  let time = 1000;
  let graphqlCalls = 0;
  let showCalls = 0;
  const read = () =>
    tryAirtimeLiveInfo({
      expiresAt: time + 60_000,
      fetchImpl: (url) => {
        if (url === "https://backstage.cashmereradio.com/graphql") {
          graphqlCalls += 1;
          return Promise.resolve(
            Response.json({ data: { episodes: { nodes: [] } } })
          );
        }
        if (url.includes("/wp-json/wp/v2/pages?")) {
          showCalls += 1;
          return Promise.resolve(Response.json([]));
        }
        return Promise.resolve(
          Response.json({ tracks: { current: { name: "Unarchived Show" } } })
        );
      },
      kv,
      now: () => time,
      sampledAt: time,
      streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
    });
  expect(await read()).toMatchObject({ title: "Unarchived Show" });
  time += 60_000;
  expect(await read()).toMatchObject({
    sampledAt: time,
    title: "Unarchived Show",
  });
  expect(graphqlCalls).toBe(1);
  expect(showCalls).toBe(1);
  expect(put).toHaveBeenCalledTimes(1);
});

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

describe("external radio metadata providers", () => {
  test("normalizes Sygma/Airtime live-info style current tracks", async () => {
    const calls: string[] = [];
    const result = await tryAirtimeLiveInfo({
      expiresAt: 2000,
      fetchImpl: (url) => {
        calls.push(url);
        if (
          url === "https://backend.radio.syg.ma/episodes/guests-179-naive.json"
        ) {
          return Promise.resolve(
            json({
              description: "Episode description",
              picture: { url: "https://radio-cdn.syg.ma/naive.jpg" },
              slug: "guests-179-naive",
              title: "GUESTS 179 – naîve",
            })
          );
        }
        return Promise.resolve(
          json({
            tracks: {
              current: {
                metadata: {
                  album_title: "Guests",
                  artist_name: "",
                  info_url: "guests-179-naive",
                  track_title: "GUESTS 179 – naîve",
                },
                name: " - ignored fallback",
              },
            },
          })
        );
      },
      sampledAt: 1000,
      streamUrl: "https://radio.syg.ma/audio.ogg",
    });

    expect(calls[0]).toBe("https://radio.syg.ma/stats-icecast.json");
    expect(result?.source).toBe("airtime-live-info");
    expect(result?.title).toBe("GUESTS 179 – naîve");
    expect(result?.album).toBe("Guests");
    expect(result?.artist).toBeNull();
    expect(result?.artworkUrl).toBe("https://radio-cdn.syg.ma/naive.jpg");
    expect(result?.itemUrl).toBe(
      "https://radio.syg.ma/episodes/guests-179-naive"
    );
    expect(result?.stationDescription).toBe("Episode description");
    expect(result?.stationName).toBe("Sygma Radio");
  });

  test("keeps base Airtime metadata when optional enrichment aborts", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    const result = await tryAirtimeLiveInfo({
      expiresAt: 2000,
      fetchImpl: (url) => {
        if (url === "https://radio.syg.ma/stats-icecast.json") {
          return Promise.resolve(
            json({
              tracks: {
                current: {
                  metadata: {
                    info_url: "guests-179-naive",
                    track_title: "GUESTS 179 – naîve",
                  },
                },
              },
            })
          );
        }
        throw abortError;
      },
      sampledAt: 1000,
      streamUrl: "https://radio.syg.ma/audio.ogg",
    });

    expect(result).toMatchObject({
      artworkUrl: null,
      itemUrl: "https://radio.syg.ma/episodes/guests-179-naive",
      title: "GUESTS 179 – naîve",
    });
  });

  test("continues Airtime fallbacks after a candidate fetch throws", async () => {
    const calls: string[] = [];
    const result = await tryAirtimeLiveInfo(
      {
        expiresAt: 2000,
        fetchImpl: (url) => {
          calls.push(url);
          if (url === "https://bad.example/live-info") {
            throw new TypeError("fetch failed");
          }
          return Promise.resolve(
            json({
              tracks: {
                current: {
                  name: "Recovered Show",
                },
              },
            })
          );
        },
        sampledAt: 1000,
        streamUrl: "https://radio.example/audio.mp3",
      },
      ["https://bad.example/live-info", "https://good.example/live-info"]
    );

    expect(calls).toEqual([
      "https://bad.example/live-info",
      "https://good.example/live-info",
    ]);
    expect(result?.source).toBe("airtime-live-info");
    expect(result?.title).toBe("Recovered Show");
  });

  test("propagates Airtime aborts instead of treating them as unsupported", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    await expect(
      tryAirtimeLiveInfo(
        {
          expiresAt: 2000,
          fetchImpl: () => {
            throw abortError;
          },
          sampledAt: 1000,
          streamUrl: "https://radio.example/audio.mp3",
        },
        ["https://bad.example/live-info", "https://good.example/live-info"]
      )
    ).rejects.toThrow("aborted");
  });

  test.each([
    "/episode/v2-show/",
    "episode/v2-show/",
    "https://cashmereradio.com/episode/v2-show/",
    "//cashmereradio.com/episode/v2-show/",
  ])(
    "accepts verified Cashmere episode URI %s from Airtime v2 enrichment",
    async (uri) => {
      const calls: string[] = [];
      const result = await tryAirtimeLiveInfo({
        expiresAt: 2000,
        fetchImpl: (url, init) => {
          calls.push(url);
          if (url === "https://backstage.cashmereradio.com/graphql") {
            expect(init?.method).toBe("POST");
            return Promise.resolve(
              json({
                data: {
                  episodes: {
                    nodes: [
                      {
                        featuredImage: {
                          node: {
                            sourceUrl:
                              "https://media.cashmereradio.com/piss-14.jpg",
                          },
                        },
                        title: "V2 Show",
                        uri,
                      },
                    ],
                  },
                },
              })
            );
          }
          return Promise.resolve(
            json({
              tracks: {
                current: {
                  metadata: {
                    artist_name: "Cashmere Host",
                    track_title: "V2 Show",
                  },
                },
              },
            })
          );
        },
        sampledAt: 1000,
        streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
      });

      expect(calls[0]).toBe(
        "https://cashmereradio.airtime.pro/api/live-info-v2"
      );
      expect(result?.artist).toBe("Cashmere Host");
      expect(result?.artworkUrl).toBe(
        "https://media.cashmereradio.com/piss-14.jpg"
      );
      expect(result?.itemUrl).toBe(
        "https://cashmereradio.com/episode/v2-show/"
      );
      expect(result?.stationName).toBe("Cashmere Radio");
      expect(result?.title).toBe("V2 Show");
    }
  );

  test.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "https://unrelated.example/episode/unsafe-link-show/",
    "//unrelated.example/episode/unsafe-link-show/",
    "http://cashmereradio.com/episode/unsafe-link-show/",
    "https://cashmereradio.com:8443/episode/unsafe-link-show/",
    "https://user:password@cashmereradio.com/episode/unsafe-link-show/",
    "https://cashmereradio.com/shows/unsafe-link-show/",
    "/episode/../shows/unsafe-link-show/",
    "/episode/%E0%A4%A/",
  ])("rejects unverified Cashmere episode URI %s", async (uri) => {
    const calls: string[] = [];
    const result = await tryAirtimeLiveInfo({
      expiresAt: 2000,
      fetchImpl: (url) => {
        calls.push(url);
        return Promise.resolve(
          url === "https://backstage.cashmereradio.com/graphql"
            ? json({
                data: {
                  episodes: {
                    nodes: [
                      {
                        databaseId: 42,
                        title: "Unsafe Link Show",
                        uri,
                      },
                    ],
                  },
                },
              })
            : json({
                tracks: {
                  current: {
                    metadata: { track_title: "Unsafe Link Show" },
                  },
                },
              })
        );
      },
      sampledAt: 1000,
      streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
    });

    expect(result?.itemUrl).toBeNull();
    expect(result?.title).toBe("Unsafe Link Show");
    expect(calls).toHaveLength(2);
  });

  test.each([
    { artwork: null, description: null, genre: null },
    {
      artwork: "https://media.cashmereradio.com/archive.jpg",
      description: null,
      genre: null,
    },
    {
      artwork: "https://media.cashmereradio.com/archive.jpg",
      description: "Feed description",
      genre: null,
    },
    {
      artwork: "https://media.cashmereradio.com/archive.jpg",
      description: null,
      genre: "Feed genre",
    },
    {
      artwork: "https://media.cashmereradio.com/archive.jpg",
      description: "Feed description",
      genre: "Feed genre",
    },
  ])(
    "enriches missing Cashmere archive fields from its REST record: %j",
    async ({ artwork, description, genre }) => {
      const calls: string[] = [];
      const result = await tryAirtimeLiveInfo({
        expiresAt: 2000,
        fetchImpl: (url) => {
          calls.push(url);
          if (url === "https://cashmereradio.airtime.pro/api/live-info-v2") {
            return Promise.resolve(
              json({
                shows: { current: { description } },
                tracks: {
                  current: {
                    metadata: {
                      artwork_url: artwork,
                      genre,
                      track_title: "Archive Show",
                      url: artwork
                        ? "https://cashmereradio.com/episode/archive-show/"
                        : null,
                    },
                  },
                },
              })
            );
          }
          if (url === "https://backstage.cashmereradio.com/graphql") {
            return Promise.resolve(
              json({
                data: {
                  episodes: {
                    nodes: [
                      {
                        databaseId: 42,
                        title: "Archive Show",
                        uri: "/episode/archive-show/",
                      },
                    ],
                  },
                },
              })
            );
          }
          if (
            url.startsWith(
              "https://backstage.cashmereradio.com/wp-json/wp/v2/episode/42?"
            )
          ) {
            return Promise.resolve(
              json({
                acf: {
                  episode_filter_genre: ["Ambient", "Experimental"],
                  episode_filter_mood: ["Dreamy"],
                },
                content: {
                  rendered: "<p>Archive &amp; episode description.</p>",
                },
                id: 42,
                link: "https://backstage.cashmereradio.com/episode/archive-show/",
                slug: "archive-show",
              })
            );
          }
          throw new Error(`Unexpected URL: ${url}`);
        },
        sampledAt: 1000,
        streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
      });

      expect(calls).toHaveLength(artwork && description && genre ? 1 : 3);
      expect(result).toMatchObject({
        artworkUrl: artwork,
        genre: genre ?? "Ambient, Experimental, Dreamy",
        itemUrl: "https://cashmereradio.com/episode/archive-show/",
        stationDescription: description ?? "Archive & episode description.",
        title: "Archive Show",
      });
    }
  );

  test("enriches an exact Cashmere live show from its first-party page record", async () => {
    const calls: string[] = [];
    const result = await tryAirtimeLiveInfo({
      expiresAt: 2000,
      fetchImpl: (url) => {
        calls.push(url);
        if (url === "https://cashmereradio.airtime.pro/api/live-info-v2") {
          return Promise.resolve(
            json({
              shows: {
                current: {
                  name: "The Poetry Hotline w/ Amanda Kraley",
                  url: "https://cashmereradio.com/shows/the-poetry-hotline-w-amanda/",
                },
              },
              tracks: { current: { name: "" } },
            })
          );
        }
        if (
          url ===
          "https://backstage.cashmereradio.com/wp-json/wp/v2/pages?slug=the-poetry-hotline-w-amanda&_embed=wp%3Afeaturedmedia&_fields=slug%2Clink%2Ccontent%2C_links%2C_embedded"
        ) {
          return Promise.resolve(
            json([
              {
                _embedded: {
                  "wp:featuredmedia": [
                    {
                      source_url:
                        "https://media.cashmereradio.com/poetry-hotline.jpg",
                    },
                  ],
                },
                content: {
                  rendered: "<p>Poetry, folk &amp; jazz.</p>",
                },
                link: "https://backstage.cashmereradio.com/shows/the-poetry-hotline-w-amanda/",
                slug: "the-poetry-hotline-w-amanda",
              },
            ])
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      sampledAt: 1000,
      streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
    });

    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({
      artworkUrl: "https://media.cashmereradio.com/poetry-hotline.jpg",
      itemUrl: "https://cashmereradio.com/shows/the-poetry-hotline-w-amanda/",
      stationDescription: "Poetry, folk & jazz.",
      stationName: "Cashmere Radio",
      title: "The Poetry Hotline w/ Amanda Kraley",
    });
  });

  test("retries Cashmere show enrichment when its page identity differs", async () => {
    const { kv, put } = createMetadataKvFixture();
    let time = 1000;
    let showCalls = 0;
    const read = () =>
      tryAirtimeLiveInfo({
        expiresAt: time + 60_000,
        fetchImpl: (url) => {
          if (url === "https://cashmereradio.airtime.pro/api/live-info-v2") {
            return Promise.resolve(
              json({
                shows: {
                  current: {
                    name: "Expected Show",
                    url: "https://cashmereradio.com/shows/expected-show/",
                  },
                },
              })
            );
          }
          showCalls += 1;
          const slug = showCalls === 1 ? "wrong-show" : "expected-show";
          return Promise.resolve(
            json([
              {
                _embedded: {
                  "wp:featuredmedia": [
                    {
                      source_url: `https://media.cashmereradio.com/${slug}.jpg`,
                    },
                  ],
                },
                content: { rendered: `<p>${slug} description.</p>` },
                link: `https://backstage.cashmereradio.com/shows/${slug}/`,
                slug,
              },
            ])
          );
        },
        kv,
        now: () => time,
        sampledAt: time,
        streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
      });

    expect(await read()).toMatchObject({
      artworkUrl: null,
      itemUrl: "https://cashmereradio.com/shows/expected-show/",
      stationDescription: null,
      title: "Expected Show",
    });
    expect(put).not.toHaveBeenCalled();
    time += 60_000;
    expect(await read()).toMatchObject({
      artworkUrl: "https://media.cashmereradio.com/expected-show.jpg",
      stationDescription: "expected-show description.",
    });
    time += 60_000;
    await read();
    expect(showCalls).toBe(2);
    expect(put).toHaveBeenCalledTimes(1);
  });

  test("does not present an IPR resident fallback as the current episode", async () => {
    const liveInfoUrl =
      "https://stream-relay-geo.internetpublicradio.live/api-filtered.php";
    const result = await tryAirtimeLiveInfo(
      {
        expiresAt: 2000,
        fetchImpl: async (url) =>
          url.startsWith("https://www.internetpublicradio.live/api/search?")
            ? json([
                {
                  _type: "episode",
                  date: "2024-07-02",
                  image: {
                    asset: {
                      _ref: "image-abc123-1200x1200-jpg",
                    },
                  },
                  label: "Memory Archive w/ FDG",
                  resident: {
                    slug: { current: "memory-archive-w-fdg" },
                  },
                  slug: { current: "memory-archive-w-fdg" },
                },
                {
                  _type: "episode",
                  date: "2024-08-06",
                  label: "Memory Archive w/ FDG",
                  resident: {
                    slug: { current: "memory-archive-w-fdg" },
                  },
                  slug: {
                    current: "memory-archive-w-fdg-6th-august-2024",
                  },
                },
                {
                  _type: "resident",
                  image: {
                    asset: {
                      _ref: "image-abc123-1200x1200-jpg",
                    },
                  },
                  label: "Memory Archive w/ FDG",
                  slug: { current: "memory-archive-w-fdg" },
                },
              ])
            : json({
                tracks: {
                  current: {
                    metadata: {
                      comments: "02.04.24",
                      track_title: "Memory Archive w/ FDG (R)",
                    },
                  },
                },
              }),
        sampledAt: 1000,
        streamUrl:
          "https://stream-relay-geo.internetpublicradio.live/stream/main",
      },
      [liveInfoUrl]
    );

    expect(result).toMatchObject({
      artist: null,
      artworkUrl:
        "https://cdn.sanity.io/images/7rbo2iih/production/abc123-1200x1200.jpg",
      itemUrl: null,
      stationName: "Internet Public Radio",
      title: "Memory Archive w/ FDG (R)",
    });
  });

  test("rejects the only IPR episode when its date contradicts the feed", async () => {
    const liveInfoUrl =
      "https://stream-relay-geo.internetpublicradio.live/api-filtered.php";
    const result = await tryAirtimeLiveInfo(
      {
        expiresAt: 2000,
        fetchImpl: async (url) =>
          url.startsWith("https://www.internetpublicradio.live/api/search?")
            ? json([
                {
                  _type: "episode",
                  date: "2024-07-02",
                  image: {
                    asset: { _ref: "image-abc123-1200x1200-jpg" },
                  },
                  label: "Memory Archive w/ FDG",
                  resident: {
                    slug: { current: "memory-archive-w-fdg" },
                  },
                  slug: { current: "memory-archive-w-fdg-2nd-july-2024" },
                },
              ])
            : json({
                tracks: {
                  current: {
                    metadata: {
                      comments: "02.04.24",
                      track_title: "Memory Archive w/ FDG (R)",
                    },
                  },
                },
              }),
        sampledAt: 1000,
        streamUrl:
          "https://stream-relay-geo.internetpublicradio.live/stream/main",
      },
      [liveInfoUrl]
    );

    expect(result).toMatchObject({
      artworkUrl: null,
      itemUrl: null,
      title: "Memory Archive w/ FDG (R)",
    });
  });

  test("normalizes AzuraCast now-playing API responses", async () => {
    const calls: string[] = [];
    const result = await tryAzuraCastNowPlaying({
      expiresAt: 2000,
      fetchImpl: (url) => {
        calls.push(url);
        return Promise.resolve(
          json({
            now_playing: {
              song: {
                album: "Album",
                art: "https://radio.example/art.jpg",
                artist: "Artist",
                genre: "Genre",
                title: "Title",
              },
            },
            station: {
              description: "AzuraCast station",
              listen_url:
                "https://azuracast.gattomisterioso.top/listen/gatto_misterioso/radio.mp3",
              name: "Gatto Misterioso",
            },
          })
        );
      },
      sampledAt: 1000,
      streamUrl:
        "https://azuracast.gattomisterioso.top/listen/gatto_misterioso/radio.mp3",
    });

    expect(calls).toEqual([
      "https://azuracast.gattomisterioso.top/api/nowplaying/gatto_misterioso",
    ]);
    expect(result).toMatchObject({
      album: "Album",
      artist: "Artist",
      artworkUrl: "https://radio.example/art.jpg",
      genre: "Genre",
      source: "azuracast-now-playing",
      stationName: "Gatto Misterioso",
      title: "Title",
    });
  });

  test("does not default AzuraCast multi-station responses to the first station", async () => {
    const result = await tryAzuraCastNowPlaying({
      expiresAt: 2000,
      fetchImpl: async () =>
        json([
          {
            now_playing: { song: { title: "Wrong Station" } },
            station: {
              listen_url: "https://azuracast.example/listen/other/radio.mp3",
              name: "Other Station",
            },
          },
        ]),
      sampledAt: 1000,
      streamUrl: "https://azuracast.example/listen/right/radio.mp3",
    });

    expect(result).toBeNull();
  });

  test("does not accept a single AzuraCast response for a different stream", async () => {
    const result = await tryAzuraCastNowPlaying({
      expiresAt: 2000,
      fetchImpl: async () =>
        json({
          now_playing: { song: { title: "Wrong Station" } },
          station: {
            listen_url: "https://azuracast.example/listen/other/radio.mp3",
            name: "Other Station",
          },
        }),
      sampledAt: 1000,
      streamUrl: "https://azuracast.example/listen/right/radio.mp3",
    });

    expect(result).toBeNull();
  });

  test("propagates AzuraCast aborts instead of treating them as unsupported", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    await expect(
      tryAzuraCastNowPlaying({
        expiresAt: 2000,
        fetchImpl: () => {
          throw abortError;
        },
        sampledAt: 1000,
        streamUrl: "https://azuracast.example/listen/right/radio.mp3",
      })
    ).rejects.toThrow("aborted");
  });

  test("propagates AzuraCast URL validation errors instead of falling back", async () => {
    await expect(
      tryAzuraCastNowPlaying({
        expiresAt: 2000,
        fetchImpl: () => {
          throw new RadioMetadataValidationError("internal-address");
        },
        sampledAt: 1000,
        streamUrl: "https://azuracast.example/listen/right/radio.mp3",
      })
    ).rejects.toBeInstanceOf(RadioMetadataValidationError);
  });

  test("normalizes SHOUTcast JSON stats responses", async () => {
    const calls: string[] = [];
    const result = await tryShoutcastStatus({
      expiresAt: 2000,
      fetchImpl: (url) => {
        calls.push(url);
        return Promise.resolve(
          json({
            bitrate: "128",
            servergenre: "Eclectic",
            servertitle: "SHOUTcast Station",
            songtitle: "Artist - Title",
          })
        );
      },
      sampledAt: 1000,
      streamUrl: "https://shoutcast.example/stream",
    });

    expect(calls).toEqual(["https://shoutcast.example/stats?sid=1&json=1"]);
    expect(result).toMatchObject({
      artist: "Artist",
      bitrate: 128,
      genre: "Eclectic",
      source: "shoutcast-status",
      stationName: "SHOUTcast Station",
      title: "Title",
    });
  });

  test("falls back to legacy SHOUTcast 7.html text responses", async () => {
    const calls: string[] = [];
    const result = await tryShoutcastStatus({
      expiresAt: 2000,
      fetchImpl: (url) => {
        calls.push(url);
        if (url.includes("/stats") || url.includes("/currentsong")) {
          return Promise.resolve(new Response("", { status: 404 }));
        }
        return Promise.resolve(new Response("1,1,1,128,1,Artist - Title"));
      },
      sampledAt: 1000,
      streamUrl: "https://shoutcast.example/stream",
    });

    expect(calls).toEqual([
      "https://shoutcast.example/stats?sid=1&json=1",
      "https://shoutcast.example/currentsong?sid=1",
      "https://shoutcast.example/7.html?sid=1",
    ]);
    expect(result).toMatchObject({
      artist: "Artist",
      source: "shoutcast-status",
      title: "Title",
    });
  });

  test("keeps comma-containing titles from legacy SHOUTcast 7.html responses", async () => {
    const result = await tryShoutcastStatus({
      expiresAt: 2000,
      fetchImpl: (url) => {
        if (url.includes("/stats") || url.includes("/currentsong")) {
          return Promise.resolve(new Response("", { status: 404 }));
        }
        return Promise.resolve(
          new Response("1,1,1,128,1,Artist - Title, Part Two")
        );
      },
      sampledAt: 1000,
      streamUrl: "https://shoutcast.example/stream",
    });

    expect(result).toMatchObject({
      artist: "Artist",
      title: "Title, Part Two",
    });
  });

  test("propagates SHOUTcast aborts instead of treating them as unsupported", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    await expect(
      tryShoutcastStatus({
        expiresAt: 2000,
        fetchImpl: () => {
          throw abortError;
        },
        sampledAt: 1000,
        streamUrl: "https://shoutcast.example/stream",
      })
    ).rejects.toThrow("aborted");
  });

  test("uses the NTS live API channel matching the stream path", async () => {
    const result = await tryNtsLiveApi({
      expiresAt: 2000,
      fetchImpl: async () =>
        json({
          results: [
            { channel_name: "1", now: { broadcast_title: "Channel One" } },
            {
              channel_name: "2",
              now: {
                broadcast_title: "MUTUALISM",
                embeds: {
                  details: {
                    genres: [{ value: "Experimental" }],
                  },
                },
                links: [
                  {
                    href: "https://www.nts.live/api/v2/shows/mutualism/episodes/mutualism-1st-january-2026",
                    rel: "details",
                  },
                ],
              },
            },
          ],
        }),
      sampledAt: 1000,
      streamUrl: "https://stream-relay-geo.ntslive.net/stream2",
    });

    expect(result?.source).toBe("nts-live-api");
    expect(result?.title).toBe("MUTUALISM");
    expect(result?.genre).toBe("Experimental");
    expect(result?.itemUrl).toBe(
      "https://www.nts.live/shows/mutualism/episodes/mutualism-1st-january-2026"
    );
    expect(result?.stationName).toBe("NTS Radio | Channel 2");
  });

  test("returns null for NTS network failures so ICY fallback can run", async () => {
    const result = await tryNtsLiveApi({
      expiresAt: 2000,
      fetchImpl: () => {
        throw new Error("network failed");
      },
      sampledAt: 1000,
      streamUrl: "https://stream-relay-geo.ntslive.net/stream",
    });

    expect(result).toBeNull();
  });

  test("normalizes the current HKCR schedule entry", async () => {
    const result = await tryHkcrSchedule({
      expiresAt: Date.parse("2026-09-03T03:01:00Z"),
      fetchImpl: async () =>
        json([
          {
            date: "2026-09-03",
            endTime: "11:00",
            resident: { name: "Earlier Resident", slug: "earlier" },
            startTime: "10:00",
            title: "Earlier Show",
          },
          {
            date: "2026-09-03",
            description: "Current show description",
            endTime: "12:00",
            resident: { name: "Current Resident", slug: "current-resident" },
            startTime: "11:00",
            thumbnail: { url: "https://cdn.hkcr.live/current.jpg" },
            title: "Current Show",
          },
        ]),
      sampledAt: Date.parse("2026-09-03T03:00:00Z"),
      streamUrl: "https://stream-test.hkcr.live/hls/main.m3u8",
    });

    expect(result).toMatchObject({
      artist: "Current Resident",
      artworkUrl: "https://cdn.hkcr.live/current.jpg",
      itemUrl: "https://hkcr.live/residents/current-resident",
      source: "hkcr-schedule",
      stationDescription: "Current show description",
      stationName: "HKCR",
      title: "Current Show",
    });
  });

  test.each([
    { artist: null, title: "Morning Show - Replay" },
    { artist: "Resident - Collective", title: "Morning Show" },
    { artist: "Resident - Collective", title: "Morning Show - Replay" },
    { artist: "Morning Show - Replay", title: "Morning Show - Replay" },
  ])("preserves structured HKCR names: %j", async ({ artist, title }) => {
    const result = await tryHkcrSchedule({
      expiresAt: Date.parse("2026-09-03T04:00:00Z"),
      fetchImpl: async () =>
        json([
          {
            date: "2026-09-03",
            endTime: "12:00",
            resident: artist ? { name: artist } : null,
            startTime: "11:00",
            title,
          },
        ]),
      sampledAt: Date.parse("2026-09-03T03:30:00Z"),
      streamUrl: "https://stream-test.hkcr.live/hls/main.m3u8",
    });

    expect(result).toMatchObject({ artist, title });
  });

  test("cleans structured HKCR names without splitting separators", async () => {
    const result = await tryHkcrSchedule({
      expiresAt: Date.parse("2026-09-03T04:00:00Z"),
      fetchImpl: async () =>
        json([
          {
            date: "2026-09-03",
            endTime: "12:00",
            resident: { name: "A &amp; B\0 - Collective" },
            startTime: "11:00",
            title: "Rock &amp; Roll\0 - Replay",
          },
        ]),
      sampledAt: Date.parse("2026-09-03T03:30:00Z"),
      streamUrl: "https://stream-test.hkcr.live/hls/main.m3u8",
    });

    expect(result).toMatchObject({
      artist: "A & B - Collective",
      rawTitle: "A & B - Collective - Rock & Roll - Replay",
      title: "Rock & Roll - Replay",
    });
  });

  test("rejects an HKCR entry with an invalid calendar date", async () => {
    const result = await tryHkcrSchedule({
      expiresAt: Date.parse("2026-03-03T04:00:00Z"),
      fetchImpl: async () =>
        json([
          {
            date: "2026-02-31",
            endTime: "12:00",
            resident: { name: "Resident", slug: "resident" },
            startTime: "11:00",
            title: "Invalid Date Show",
          },
        ]),
      sampledAt: Date.parse("2026-03-03T03:30:00Z"),
      streamUrl: "https://stream-test.hkcr.live/hls/main.m3u8",
    });

    expect(result).toBeNull();
  });

  test("prefers an HKCR show page over the resident fallback", async () => {
    const calls: string[] = [];
    const result = await tryHkcrSchedule({
      expiresAt: Date.parse("2026-09-03T04:00:00Z"),
      fetchImpl: (url) => {
        calls.push(url);
        return Promise.resolve(
          url === "https://cms.hkcr.live/shows/show-id"
            ? json({ _id: "show-id", slug: "actual-show" })
            : json([
                {
                  date: "2026-09-03",
                  endTime: "12:00",
                  resident: { name: "Resident", slug: "resident" },
                  show: "show-id",
                  startTime: "11:00",
                  title: "Current Show",
                },
              ])
        );
      },
      sampledAt: Date.parse("2026-09-03T03:30:00Z"),
      streamUrl: "https://stream-test.hkcr.live/hls/main.m3u8",
    });

    expect(calls).toEqual([
      "https://cms.hkcr.live/schedule/range?startDate=2026-09-02&endDate=2026-09-04",
      "https://cms.hkcr.live/shows/show-id",
    ]);
    expect(result?.itemUrl).toBe("https://hkcr.live/shows/actual-show");
  });

  test("normalizes the current Resonance Extra episode", async () => {
    const result = await tryResonanceExtraApi({
      expiresAt: 2000,
      fetchImpl: async () =>
        json({
          now: {
            backgrounds: [
              {
                image:
                  "/system/files/072025/show/background/IMG_0892.jpeg?1753085930",
              },
            ],
            description: "Current show description",
            host: "",
            name: "Summer 2026 # Works for Radio",
            path: "/episodes/summer-2026-works-for-radio-2026-09-03",
            series_link: "/series/summer-2026",
            series_name: "Summer 2026",
          },
        }),
      sampledAt: 1000,
      streamUrl: "https://stream.resonance.fm/resonance-extra",
    });

    expect(result).toMatchObject({
      album: "Summer 2026",
      artist: null,
      artworkUrl:
        "https://x.resonance.fm/system/files/072025/show/background/IMG_0892.jpeg?1753085930",
      itemUrl:
        "https://extra.resonance.fm/episodes/summer-2026-works-for-radio-2026-09-03",
      rawTitle: "Summer 2026 # Works for Radio",
      source: "resonance-extra-api",
      stationDescription: "Current show description",
      stationName: "Resonance Extra",
      title: "Summer 2026 # Works for Radio",
    });
  });

  test("normalizes Radio Alhara's first-party now-playing response", async () => {
    const calls: string[] = [];
    const result = await tryRadioAlharaApi({
      expiresAt: 2000,
      fetchImpl: (url) => {
        calls.push(url);
        return Promise.resolve(
          json({
            airDate: "2026-09-03T18:00:00+03:00",
            artist: null,
            episodeId: "gt6S6s1e6KaWghmuA6DwBy",
            episodeTitle: 'DIMKAL pres. "UNCOMPROMISING EXPRESSIONS"',
            isRerun: false,
            mode: "live",
            originalAirDate: null,
            scheduledTitle: "Dimkal",
            title: "Dimkal",
          })
        );
      },
      sampledAt: 1000,
      streamUrl: "https://n03.radiojar.com/78cxy6wkxtzuv",
    });

    expect(calls).toEqual(["https://ch2.radioalhara.net/api/now-playing"]);
    expect(result).toMatchObject({
      album: "Dimkal",
      artist: null,
      artworkUrl: null,
      itemUrl: null,
      rawTitle: 'DIMKAL pres. "UNCOMPROMISING EXPRESSIONS"',
      source: "radio-alhara-api",
      stationDescription: null,
      stationName: "Radio Alhara",
      title: 'DIMKAL pres. "UNCOMPROMISING EXPRESSIONS"',
    });
  });

  test("propagates NTS aborts instead of treating them as unsupported", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    await expect(
      tryNtsLiveApi({
        expiresAt: 2000,
        fetchImpl: () => {
          throw abortError;
        },
        sampledAt: 1000,
        streamUrl: "https://stream-relay-geo.ntslive.net/stream",
      })
    ).rejects.toThrow("aborted");
  });

  test("normalizes Radio BlackOut listening endpoint", async () => {
    const result = await tryRadioBlackoutApi({
      expiresAt: 2000,
      fetchImpl: async () =>
        json({
          excerpt: "Current show",
          featured_media: "https://radioblackout.org/logo.png",
          link: "https://radioblackout.org/shows/b-rave-ragazze/",
          title: "B-Rave Ragazze",
        }),
      sampledAt: 1000,
      streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
    });

    expect(result?.source).toBe("radio-blackout-api");
    expect(result?.title).toBe("B-Rave Ragazze");
    expect(result?.artworkUrl).toBe("https://radioblackout.org/logo.png");
    expect(result?.itemUrl).toBe(
      "https://radioblackout.org/shows/b-rave-ragazze/"
    );
    expect(result?.stationName).toBe("Radio BlackOut");
  });

  test("returns null for Radio BlackOut network failures so ICY fallback can run", async () => {
    const result = await tryRadioBlackoutApi({
      expiresAt: 2000,
      fetchImpl: () => {
        throw new Error("network failed");
      },
      sampledAt: 1000,
      streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
    });

    expect(result).toBeNull();
  });

  test("propagates Radio BlackOut URL validation errors", async () => {
    await expect(
      tryRadioBlackoutApi({
        expiresAt: 2000,
        fetchImpl: () => {
          throw new RadioMetadataValidationError("internal-address");
        },
        sampledAt: 1000,
        streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
      })
    ).rejects.toBeInstanceOf(RadioMetadataValidationError);
  });
});
