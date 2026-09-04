import { expect, test } from "bun:test";
import {
  tryAirtimeLiveInfo,
  tryHkcrSchedule,
  tryRadioBlackoutApi,
} from "./external-providers";

const json = (data: unknown) => Promise.resolve(Response.json(data));

const sampledAt = Date.parse("2026-09-04T13:30:00Z");
const input = { expiresAt: sampledAt + 60_000, sampledAt };
const cashmereStream = "https://cashmereradio.out.airtime.pro/cashmereradio_b";
const iprStream =
  "https://stream-relay-geo.internetpublicradio.live/stream/main";
const hkcrStream = "https://stream-test.hkcr.live/hls/main.m3u8";

test("matches a Cashmere archive title whose filename uses underscores for spaces", async () => {
  const result = await tryAirtimeLiveInfo({
    ...input,
    fetchImpl: (url) => {
      if (url.endsWith("/graphql")) {
        return json({
          data: {
            episodes: {
              nodes: [
                {
                  databaseId: 33_444,
                  featuredImage: {
                    node: {
                      sourceUrl: "https://media.cashmereradio.com/islands.jpg",
                    },
                  },
                  title: "Self-Hypnosis #7_Islands",
                  uri: "/episode/self-hypnosis-7_islands/",
                },
              ],
            },
          },
        });
      }
      if (url.includes("/wp-json/wp/v2/episode/33444?")) {
        return json({
          content: { rendered: "<p>Islands description.</p>" },
          id: 33_444,
          link: "https://backstage.cashmereradio.com/episode/self-hypnosis-7_islands/",
          slug: "self-hypnosis-7_islands",
        });
      }
      if (url.includes("/wp-json/")) {
        return json([]);
      }
      return json({
        tracks: { current: { name: "SELF-HYPNOSIS #7 ISLANDS" } },
      });
    },
    streamUrl: cashmereStream,
  });
  expect(result).toMatchObject({
    artworkUrl: "https://media.cashmereradio.com/islands.jpg",
    itemUrl: "https://cashmereradio.com/episode/self-hypnosis-7_islands/",
    stationDescription: "Islands description.",
  });
});

test("enriches a Cashmere filename from its exact show when the recording has no episode", async () => {
  const result = await tryAirtimeLiveInfo({
    ...input,
    fetchImpl: (url) => {
      if (url.includes("airtime.pro/api/")) {
        return json({
          tracks: {
            current: {
              metadata: {
                track_title: "Circles in Space by Radiocircolo 13.05.2026.mp3",
              },
            },
          },
        });
      }
      if (url.endsWith("/graphql")) {
        return json({ data: { episodes: { nodes: [] } } });
      }
      expect(new URL(url).searchParams.get("search")).toBe(
        "Circles in Space by Radiocircolo"
      );
      return json([
        {
          _embedded: {
            "wp:featuredmedia": [
              { source_url: "https://media.cashmereradio.com/circles.jpg" },
            ],
          },
          content: { rendered: "<p>Travel through sound &amp; space.</p>" },
          link: "https://backstage.cashmereradio.com/shows/circles-in-space-by-radiocircolo/",
          slug: "circles-in-space-by-radiocircolo",
          title: { rendered: "Circles in Space by Radiocircolo" },
        },
      ]);
    },
    streamUrl: cashmereStream,
  });
  expect(result).toMatchObject({
    artworkUrl: "https://media.cashmereradio.com/circles.jpg",
    itemUrl:
      "https://cashmereradio.com/shows/circles-in-space-by-radiocircolo/",
    stationDescription: "Travel through sound & space.",
  });
});

test("loads the description of the exact dated IPR episode", async () => {
  const result = await tryAirtimeLiveInfo(
    {
      ...input,
      fetchImpl: (url) => {
        if (url.includes("stream-relay-geo")) {
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
          return json([
            {
              _id: "episode-id",
              _type: "episode",
              date: "2022-09-20",
              image: { asset: { _ref: "image-abcdef-2000x1125-jpg" } },
              label: "Idle Not Idle",
              resident: { slug: { current: "idle-not-idle" } },
              slug: { current: "idle-not-idle-20th-september-2022" },
            },
          ]);
        }
        expect(new URL(url).searchParams.get("$id")).toBe('"episode-id"');
        return json({
          result: {
            _id: "episode-id",
            _type: "episode",
            description:
              "Randomness selections compiled by music collector from Porto, Diogo Ferreira.",
            slug: { current: "idle-not-idle-20th-september-2022" },
            title: "Idle Not Idle",
          },
        });
      },
      streamUrl: iprStream,
    },
    ["https://stream-relay-geo.internetpublicradio.live/api-filtered.php"]
  );
  expect(result).toMatchObject({
    artworkUrl:
      "https://cdn.sanity.io/images/7rbo2iih/production/abcdef-2000x1125.jpg",
    itemUrl:
      "https://www.internetpublicradio.live/idle-not-idle/episodes/idle-not-idle-20th-september-2022",
    stationDescription:
      "Randomness selections compiled by music collector from Porto, Diogo Ferreira.",
  });
});

test("enriches HKCR archive playback from its current replay slot and show", async () => {
  const result = await tryHkcrSchedule({
    ...input,
    fetchImpl: (url) => {
      if (url.includes("/schedule/")) {
        return json([]);
      }
      if (url.includes("/replay-slots/")) {
        return json({
          slots: [
            {
              end: "2026-09-04T14:00:00Z",
              replay: { show: "show-id", title: "417hz w/ Ana Roman" },
              show: "show-id",
              start: "2026-09-04T13:00:00Z",
            },
          ],
        });
      }
      expect(url).toBe("https://cms.hkcr.live/shows/show-id");
      return json({
        _id: "show-id",
        content:
          "Ana Roman blends far, near-future sound experiments<br>with time-bending rhythms.",
        medium: { url: "https://cdn.hkcr.live/ana.jpg" },
        resident: { name: "Ana Roman" },
        slug: "417hz-w-ana-roman-24-03-2023",
        tags: [{ name: "Experimental" }],
        title: "417hz w/ Ana Roman",
      });
    },
    streamUrl: hkcrStream,
  });
  expect(result).toMatchObject({
    artist: "Ana Roman",
    artworkUrl: "https://cdn.hkcr.live/ana.jpg",
    genre: "Experimental",
    itemUrl: "https://hkcr.live/shows/417hz-w-ana-roman-24-03-2023",
    stationDescription:
      "Ana Roman blends far, near-future sound experiments with time-bending rhythms.",
    title: "417hz w/ Ana Roman",
  });
});

test("retrieves the full BlackOut show description and decodes its HTML", async () => {
  const result = await tryRadioBlackoutApi({
    ...input,
    fetchImpl: (url) => {
      if (url.endsWith("/api/listening")) {
        return json({
          excerpt: "Harraga &#8211; truncated [&hellip;]",
          featured_media: "https://radioblackout.org/harraga.jpg",
          link: "https://radioblackout.org/shows/harraga/",
          title: "HARRAGA",
        });
      }
      expect(new URL(url).searchParams.get("slug")).toBe("harraga");
      return json([
        {
          content:
            "<p>Harraga &#8211; &#8220;coloro che bruciano&#8221;.</p><p>Full programme description.</p>",
          link: "https://radioblackout.org/shows/harraga/",
          slug: "harraga",
          tags: ["frontiere", "lotte"],
          title: "HARRAGA",
        },
      ]);
    },
    streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
  });
  expect(result).toMatchObject({
    genre: "frontiere, lotte",
    stationDescription:
      "Harraga – “coloro che bruciano”. Full programme description.",
  });
});

test.each(["different title", "duplicate", "foreign link"])(
  "rejects a Cashmere show fallback with %s",
  async (failure) => {
    const show = {
      _embedded: {
        "wp:featuredmedia": [
          { source_url: "https://media.cashmereradio.com/wrong.jpg" },
        ],
      },
      content: { rendered: "Wrong description" },
      link:
        failure === "foreign link"
          ? "https://unrelated.example/shows/circles-in-space-by-radiocircolo/"
          : "https://backstage.cashmereradio.com/shows/circles-in-space-by-radiocircolo/",
      slug: "circles-in-space-by-radiocircolo",
      title: {
        rendered:
          failure === "different title"
            ? "Other Show"
            : "Circles in Space by Radiocircolo",
      },
    };
    const result = await tryAirtimeLiveInfo({
      ...input,
      fetchImpl: (url) => {
        if (url.includes("airtime.pro/api/")) {
          return json({
            current: {
              metadata: {
                track_title: "Circles in Space by Radiocircolo 13.05.2026.mp3",
              },
            },
          });
        }
        if (url.endsWith("/graphql")) {
          return json({ data: { episodes: { nodes: [] } } });
        }
        return json(failure === "duplicate" ? [show, show] : [show]);
      },
      streamUrl: cashmereStream,
    });
    expect(result).toMatchObject({
      artworkUrl: null,
      itemUrl: null,
      stationDescription: null,
    });
  }
);

test.each([
  "wrong id",
  "wrong slug",
  "wrong type",
  "wrong title",
  "unavailable",
])(
  "keeps IPR artwork and its episode link after %s details",
  async (failure) => {
    const result = await tryAirtimeLiveInfo(
      {
        ...input,
        fetchImpl: (url) => {
          if (url.includes("stream-relay-geo")) {
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
            return json([
              {
                _id: "episode-id",
                _type: "episode",
                date: "2022-09-20",
                image: { asset: { _ref: "image-abcdef-2000x1125-jpg" } },
                label: "Idle Not Idle",
                resident: { slug: { current: "idle-not-idle" } },
                slug: { current: "exact-episode" },
              },
            ]);
          }
          if (failure === "unavailable") {
            return Promise.reject(new Error("Upstream unavailable"));
          }
          return json({
            result: {
              _id: failure === "wrong id" ? "another-id" : "episode-id",
              _type: failure === "wrong type" ? "resident" : "episode",
              description: "Untrusted description",
              slug: {
                current:
                  failure === "wrong slug"
                    ? "another-episode"
                    : "exact-episode",
              },
              title:
                failure === "wrong title" ? "Other Title" : "Idle Not Idle",
            },
          });
        },
        streamUrl: iprStream,
      },
      ["https://stream-relay-geo.internetpublicradio.live/api-filtered.php"]
    );
    expect(result).toMatchObject({
      artworkUrl:
        "https://cdn.sanity.io/images/7rbo2iih/production/abcdef-2000x1125.jpg",
      itemUrl:
        "https://www.internetpublicradio.live/idle-not-idle/episodes/exact-episode",
      stationDescription: null,
    });
  }
);

test("uses an HKCR replacement replay instead of a cancelled scheduled programme", async () => {
  const result = await tryHkcrSchedule({
    ...input,
    fetchImpl: (url) => {
      if (url.includes("/schedule/")) {
        return json([
          {
            date: "2026-09-04",
            endTime: "22:00",
            startTime: "21:00",
            status: "cancelled_substituted",
            title: "Cancelled Show",
          },
        ]);
      }
      if (url.includes("/replay-slots/")) {
        return json({
          slots: [
            {
              end: "2026-09-04T14:00:00Z",
              replay: { title: "Replacement Replay" },
              start: "2026-09-04T13:00:00Z",
            },
          ],
        });
      }
      throw new Error("Unexpected detail lookup");
    },
    streamUrl: hkcrStream,
  });
  expect(result).toMatchObject({
    artworkUrl: null,
    itemUrl: null,
    title: "Replacement Replay",
  });
});

test.each(["ended", "overlapping", "unavailable"])(
  "does not choose an HKCR replay when slots are %s",
  async (failure) => {
    const current = {
      end: "2026-09-04T14:00:00Z",
      replay: { title: "Replay" },
      start: "2026-09-04T13:00:00Z",
    };
    const result = await tryHkcrSchedule({
      ...input,
      fetchImpl: (url) => {
        if (url.includes("/schedule/")) {
          return json([]);
        }
        if (failure === "unavailable") {
          return Promise.reject(new Error("Upstream unavailable"));
        }
        return json({
          slots:
            failure === "overlapping"
              ? [current, current]
              : [{ ...current, end: "2026-09-04T13:30:00Z" }],
        });
      },
      streamUrl: hkcrStream,
    });
    expect(result).toBeNull();
  }
);

test.each(["mismatch", "unavailable"])(
  "keeps HKCR replay identity after %s show details",
  async (failure) => {
    const result = await tryHkcrSchedule({
      ...input,
      fetchImpl: (url) => {
        if (url.includes("/schedule/")) {
          return json([]);
        }
        if (url.includes("/replay-slots/")) {
          return json({
            slots: [
              {
                end: "2026-09-04T14:00:00Z",
                replay: { title: "Current Replay" },
                show: "show-id",
                start: "2026-09-04T13:00:00Z",
              },
            ],
          });
        }
        if (failure === "unavailable") {
          return Promise.reject(new Error("Upstream unavailable"));
        }
        return json({
          _id: "other-show",
          content: "Wrong content",
          picture: { url: "https://cdn.hkcr.live/wrong.jpg" },
          slug: "other-show",
        });
      },
      streamUrl: hkcrStream,
    });
    expect(result).toMatchObject({
      artworkUrl: null,
      itemUrl: null,
      stationDescription: null,
      title: "Current Replay",
    });
  }
);

test.each(["mismatch", "unavailable"])(
  "keeps a decoded BlackOut excerpt after %s show details",
  async (failure) => {
    const result = await tryRadioBlackoutApi({
      ...input,
      fetchImpl: (url) => {
        if (url.endsWith("/api/listening")) {
          return json({
            excerpt:
              "Harraga &#8211; &ldquo;coloro che bruciano&rdquo;&nbsp;[&hellip;]",
            link: "https://radioblackout.org/shows/harraga/",
            title: "HARRAGA",
          });
        }
        if (failure === "unavailable") {
          return Promise.reject(new Error("Upstream unavailable"));
        }
        return json([
          {
            content: "Wrong content",
            link: "https://radioblackout.org/shows/another-show/",
            slug: "another-show",
            title: "Another Show",
          },
        ]);
      },
      streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
    });
    expect(result).toMatchObject({
      genre: null,
      stationDescription: "Harraga – “coloro che bruciano” […]",
      title: "HARRAGA",
    });
  }
);

test("fills HKCR schedule image placeholders and replaces its excerpt with verified full show content", async () => {
  const result = await tryHkcrSchedule({
    ...input,
    fetchImpl: (url) => {
      if (url.includes("/schedule/")) {
        return json([
          {
            date: "2026-09-04",
            description: "Short excerpt",
            endTime: "22:00",
            picture: { url: "not-a-url" },
            show: "show-id",
            startTime: "21:00",
            thumbnail: { url: "" },
            title: "Current Show",
          },
        ]);
      }
      return json({
        _id: "show-id",
        content: "<p>Full programme description.</p>",
        medium: { url: "https://cdn.hkcr.live/current.jpg" },
        slug: "current-show",
        title: "Current Show",
      });
    },
    streamUrl: hkcrStream,
  });
  expect(result).toMatchObject({
    artworkUrl: "https://cdn.hkcr.live/current.jpg",
    stationDescription: "Full programme description.",
    title: "Current Show",
  });
});

test("uses the verified HKCR show title when the replay slot only supplies its ID", async () => {
  const result = await tryHkcrSchedule({
    ...input,
    fetchImpl: (url) => {
      if (url.includes("/schedule/")) {
        return json([]);
      }
      if (url.includes("/replay-slots/")) {
        return json({
          slots: [
            {
              end: "2026-09-04T14:00:00Z",
              show: "show-id",
              start: "2026-09-04T13:00:00Z",
            },
          ],
        });
      }
      return json({
        _id: "show-id",
        slug: "current-replay",
        title: "Current Replay",
      });
    },
    streamUrl: hkcrStream,
  });
  expect(result).toMatchObject({
    itemUrl: "https://hkcr.live/shows/current-replay",
    title: "Current Replay",
  });
});
