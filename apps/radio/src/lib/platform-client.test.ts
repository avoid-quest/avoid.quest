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

  test("routes every Bandcamp stream through the curated relay", () => {
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

    const relayed = preparePlatformItem(BANDCAMP_URL, item);
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

  test("rejects unsafe Bandcamp streams at every playable position", () => {
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

    for (const item of items) {
      expect(() => preparePlatformItem(BANDCAMP_URL, item)).toThrow(
        "Bandcamp returned an unsafe media URL"
      );
    }
  });

  test("keeps validated SoundCloud CDN streams unchanged", () => {
    const item: PlatformItem = {
      metadata: {
        itemType: "playlist",
        platform: "soundcloud",
        streamUrl: "https://cf-media.sndcdn.com/first.mp3",
        tracks: [
          {
            name: "Second",
            streamUrl: "https://cf-hls-media.sndcdn.com/second.m3u8",
          },
        ],
        url: SOUNDCLOUD_URL,
      },
      streamUrl: "https://cf-media.sndcdn.com/first.mp3",
    };

    expect(preparePlatformItem(SOUNDCLOUD_URL, item)).toBe(item);
  });

  test("rejects unsafe SoundCloud streams at every playable position", () => {
    const valid = "https://cf-media.sndcdn.com/track.mp3";
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
    ];

    for (const item of items) {
      expect(() => preparePlatformItem(SOUNDCLOUD_URL, item)).toThrow(
        "SoundCloud returned an unsafe media URL"
      );
    }
  });

  test("allows public Radio Garden streams and rejects unsafe ones", () => {
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

    expect(preparePlatformItem(requestUrl, publicItem)).toBe(publicItem);

    for (const streamUrl of [
      "http://localhost/live.mp3",
      "http://10.0.0.1/live.mp3",
      "http://[::1]/live.mp3",
      "data:audio/mpeg;base64,AA==",
      "/api/stream",
      "//evil.example/stream",
    ]) {
      expect(() =>
        preparePlatformItem(requestUrl, { ...publicItem, streamUrl })
      ).toThrow("Radio Garden returned an unsafe media URL");
    }
  });

  test("rejects request and response platform mismatches", () => {
    const item: PlatformItem = {
      metadata: {
        channelId: "abc",
        itemType: "channel",
        platform: "radiogarden",
        url: "https://radio.garden/listen/station/abc",
      },
      streamUrl: "https://stream.example/live.mp3",
    };

    expect(() => preparePlatformItem(SOUNDCLOUD_URL, item)).toThrow(
      "Platform returned mismatched metadata"
    );
  });
});
