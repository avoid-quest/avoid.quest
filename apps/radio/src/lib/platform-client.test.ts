import { describe, expect, mock, test } from "bun:test";
import {
  BANDCAMP_RELAY_BASE_URLS,
  type PlatformItem,
  preparePlatformItem,
  resolvePlatformItem,
  selectBandcampRelayBaseUrl,
} from "./platform-client";

const BANDCAMP_URL = "https://artist.bandcamp.com/album/release";
const BANDCAMP_STREAM = "https://t4.bcbits.com/stream/track-one";
const BANDCAMP_TRACK_STREAM = "https://t4.bcbits.com/stream/track-two";
const SOUNDCLOUD_URL = "https://soundcloud.com/artist/track";

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
  test("keeps every byte-compatible Bandcamp relay in maintenance order", () => {
    expect(BANDCAMP_RELAY_BASE_URLS).toEqual([
      "https://seep.eu.org/",
      "https://proxy.cors.sh/",
      "https://cors.zme.ink/",
    ]);
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

  test("selects the first relay that serves ranged audio", async () => {
    const fetchImpl = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(BANDCAMP_RELAY_BASE_URLS[0])) {
        return Promise.resolve(
          new Response(new Uint8Array([0]), {
            headers: { "Content-Type": "audio/mpeg" },
            status: 200,
          })
        );
      }
      return Promise.resolve(rangedAudioResponse());
    });

    await expect(
      selectBandcampRelayBaseUrl(BANDCAMP_STREAM, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).resolves.toBe(BANDCAMP_RELAY_BASE_URLS[1]);
    expect(fetchImpl).toHaveBeenCalledTimes(BANDCAMP_RELAY_BASE_URLS.length);
  });

  test("skips a relay that returns ranged headers without a byte", async () => {
    const fetchImpl = mock((input: RequestInfo | URL) => {
      const url = String(input);
      return Promise.resolve(
        url.startsWith(BANDCAMP_RELAY_BASE_URLS[0])
          ? rangedAudioResponse(null)
          : rangedAudioResponse()
      );
    });

    await expect(
      selectBandcampRelayBaseUrl(BANDCAMP_STREAM, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).resolves.toBe(BANDCAMP_RELAY_BASE_URLS[1]);
  });

  test("probes every relay concurrently under one deadline", async () => {
    const fetchImpl = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(BANDCAMP_RELAY_BASE_URLS[0])) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const rejectAbort = () =>
            reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
          if (signal?.aborted) {
            rejectAbort();
          } else {
            signal?.addEventListener("abort", rejectAbort, { once: true });
          }
        });
      }
      return Promise.resolve(rangedAudioResponse());
    });

    const selection = selectBandcampRelayBaseUrl(BANDCAMP_STREAM, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(BANDCAMP_RELAY_BASE_URLS.length);
    await expect(selection).resolves.toBe(BANDCAMP_RELAY_BASE_URLS[1]);
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
