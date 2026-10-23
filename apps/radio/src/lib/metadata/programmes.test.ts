import { expect, test } from "bun:test";
import {
  type ExternalMetadataProviderInput,
  tryAirtimeLiveInfo,
  tryHkcrSchedule,
  tryNtsLiveApi,
  tryRadioAlharaApi,
  tryResonanceExtraApi,
} from "./external-providers";
import { tryLylApi } from "./lyl-provider";
import {
  normalizeProgrammes,
  programmeTimestamp,
  type RadioProgramme,
} from "./programmes";

const now = Date.parse("2026-10-23T12:30:00Z");
function fixture(
  fetchImpl: ExternalMetadataProviderInput["fetchImpl"],
  sampledAt = now
) {
  const entries: RadioProgramme[] = [];
  return {
    input: {
      expiresAt: sampledAt + 60_000,
      fetchImpl,
      onProgrammes: (items: RadioProgramme[]) => entries.push(...items),
      sampledAt,
      streamUrl: "https://radio.example/stream",
    },
    programmes: () => normalizeProgrammes(entries, sampledAt),
  };
}

test("NTS publishes current and next real slots without changing freshness timestamps", async () => {
  const { input, programmes } = fixture(() =>
    Promise.resolve(
      Response.json({
        results: [
          {
            channel_name: "1",
            now: {
              broadcast_title: "Current show",
              start_timestamp: "2026-10-23T12:00:00Z",
              end_timestamp: "2026-10-23T13:00:00Z",
              embeds: {
                details: {
                  description: "Programme description",
                  genres: [{ value: "Jazz" }, { value: "Soul" }],
                  media: { picture_medium: "https://example.com/art.jpg" },
                },
              },
            },
            next: {
              broadcast_title: "Next show",
              start_timestamp: "2026-10-23T13:00:00Z",
              end_timestamp: "2026-10-23T14:00:00Z",
            },
            next2: { broadcast_title: "Unknown times" },
          },
        ],
      })
    )
  );
  const result = await tryNtsLiveApi(input, "1");
  expect(result).toMatchObject({
    title: "Current show",
    sampledAt: now,
    expiresAt: now + 60_000,
  });
  expect(programmes()).toHaveLength(2);
  expect(programmes()[0]).toEqual({
    title: "Current show",
    start: now - 30 * 60_000,
    end: now + 30 * 60_000,
    description: "Programme description",
    categories: ["Jazz", "Soul"],
    artworkUrl: "https://example.com/art.jpg",
  });
});

test("NTS upcoming schedules survive a missing now-playing slot", async () => {
  const { input, programmes } = fixture(() =>
    Promise.resolve(
      Response.json({
        results: [
          null,
          {
            channel_name: "1",
            next: {
              broadcast_title: "Future",
              start_timestamp: "2026-10-23T13:00:00Z",
              end_timestamp: "2026-10-23T14:00:00Z",
            },
          },
        ],
      })
    )
  );
  expect(await tryNtsLiveApi(input, "1")).toBeNull();
  expect(programmes().map((entry) => entry.title)).toEqual(["Future"]);
});

test("Airtime exports show blocks in the station timezone, never track boundaries", async () => {
  const { input, programmes } = fixture(() =>
    Promise.resolve(
      Response.json({
        station: { timezone: "Europe/Berlin" },
        tracks: {
          current: {
            name: "A song",
            starts: "2026-10-23 14:29:00",
            ends: "2026-10-23 14:33:00",
          },
        },
        shows: {
          current: {
            name: "The show",
            starts: "2026-10-23 14:00:00",
            ends: "2026-10-23 15:00:00",
            description: "<p>About &amp; more</p>",
            genre: "Jazz",
          },
          next: [
            {
              name: "Next",
              starts: "2026-10-23 15:00:00",
              ends: "2026-10-23 16:00:00",
            },
          ],
        },
      })
    )
  );
  expect(
    await tryAirtimeLiveInfo(input, ["https://example.com/api"])
  ).toMatchObject({ title: "A song" });
  expect(
    programmes().map(({ title, start, end }) => ({ title, start, end }))
  ).toEqual([
    { title: "The show", start: now - 30 * 60_000, end: now + 30 * 60_000 },
    { title: "Next", start: now + 30 * 60_000, end: now + 90 * 60_000 },
  ]);
  expect(programmes()[0]?.description).toBe("About & more");
});

test.each([
  [
    "Europe/Berlin",
    "2026-10-25 02:15:00",
    "2026-10-25 03:15:00",
    "2026-10-25T00:00:00Z",
  ],
  [
    "Europe/Berlin",
    "2026-03-29 02:15:00",
    "2026-03-29 03:15:00",
    "2026-03-29T00:00:00Z",
  ],
  [
    "Unknown/Zone",
    "2026-10-23 14:00:00",
    "2026-10-23 15:00:00",
    "2026-10-23T12:00:00Z",
  ],
])(
  "omits ambiguous or invalid Airtime local times in %s",
  async (timezone, starts, ends, sampled) => {
    const { input, programmes } = fixture(
      () =>
        Promise.resolve(
          Response.json({
            station: { timezone },
            current: { name: "Track" },
            shows: { current: { name: "Show", starts, ends } },
          })
        ),
      Date.parse(sampled)
    );
    await tryAirtimeLiveInfo(input, ["https://example.com/api"]);
    expect(programmes()).toEqual([]);
  }
);

test("HKCR exports dated Hong Kong slots, omitting cancelled and invalid entries", async () => {
  const { input, programmes } = fixture(() =>
    Promise.resolve(
      Response.json([
        null,
        {
          date: "2026-10-23",
          startTime: "20:00",
          endTime: "21:00",
          title: "Now",
          description: "<p>Live</p>",
        },
        {
          date: "2026-10-23",
          startTime: "23:00",
          endTime: "01:00",
          title: "Overnight",
        },
        {
          date: "2026-10-23",
          startTime: "21:00",
          endTime: "22:00",
          title: "Cancelled",
          status: "cancelled",
        },
        {
          date: "2026-02-30",
          startTime: "20:00",
          endTime: "21:00",
          title: "Invalid",
        },
      ])
    )
  );
  await tryHkcrSchedule(input);
  expect(programmes().map((entry) => entry.title)).toEqual([
    "Now",
    "Overnight",
  ]);
  expect(programmes()[1]).toMatchObject({
    start: Date.parse("2026-10-23T15:00:00Z"),
    end: Date.parse("2026-10-23T17:00:00Z"),
  });
});

test("LYL publishes trusted current details and upcoming calendar slots", async () => {
  const { input, programmes } = fixture((_url, init) => {
    const { query } = JSON.parse(String(init?.body));
    return Promise.resolve(
      Response.json(
        query.includes("NowPlaying")
          ? {
              data: {
                onair: { title: "Current", hls: "https://lyl.live/live.m3u8" },
                calendar: [
                  {
                    start: "2026-10-23T12:00:00Z",
                    end: "2026-10-23T13:00:00Z",
                    title: "Current",
                    slug: "current",
                    type: "EPISODE",
                  },
                  {
                    start: "2026-10-23T13:00:00Z",
                    end: "2026-10-23T14:00:00Z",
                    title: "Next",
                    slug: "next",
                    type: "SHOW",
                  },
                  {
                    start: "2026-10-23T14:00:00Z",
                    end: "2026-10-23T15:00:00Z",
                    title: "Unknown",
                    type: "OTHER",
                  },
                ],
              },
            }
          : {
              data: {
                episodeBySlug: {
                  slug: "current",
                  title: "Current",
                  description: "Actual episode",
                  styles: [{ name: "Ambient" }],
                  image: { url: "https://lyl.live/art.jpg" },
                },
              },
            }
      )
    );
  });
  await tryLylApi(input);
  expect(programmes().map((entry) => entry.title)).toEqual(["Current", "Next"]);
  expect(programmes()[0]).toMatchObject({
    description: "Actual episode",
    categories: ["Ambient"],
    artworkUrl: "https://lyl.live/art.jpg",
  });
  expect(programmes()[1]?.description).toBeNull();
});

test.each([
  { name: "missing", onair: undefined },
  { name: "malformed", onair: { title: 42, hls: false } },
  {
    name: "disagreeing",
    onair: { title: "Different show", hls: "https://lyl.live/live.m3u8" },
  },
])(
  "LYL keeps active calendar slots with $name on-air data",
  async ({ onair }) => {
    const { input, programmes } = fixture(() =>
      Promise.resolve(
        Response.json({
          data: {
            onair,
            calendar: [
              {
                start: "2026-10-23T11:00:00Z",
                end: "2026-10-23T12:30:00Z",
                title: "Ended",
                type: "EPISODE",
              },
              {
                start: "2026-10-23T12:00:00Z",
                end: "2026-10-23T13:00:00Z",
                title: "Current",
                slug: "current",
                type: "EPISODE",
              },
              {
                start: "2026-10-23T13:00:00Z",
                end: "2026-10-23T14:00:00Z",
                title: "Next",
                type: "SHOW",
              },
            ],
          },
        })
      )
    );

    expect(await tryLylApi(input)).toBeNull();
    expect(programmes().map((entry) => entry.title)).toEqual([
      "Current",
      "Next",
    ]);
    expect(programmes()[0]).toMatchObject({
      start: Date.parse("2026-10-23T12:00:00Z"),
      end: Date.parse("2026-10-23T13:00:00Z"),
      description: null,
      artworkUrl: null,
    });
  }
);

test.each(["2026-10-23T23:30:00Z", "2026-12-31T23:30:00Z"])(
  "LYL retrieves tomorrow's guide through the rolling horizon at %s",
  async (timestamp) => {
    const sampledAt = Date.parse(timestamp);
    const horizon = sampledAt + 24 * 60 * 60_000;
    const next = {
      start: new Date(sampledAt + 60 * 60_000).toISOString(),
      end: new Date(sampledAt + 2 * 60 * 60_000).toISOString(),
      title: "After midnight",
      type: "SHOW",
    };
    const last = {
      start: new Date(horizon - 30 * 60_000).toISOString(),
      end: new Date(horizon).toISOString(),
      title: "Before horizon",
      type: "EPISODE",
    };
    const requests: { from: string; to: string }[] = [];
    const { input, programmes } = fixture((_url, init) => {
      const { variables } = JSON.parse(String(init?.body));
      requests.push(variables);
      return Promise.resolve(
        Response.json({
          data: {
            calendar: [next, last].filter(
              (slot) => Date.parse(slot.start) < Date.parse(variables.to)
            ),
          },
        })
      );
    }, sampledAt);

    await tryLylApi(input);
    expect(programmes().map((entry) => entry.title)).toEqual([
      "After midnight",
      "Before horizon",
    ]);
    expect(requests).toEqual([
      {
        from: `${timestamp.slice(0, 10)}T00:00:00.000Z`,
        to: new Date(horizon).toISOString(),
      },
    ]);
  }
);

test("HKCR replay windows retain actual dates without changing JSON expiry", async () => {
  const { input, programmes } = fixture((url) =>
    Promise.resolve(
      Response.json(
        url.includes("replay-slots")
          ? {
              slots: [
                null,
                {
                  start: "2026-10-23T12:00:00Z",
                  end: "2026-10-23T12:30:10Z",
                  replay: { title: "Replay" },
                },
              ],
            }
          : []
      )
    )
  );
  const result = await tryHkcrSchedule(input);
  expect(result).toMatchObject({
    title: "Replay",
    sampledAt: now,
    expiresAt: now + 60_000,
  });
  expect(programmes()[0]).toMatchObject({
    title: "Replay",
    start: now - 30 * 60_000,
    end: now + 10_000,
  });
});

test("Resonance publishes both dated slots using explicit BST", async () => {
  const { input, programmes } = fixture(() =>
    Promise.resolve(
      Response.json({
        now: {
          name: "Current",
          starts_ends: "Friday 23rd October 2026 13:00 - 14:00 BST",
          description: "**Sound** art",
        },
        after: {
          name: "Next",
          starts_ends: "Friday 23rd October 2026 14:00 - 15:00 BST",
        },
      })
    )
  );
  await tryResonanceExtraApi(input);
  expect(programmes()).toHaveLength(2);
  expect(programmes()[0]).toMatchObject({
    start: now - 30 * 60_000,
    end: now + 30 * 60_000,
    description: "Sound art",
  });
});

test("Alhara track duration is not promoted to a programme", async () => {
  const { input, programmes } = fixture(() =>
    Promise.resolve(
      Response.json({
        episodeTitle: "Track",
        scheduledTitle: "Show",
        trackStart: "2026-10-23T12:00:00Z",
        duration: 3600,
      })
    )
  );
  expect(await tryRadioAlharaApi(input)).toMatchObject({ title: "Track" });
  expect(programmes()).toEqual([]);
});

test("programme normalization rejects invalid windows and bounds horizon, entries and text", () => {
  expect(programmeTimestamp("2026-02-30T12:00:00Z")).toBeNull();
  expect(programmeTimestamp("2026-10-23T12:00:00")).toBeNull();
  const valid = { title: "Valid", start: now, end: now + 60_000 };
  expect(
    normalizeProgrammes(
      [
        { ...valid, end: now },
        { ...valid, start: Number.NaN },
        { ...valid, title: " " },
        { ...valid, start: now + 86_400_000, end: now + 86_460_000 },
        { ...valid, start: now - 86_400_000 },
        valid,
      ],
      now
    ).map((entry) => entry.title)
  ).toEqual(["Valid"]);
  const many = Array.from({ length: 100 }, (_, index) => ({
    title: "x".repeat(2000),
    description: "d".repeat(20_000),
    start: now + index * 60_000,
    end: now + (index + 1) * 60_000,
  }));
  const normalized = normalizeProgrammes(many, now);
  expect(normalized).toHaveLength(48);
  expect(normalized[0]?.title).toHaveLength(512);
  expect(normalized[0]?.description).toHaveLength(8000);
});
