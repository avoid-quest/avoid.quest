import { describe, expect, mock, test } from "bun:test";
import { BANDCAMP_RELAY_BASE_URLS } from "./bandcamp-relays";
import {
  type PlatformItem,
  preparePlatformItem,
  resolvePlatformItem,
  resolveSpotifyItem,
  selectBandcampRelayBaseUrl,
} from "./platform-client";

const BANDCAMP_URL = "https://artist.bandcamp.com/album/release";
const BANDCAMP_STREAM = "https://t4.bcbits.com/stream/track-one";
const BANDCAMP_TRACK_STREAM = "https://t4.bcbits.com/stream/track-two";
const SOUNDCLOUD_URL = "https://soundcloud.com/artist/track";
const MIXCLOUD_URL = "https://www.mixcloud.com/dholbach/cryptkeeper/";
const MIXCLOUD_HLS =
  "https://aod.mixcloud.stream/secure/hls/6/f/c/d/d610.m4a/index.m3u8";

function rangedAudioResponse(body: BodyInit | null = new Uint8Array([0])) {
  return new Response(body, {
    headers: {
      "Content-Range": "bytes 0-0/5605667",
      "Content-Type": "audio/mpeg",
    },
    status: 206,
  });
}

describe("preparePlatformItem", () => {
  test("keeps only the live Bandcamp relay", () => {
    expect(BANDCAMP_RELAY_BASE_URLS).toEqual(["https://seep.eu.org/"]);
  });

  test("routes every Bandcamp stream through the curated relay", async () => {
    const item: PlatformItem = {
      format: "progressive",
      metadata: {
        itemType: "album",
        platform: "bandcamp",
        streamUrl: BANDCAMP_STREAM,
        tracks: [
          {
            format: "progressive",
            name: "Track two",
            streamUrl: BANDCAMP_TRACK_STREAM,
          },
        ],
        url: BANDCAMP_URL,
      },
      streamUrl: BANDCAMP_STREAM,
    };

    const relayed = await preparePlatformItem(BANDCAMP_URL, item);
    if (relayed.metadata.platform !== "bandcamp") {
      throw new Error("Expected Bandcamp metadata");
    }

    expect(relayed.streamUrl).toBe(
      BANDCAMP_RELAY_BASE_URLS[0] + BANDCAMP_STREAM
    );
    expect(relayed.metadata.streamUrl).toBe(
      BANDCAMP_RELAY_BASE_URLS[0] + BANDCAMP_STREAM
    );
    expect(relayed.metadata.tracks?.[0]?.streamUrl).toBe(
      BANDCAMP_RELAY_BASE_URLS[0] + BANDCAMP_TRACK_STREAM
    );
  });

  test("selects seep when its one-byte audio probe succeeds", async () => {
    const fetchImpl = mock((input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(BANDCAMP_RELAY_BASE_URLS[0] + BANDCAMP_STREAM);
      expect(new Headers(init?.headers).get("Range")).toBe("bytes=0-0");
      return Promise.resolve(rangedAudioResponse());
    });

    await expect(
      selectBandcampRelayBaseUrl(BANDCAMP_STREAM, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).resolves.toBe(BANDCAMP_RELAY_BASE_URLS[0]);
  });

  test("accepts exactly one byte without Content-Length when CORS hides Content-Range", async () => {
    const fetchImpl = async () =>
      new Response(new Uint8Array([0]), {
        headers: { "Content-Type": "audio/mpeg" },
        status: 206,
      });

    await expect(
      selectBandcampRelayBaseUrl(BANDCAMP_STREAM, { fetchImpl })
    ).resolves.toBe(BANDCAMP_RELAY_BASE_URLS[0]);
  });

  test.each(["0", "2", "5605667"])(
    "rejects a relay that declares Content-Length %s for a one-byte probe",
    async (length) => {
      await expect(
        selectBandcampRelayBaseUrl(BANDCAMP_STREAM, {
          fetchImpl: async () =>
            new Response(new Uint8Array([0]), {
              headers: {
                "Content-Length": length,
                "Content-Type": "audio/mpeg",
              },
              status: 206,
            }),
        })
      ).rejects.toThrow("No public Bandcamp relay is currently available");
    }
  );

  test.each([
    { chunks: [[0, 1]] },
    { chunks: [[0, 1, 2]] },
    { chunks: [[0], [1]] },
  ])(
    "rejects more than one byte without Content-Length and cancels an unfinished body: %j",
    async ({ chunks }) => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new Uint8Array(chunk));
          }
        },
      });
      await expect(
        selectBandcampRelayBaseUrl(BANDCAMP_STREAM, {
          fetchImpl: async () =>
            new Response(body, {
              headers: { "Content-Type": "audio/mpeg" },
              status: 206,
            }),
        })
      ).rejects.toThrow("No public Bandcamp relay is currently available");
      expect(cancelled).toBe(true);
    }
  );

  test("accepts a one-byte Content-Length when Content-Range is hidden", async () => {
    await expect(
      selectBandcampRelayBaseUrl(BANDCAMP_STREAM, {
        fetchImpl: async () =>
          new Response(new Uint8Array([0]), {
            headers: { "Content-Length": "1", "Content-Type": "audio/mpeg" },
            status: 206,
          }),
      })
    ).resolves.toBe(BANDCAMP_RELAY_BASE_URLS[0]);
  });

  test("fails when seep returns ranged headers without a byte", async () => {
    await expect(
      selectBandcampRelayBaseUrl(BANDCAMP_STREAM, {
        fetchImpl: async () => rangedAudioResponse(null),
      })
    ).rejects.toThrow("No public Bandcamp relay is currently available");
  });

  test("bounds a stalled seep probe by the shared deadline", async () => {
    const fetchImpl = mock(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const rejectAbort = () =>
            reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
          if (signal?.aborted) {
            rejectAbort();
          } else {
            signal?.addEventListener("abort", rejectAbort, { once: true });
          }
        })
    );

    const selection = selectBandcampRelayBaseUrl(BANDCAMP_STREAM, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    });
    await expect(selection).rejects.toThrow(
      "No public Bandcamp relay is currently available"
    );
  });

  test("fails when every curated relay is unavailable", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(new Response("unavailable", { status: 503 }))
    );

    await expect(
      selectBandcampRelayBaseUrl(BANDCAMP_STREAM, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow("No public Bandcamp relay is currently available");
    expect(fetchImpl).toHaveBeenCalledTimes(BANDCAMP_RELAY_BASE_URLS.length);
  });

  test("rejects an already-cancelled platform resolution", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Resolution cancelled"));

    await expect(
      resolvePlatformItem(BANDCAMP_URL, controller.signal)
    ).rejects.toThrow("Resolution cancelled");
  });

  test("rejects unsafe Bandcamp streams at every playable position", async () => {
    const unsafe = "https://media.example/track.mp3";
    const items: PlatformItem[] = [
      {
        metadata: {
          itemType: "track",
          platform: "bandcamp",
          url: BANDCAMP_URL,
        },
        streamUrl: unsafe,
      },
      {
        metadata: {
          itemType: "track",
          platform: "bandcamp",
          streamUrl: unsafe,
          url: BANDCAMP_URL,
        },
        streamUrl: BANDCAMP_STREAM,
      },
      {
        metadata: {
          itemType: "album",
          platform: "bandcamp",
          tracks: [{ name: "Unsafe", streamUrl: unsafe }],
          url: BANDCAMP_URL,
        },
        streamUrl: BANDCAMP_STREAM,
      },
    ];

    await Promise.all(
      items.map((item) =>
        expect(preparePlatformItem(BANDCAMP_URL, item)).rejects.toThrow(
          "Bandcamp returned an unsafe media URL"
        )
      )
    );
  });

  test("keeps browser-readable SoundCloud CDN streams unchanged", async () => {
    const item: PlatformItem = {
      metadata: {
        itemType: "playlist",
        platform: "soundcloud",
        streamUrl: "https://cf-hls-media.sndcdn.com/first.m3u8",
        tracks: [
          {
            name: "Second",
            streamUrl: "https://cf-hls-media.sndcdn.com/second.m3u8",
          },
        ],
        url: SOUNDCLOUD_URL,
      },
      streamUrl: "https://cf-hls-media.sndcdn.com/first.m3u8",
    };

    expect(await preparePlatformItem(SOUNDCLOUD_URL, item)).toBe(item);
  });

  test("rejects unsafe SoundCloud streams at every playable position", async () => {
    const valid = "https://cf-hls-media.sndcdn.com/track.m3u8";
    const items: PlatformItem[] = [
      {
        metadata: {
          itemType: "track",
          platform: "soundcloud",
          url: SOUNDCLOUD_URL,
        },
        streamUrl: "http://127.0.0.1/track.mp3",
      },
      {
        metadata: {
          itemType: "track",
          platform: "soundcloud",
          streamUrl: "data:audio/mpeg;base64,AA==",
          url: SOUNDCLOUD_URL,
        },
        streamUrl: valid,
      },
      {
        metadata: {
          itemType: "playlist",
          platform: "soundcloud",
          tracks: [{ name: "Unsafe", streamUrl: "/api/stream" }],
          url: SOUNDCLOUD_URL,
        },
        streamUrl: valid,
      },
      {
        metadata: {
          itemType: "track",
          platform: "soundcloud",
          url: SOUNDCLOUD_URL,
        },
        streamUrl: "https://cf-media.sndcdn.com/track.mp3",
      },
    ];

    await Promise.all(
      items.map((item) =>
        expect(preparePlatformItem(SOUNDCLOUD_URL, item)).rejects.toThrow(
          "SoundCloud returned an unsafe media URL"
        )
      )
    );
  });

  test("keeps Mixcloud streams on its stream hosts and rejects others", async () => {
    const item: PlatformItem = {
      format: "hls",
      metadata: {
        itemType: "show",
        platform: "mixcloud",
        streamUrl: MIXCLOUD_HLS,
        url: MIXCLOUD_URL,
      },
      streamUrl: MIXCLOUD_HLS,
    };
    expect(await preparePlatformItem(MIXCLOUD_URL, item)).toBe(item);

    const unsafe = [
      { ...item, streamUrl: "https://evil.example/index.m3u8" },
      {
        ...item,
        metadata: { ...item.metadata, streamUrl: "http://127.0.0.1/a.m4a" },
      },
      {
        ...item,
        streamUrl: "http://aod.mixcloud.stream/secure/hls/a.m4a/index.m3u8",
      },
    ];
    await Promise.all(
      unsafe.map((candidate) =>
        expect(preparePlatformItem(MIXCLOUD_URL, candidate)).rejects.toThrow(
          "Mixcloud returned an unsafe media URL"
        )
      )
    );
  });

  test("allows public Radio Garden streams and rejects unsafe ones", async () => {
    const requestUrl = "https://radio.garden/listen/station/abc";
    const publicItem: PlatformItem = {
      metadata: {
        channelId: "abc",
        itemType: "channel",
        platform: "radiogarden",
        url: requestUrl,
      },
      streamUrl: "https://stream.example/live.mp3",
    };

    expect(
      await preparePlatformItem(requestUrl, publicItem, {
        fetchImpl: mock(async () => rangedAudioResponse()),
        resolveHostname: async () => ["203.0.113.8"],
      })
    ).toBe(publicItem);

    await Promise.all(
      [
        "http://localhost/live.mp3",
        "http://10.0.0.1/live.mp3",
        "http://[::1]/live.mp3",
        "data:audio/mpeg;base64,AA==",
        "/api/stream",
        "//evil.example/stream",
      ].map((streamUrl) =>
        expect(
          preparePlatformItem(requestUrl, { ...publicItem, streamUrl })
        ).rejects.toThrow("Radio Garden returned an unsafe media URL")
      )
    );
  });

  test("rejects a Radio Garden hostname that resolves privately", async () => {
    const requestUrl = "https://radio.garden/listen/station/abc";
    const item: PlatformItem = {
      metadata: {
        channelId: "abc",
        itemType: "channel",
        platform: "radiogarden",
        url: requestUrl,
      },
      streamUrl: "https://stream.example/live.mp3",
    };

    await expect(
      preparePlatformItem(requestUrl, item, {
        resolveHostname: async () => ["10.0.0.8"],
      })
    ).rejects.toThrow("Radio Garden returned an unsafe media URL");
  });

  test("rejects Radio Garden streams that the browser cannot read", async () => {
    const requestUrl = "https://radio.garden/listen/station/abc";
    const item: PlatformItem = {
      metadata: {
        channelId: "abc",
        itemType: "channel",
        platform: "radiogarden",
        url: requestUrl,
      },
      streamUrl: "https://stream.example/live.mp3",
    };

    await expect(
      preparePlatformItem(requestUrl, item, {
        fetchImpl: mock(() => Promise.reject(new TypeError("CORS blocked"))),
        resolveHostname: async () => ["203.0.113.8"],
      })
    ).rejects.toThrow("unplayable media URL");
  });

  test("bounds Radio Garden DNS resolution by the playback probe timeout", async () => {
    const requestUrl = "https://radio.garden/listen/station/abc";
    const item: PlatformItem = {
      metadata: {
        channelId: "abc",
        itemType: "channel",
        platform: "radiogarden",
        url: requestUrl,
      },
      streamUrl: "https://stream.example/live.mp3",
    };

    await expect(
      preparePlatformItem(requestUrl, item, {
        resolveHostname: () => new Promise(() => undefined),
        timeoutMs: 1,
      })
    ).rejects.toThrow("unplayable media URL");
  });

  test("rejects request and response platform mismatches", async () => {
    const item: PlatformItem = {
      metadata: {
        channelId: "abc",
        itemType: "channel",
        platform: "radiogarden",
        url: "https://radio.garden/listen/station/abc",
      },
      streamUrl: "https://stream.example/live.mp3",
    };

    await expect(preparePlatformItem(SOUNDCLOUD_URL, item)).rejects.toThrow(
      "Platform returned mismatched metadata"
    );
  });
});

describe("resolveSpotifyItem", () => {
  const url = "https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc";
  const metadata = {
    artist: "Daft Punk",
    itemType: "album" as const,
    name: "Discovery",
    platform: "spotify" as const,
    spotifyId: "2noRn2Aes5aoNVsU6iWThc",
    tracks: [
      {
        artist: "Daft Punk",
        duration: 320,
        name: "One More Time",
        spotifyId: "0DiWol3AO6WpXZgp0goxAV",
        streamUrl: "spotify:track:0DiWol3AO6WpXZgp0goxAV",
        url: "https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV",
      },
      {
        artist: "Daft Punk",
        duration: 212,
        name: "Aerodynamic",
        spotifyId: "1NeLwFETswx8Fzxl2AFl91",
        streamUrl: "spotify:track:1NeLwFETswx8Fzxl2AFl91",
        url: "https://open.spotify.com/track/1NeLwFETswx8Fzxl2AFl91",
      },
    ],
    url,
  };

  test("matches the first track on YouTube and keeps the rest lazy", async () => {
    const loadMetadata = mock(() => Promise.resolve(metadata));
    const youtube = {
      resolveStream: mock((videoId: string) =>
        Promise.resolve(`https://media.example/${videoId}.webm`)
      ),
      search: mock(() =>
        Promise.resolve([
          {
            author: "Daft Punk",
            duration: 320,
            title: "One More Time",
            videoId: "FGBhQbmPwH8",
          },
        ])
      ),
    };

    const item = await resolveSpotifyItem(url, { loadMetadata, youtube });

    expect(loadMetadata).toHaveBeenCalledWith(url);
    expect(item.streamUrl).toBe("https://media.example/FGBhQbmPwH8.webm");
    if (item.metadata.platform !== "spotify") {
      throw new Error("Expected Spotify metadata");
    }
    expect(item.metadata.tracks?.map((track) => track.streamUrl)).toEqual([
      "https://media.example/FGBhQbmPwH8.webm",
      "spotify:track:1NeLwFETswx8Fzxl2AFl91",
    ]);
    expect(item.metadata.tracks?.[0]?.youtubeVideoId).toBe("FGBhQbmPwH8");
  });

  test("fails when nothing on YouTube matches", async () => {
    await expect(
      resolveSpotifyItem(url, {
        loadMetadata: () => Promise.resolve(metadata),
        youtube: {
          resolveStream: () => Promise.reject(new Error("unused")),
          search: () => Promise.resolve([]),
        },
      })
    ).rejects.toThrow("No playable track found in this Spotify album");
  });
});
