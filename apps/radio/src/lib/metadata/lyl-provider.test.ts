import { describe, expect, test } from "bun:test";
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
    const result = await tryLylApi(
      providerInput(() =>
        Promise.resolve(
          json({
            data: {
              calendar: [
                currentEntry({
                  slug: "one-off",
                  title: "One Off",
                  type: "SHOW",
                }),
                currentEntry({ slug: "episode", title: "Scheduled Episode" }),
              ],
              onair: {
                hls: "https://radio.lyl.live/hls/live.m3u8",
                title: "LYL Radio - Live",
              },
            },
          })
        )
      )
    );

    expect(result).toMatchObject({
      itemUrl: "https://lyl.live/episode/episode",
      title: "Scheduled Episode",
    });
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
