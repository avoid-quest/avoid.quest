import { describe, expect, test } from "bun:test";
import { cacheMetadata, EPISODE_METADATA_TTL } from "./cache";
import { createMetadataCacheFixture } from "./cache-test-fixture";
import { tryLylApi } from "./lyl-provider";
import { RadioMetadataValidationError } from "./upstream-fetch";

const SAMPLED_AT = Date.parse("2026-09-03T16:45:00.000Z");

function json(data: unknown): Response {
  return Response.json(data);
}

function currentEntry(
  overrides: Partial<{
    artists: string;
    end: string;
    slug: string;
    start: string;
    title: string;
    type: "EPISODE" | "SHOW";
  }>
) {
  return {
    artists: "Host",
    end: "2026-09-03T17:30:00.000Z",
    slug: "current-entry",
    start: "2026-09-03T16:30:00.000Z",
    title: "Current Entry",
    type: "EPISODE" as const,
    ...overrides,
  };
}

function providerInput(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
) {
  return {
    expiresAt: SAMPLED_AT + 30_000,
    fetchImpl,
    sampledAt: SAMPLED_AT,
    streamUrl: "https://icecast.lyl.live/live",
  };
}

describe("LYL metadata provider", () => {
  test("expires selected metadata at the calendar boundary", async () => {
    const end = "2026-09-03T16:50:00.000Z";
    const result = await tryLylApi({
      ...providerInput((_url, init) => {
        const { query } = JSON.parse(String(init?.body));
        return Promise.resolve(
          json({
            data: query.includes("query NowPlaying")
              ? {
                  calendar: [currentEntry({ end })],
                  onair: {
                    hls: "https://radio.lyl.live/hls/live.m3u8",
                    title: "Host - Current Entry",
                  },
                }
              : { episodeBySlug: null },
          })
        );
      }),
      expiresAt: SAMPLED_AT + 15 * 60_000,
    });

    expect(result?.expiresAt).toBe(Date.parse(end));
  });

  test.each(["not-a-date", "2026-09-03T16:45:00.000Z"])(
    "rejects calendar entries with invalid or elapsed end %s",
    async (end) => {
      const result = await tryLylApi(
        providerInput(() =>
          Promise.resolve(
            json({
              data: {
                calendar: [currentEntry({ end })],
                onair: {
                  hls: "https://radio.lyl.live/hls/live.m3u8",
                  title: "Current Entry",
                },
              },
            })
          )
        )
      );

      expect(result).toBeNull();
    }
  );

  test("caches episode descriptions separately from the live calendar and playback URLs", async () => {
    const { cache, entries, put } = createMetadataCacheFixture();
    let time = SAMPLED_AT;
    let liveCalls = 0;
    let detailCalls = 0;
    const read = (slug: string) =>
      tryLylApi({
        ...providerInput((_url, init) => {
          const { query, variables } = JSON.parse(String(init?.body));
          if (query.includes("query NowPlaying")) {
            liveCalls += 1;
            return Promise.resolve(
              json({
                data: {
                  calendar: [currentEntry({ slug })],
                  onair: {
                    hls: "https://lyl.live/live.m3u8?token=live-secret",
                    title: "Current Entry",
                  },
                },
              })
            );
          }
          detailCalls += 1;
          return Promise.resolve(
            json({
              data: {
                episodeBySlug: {
                  description: "Details",
                  links: [
                    { url: "https://lyl.live/audio?token=episode-secret" },
                  ],
                  slug: variables.slug,
                  title: "Current Entry",
                },
              },
            })
          );
        }),
        cache,
        expiresAt: time + 60_000,
        now: () => time,
        sampledAt: time,
      });
    expect(await read("first")).toMatchObject({
      stationDescription: "Details",
    });
    time += 60_000;
    expect(await read("first")).toMatchObject({
      sampledAt: time,
      stationDescription: "Details",
    });
    expect(liveCalls).toBe(2);
    expect(detailCalls).toBe(1);
    await read("second");
    expect(detailCalls).toBe(2);
    expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 21_600 });
    expect([...entries.values()].join()).not.toContain("token=");
  });

  test.each(["EPISODE", "SHOW"] as const)(
    "retries mismatched %s details despite an old cache entry, then reuses matching details",
    async (type) => {
      const { cache, put } = createMetadataCacheFixture();
      await cacheMetadata({
        cache,
        key: ["lyl", type.toLowerCase(), "current-entry"],
        now: () => SAMPLED_AT,
        retrieve: () =>
          Promise.resolve({
            description: "Old mismatched details",
            slug: "current-entry",
            title: "Old Title",
          }),
        ttl: EPISODE_METADATA_TTL,
      });
      put.mockClear();
      let liveCalls = 0;
      let detailCalls = 0;
      const read = () =>
        tryLylApi({
          ...providerInput((_url, init) => {
            const { query } = JSON.parse(String(init?.body));
            if (query.includes("query NowPlaying")) {
              liveCalls += 1;
              return Promise.resolve(
                json({
                  data: {
                    calendar: [currentEntry({ type })],
                    onair: {
                      hls: "https://lyl.live/live.m3u8?token=live-secret",
                      title: "Current Entry",
                    },
                  },
                })
              );
            }
            detailCalls += 1;
            return Promise.resolve(
              json({
                data: {
                  [type === "EPISODE" ? "episodeBySlug" : "showBySlug"]: {
                    description: "Recovered details",
                    image: { url: "https://static.lyl.live/current.png" },
                    slug: "current-entry",
                    title: detailCalls === 1 ? "Wrong Title" : "Current Entry",
                  },
                },
              })
            );
          }),
          cache,
          now: () => SAMPLED_AT,
        });

      expect(await read()).toMatchObject({
        artworkUrl: null,
        stationDescription: null,
        title: "Current Entry",
      });
      expect(detailCalls).toBe(1);
      expect(put).not.toHaveBeenCalled();
      expect(await read()).toMatchObject({
        artworkUrl: "https://static.lyl.live/current.png",
        stationDescription: "Recovered details",
        title: "Current Entry",
      });
      expect(await read()).toMatchObject({
        artworkUrl: "https://static.lyl.live/current.png",
        stationDescription: "Recovered details",
        title: "Current Entry",
      });
      expect(liveCalls).toBe(3);
      expect(detailCalls).toBe(2);
      expect(put).toHaveBeenCalledTimes(1);
    }
  );

  test.each(["EPISODE", "SHOW"] as const)(
    "isolates %s details when the selected title changes for the same slug",
    async (type) => {
      const { cache } = createMetadataCacheFixture();
      let detailCalls = 0;
      const read = (title: string) =>
        tryLylApi({
          ...providerInput((_url, init) => {
            const { query } = JSON.parse(String(init?.body));
            if (query.includes("query NowPlaying")) {
              return Promise.resolve(
                json({
                  data: {
                    calendar: [currentEntry({ title, type })],
                    onair: {
                      hls: "https://lyl.live/live.m3u8",
                      title,
                    },
                  },
                })
              );
            }
            detailCalls += 1;
            return Promise.resolve(
              json({
                data: {
                  [type === "EPISODE" ? "episodeBySlug" : "showBySlug"]: {
                    description: `Details for ${title}`,
                    slug: "current-entry",
                    title,
                  },
                },
              })
            );
          }),
          cache,
          now: () => SAMPLED_AT,
        });

      expect(await read("Original Title")).toMatchObject({
        stationDescription: "Details for Original Title",
        title: "Original Title",
      });
      expect(await read("Corrected Title")).toMatchObject({
        stationDescription: "Details for Corrected Title",
        title: "Corrected Title",
      });
      expect(await read(" CORRECTED   TITLE ")).toMatchObject({
        stationDescription: "Details for Corrected Title",
        title: "CORRECTED   TITLE",
      });
      expect(detailCalls).toBe(2);
    }
  );

  test("propagates primary calendar aborts", async () => {
    const error = new DOMException("aborted", "AbortError");
    await expect(
      tryLylApi(
        providerInput(() => {
          throw error;
        })
      )
    ).rejects.toBe(error);
  });

  test.each(["EPISODE", "SHOW"] as const)(
    "propagates URL validation failures from optional %s details",
    async (type) => {
      const error = new RadioMetadataValidationError("internal-address");
      let calls = 0;
      await expect(
        tryLylApi(
          providerInput(() => {
            calls += 1;
            if (calls === 2) {
              throw error;
            }
            return Promise.resolve(
              json({
                data: {
                  calendar: [currentEntry({ type })],
                  onair: {
                    hls: "https://radio.lyl.live/hls/live.m3u8",
                    title: "Host - Current Entry",
                  },
                },
              })
            );
          })
        )
      ).rejects.toBe(error);
      expect(calls).toBe(2);
    }
  );

  test("matches the on-air title and enriches the selected show", async () => {
    const calls: RequestInit[] = [];
    const result = await tryLylApi(
      providerInput((_url, init) => {
        calls.push(init ?? {});
        if (calls.length === 2) {
          return Promise.resolve(
            json({
              data: {
                showBySlug: {
                  artists: "Vannye & Broko",
                  description: "Atmospheric selections from Lyon.",
                  image: {
                    url: "https://static.lyl.live/uploads/echo-pulse.png",
                  },
                  slug: "echo-pulse",
                  styles: [{ name: "Ambient" }, { name: "Breaks" }],
                  title: "Echo Pulse",
                },
              },
            })
          );
        }
        return Promise.resolve(
          json({
            data: {
              calendar: [
                currentEntry({
                  slug: "wrong-episode",
                  title: "Hall Dancers",
                }),
                currentEntry({
                  artists: "Vannye & Broko",
                  slug: "echo-pulse",
                  title: "Echo Pulse",
                  type: "SHOW",
                }),
              ],
              onair: {
                hls: "https://radio.lyl.live/hls/live.m3u8",
                title: "Broko Vannye - Echo Pulse",
              },
            },
          })
        );
      })
    );

    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1]?.body))).toMatchObject({
      variables: { slug: "echo-pulse" },
    });
    expect(result).toMatchObject({
      artist: "Vannye & Broko",
      artworkUrl: "https://static.lyl.live/uploads/echo-pulse.png",
      genre: "Ambient, Breaks",
      itemUrl: "https://lyl.live/show/echo-pulse",
      source: "lyl-api",
      stationDescription: "Atmospheric selections from Lyon.",
      stationName: "LYL Radio",
      title: "Echo Pulse",
    });
  });

  test("ignores show details that do not match the selected schedule entry", async () => {
    let calls = 0;
    const result = await tryLylApi(
      providerInput(() => {
        calls += 1;
        if (calls === 2) {
          return Promise.resolve(
            json({
              data: {
                showBySlug: {
                  artists: "Wrong Host",
                  description: "Wrong show.",
                  image: { url: "https://static.lyl.live/uploads/wrong.png" },
                  slug: "echo-pulse",
                  styles: [{ name: "Wrong Genre" }],
                  title: "A Different Show",
                },
              },
            })
          );
        }
        return Promise.resolve(
          json({
            data: {
              calendar: [
                currentEntry({
                  artists: "Vannye & Broko",
                  slug: "echo-pulse",
                  title: "Echo Pulse",
                  type: "SHOW",
                }),
              ],
              onair: {
                hls: "https://radio.lyl.live/hls/live.m3u8",
                title: "Broko Vannye - Echo Pulse",
              },
            },
          })
        );
      })
    );

    expect(calls).toBe(2);
    expect(result).toMatchObject({
      artist: "Vannye & Broko",
      artworkUrl: null,
      genre: null,
      itemUrl: "https://lyl.live/show/echo-pulse",
      stationDescription: null,
      title: "Echo Pulse",
    });
  });

  test("enriches a uniquely selected episode after schedule matching", async () => {
    const calls: { init?: RequestInit; url: string }[] = [];
    const result = await tryLylApi(
      providerInput((url, init) => {
        calls.push({ init, url });
        if (calls.length === 1) {
          return Promise.resolve(
            json({
              data: {
                calendar: [
                  currentEntry({
                    artists: "Other Host",
                    slug: "overlap",
                    title: "Other Show",
                    type: "SHOW",
                  }),
                  currentEntry({
                    artists: "Hermeneia",
                    slug: "tread-on-a-snake-2",
                    title: "Tread on a Snake",
                  }),
                ],
                onair: {
                  hls: "https://radio.lyl.live/hls/live.m3u8",
                  title: "Hermeneia - Tread on a Snake",
                },
              },
            })
          );
        }
        return Promise.resolve(
          json({
            data: {
              episodeBySlug: {
                description: "Low-end soundsystem music.",
                image: { url: "https://static.lyl.live/uploads/snake.jpeg" },
                links: [],
                show: {
                  slug: "tread-on-a-snake",
                  title: "Tread on a Snake",
                },
                slug: "tread-on-a-snake-2",
                styles: [{ name: "Reggae" }, { name: "Dub" }],
                title: "Tread on a Snake",
              },
            },
          })
        );
      })
    );

    expect(calls).toHaveLength(2);
    expect(
      calls.every((call) => call.url === "https://strapi.lyl.live/graphql")
    ).toBeTrue();
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      variables: { slug: "tread-on-a-snake-2" },
    });
    expect(result).toMatchObject({
      artist: "Hermeneia",
      artworkUrl: "https://static.lyl.live/uploads/snake.jpeg",
      genre: "Reggae, Dub",
      itemUrl: "https://lyl.live/episode/tread-on-a-snake-2",
      source: "lyl-api",
      stationDescription: "Low-end soundsystem music.",
      title: "Tread on a Snake",
    });
  });

  test("uses the only current episode when the positive on-air title is generic", async () => {
    const result = await tryLylApi({
      ...providerInput(() =>
        Promise.resolve(
          json({
            data: {
              calendar: [
                currentEntry({
                  slug: "one-off",
                  title: "One Off",
                  type: "SHOW",
                }),
                currentEntry({
                  end: "2026-09-03T16:50:00.000Z",
                  slug: "episode",
                  title: "Scheduled Episode",
                }),
              ],
              onair: {
                hls: "https://radio.lyl.live/hls/live.m3u8",
                title: "LYL Radio - Live",
              },
            },
          })
        )
      ),
      expiresAt: SAMPLED_AT + 15 * 60_000,
    });

    expect(result).toMatchObject({
      expiresAt: Date.parse("2026-09-03T16:50:00.000Z"),
      itemUrl: "https://lyl.live/episode/episode",
      title: "Scheduled Episode",
    });
  });

  test("rejects a unique scheduled episode when on-air names another programme", async () => {
    let calls = 0;
    const result = await tryLylApi(
      providerInput(() => {
        calls += 1;
        return Promise.resolve(
          json({
            data: {
              calendar: [currentEntry({})],
              onair: {
                hls: "https://radio.lyl.live/hls/live.m3u8",
                title: "Other Host - Different Programme",
              },
            },
          })
        );
      })
    );

    expect(result).toBeNull();
    expect(calls).toBe(1);
  });

  test("returns null when overlapping episodes cannot be disambiguated", async () => {
    let calls = 0;
    const result = await tryLylApi(
      providerInput(() => {
        calls += 1;
        return Promise.resolve(
          json({
            data: {
              calendar: [
                currentEntry({ slug: "episode-a", title: "Episode A" }),
                currentEntry({ slug: "episode-b", title: "Episode B" }),
              ],
              onair: {
                hls: "https://radio.lyl.live/hls/live.m3u8",
                title: "LYL Radio - Live",
              },
            },
          })
        );
      })
    );

    expect(calls).toBe(1);
    expect(result).toBeNull();
  });

  test("returns null without a positive on-air signal", async () => {
    const result = await tryLylApi(
      providerInput(() =>
        Promise.resolve(
          json({
            data: {
              calendar: [currentEntry({})],
              onair: {
                hls: "https://radio.lyl.live/hls/live.m3u8",
                title: null,
              },
            },
          })
        )
      )
    );

    expect(result).toBeNull();
  });
});
