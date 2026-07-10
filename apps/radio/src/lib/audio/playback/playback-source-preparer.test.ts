import { describe, expect, test } from "bun:test";
import type { PlaybackInput, PlaybackSource } from "./playback-source";
import { PlaybackSourcePreparer } from "./playback-source-preparer";
import { STREAM_PROXY_ROUTE } from "./playback-source-shared";
import type { Radio } from "./types";

type PlaybackTarget = Pick<PlaybackSource, "load" | "refreshUrl">;

function radio(streamUrl: string): Radio {
  return { name: "Test radio", streamUrl };
}

function target(overrides: Partial<PlaybackTarget> = {}): {
  loadInputs: PlaybackInput[];
  refreshInputs: { input: PlaybackInput; position?: number }[];
  target: PlaybackTarget;
} {
  const loadInputs: PlaybackInput[] = [];
  const refreshInputs: { input: PlaybackInput; position?: number }[] = [];

  return {
    loadInputs,
    refreshInputs,
    target: {
      load: (input) => {
        loadInputs.push(input);
        return Promise.resolve();
      },
      refreshUrl: (input, position) => {
        refreshInputs.push({ input, position });
        return Promise.resolve();
      },
      ...overrides,
    },
  };
}

describe("PlaybackSourcePreparer", () => {
  test("omits insecure direct playback on HTTPS pages", async () => {
    const originalLocation = Object.getOwnPropertyDescriptor(
      globalThis,
      "location"
    );
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("https://radio.example/app"),
    });

    try {
      const prepared = new PlaybackSourcePreparer(() => ({
        services: [
          {
            baseUrl: "https://relay.example",
            capabilities: ["stream"],
            enabled: true,
            kind: "stream-relay",
            name: "Relay",
          },
        ],
        version: 1,
      }));
      const playback = target();
      const sourceUrl = "http://legacy-radio.example/live.mp3";

      await prepared.load(radio(sourceUrl), playback.target);

      expect(playback.loadInputs[0]?.candidates).toEqual([
        {
          credentials: "omit",
          format: "progressive",
          src: `https://relay.example/api/stream-proxy?url=${encodeURIComponent(sourceUrl)}`,
        },
        {
          format: "progressive",
          src: STREAM_PROXY_ROUTE + encodeURIComponent(sourceUrl),
        },
      ]);
    } finally {
      if (originalLocation) {
        Object.defineProperty(globalThis, "location", originalLocation);
      } else {
        Reflect.deleteProperty(globalThis, "location");
      }
    }
  });

  test("keeps insecure direct playback on an HTTP development page", async () => {
    const originalLocation = Object.getOwnPropertyDescriptor(
      globalThis,
      "location"
    );
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("http://localhost:3000"),
    });

    try {
      const prepared = new PlaybackSourcePreparer();
      const playback = target();
      const sourceUrl = "http://legacy-radio.example/live.mp3";

      await prepared.load(radio(sourceUrl), playback.target);

      expect(playback.loadInputs[0]?.candidates[0]).toEqual({
        format: "progressive",
        src: sourceUrl,
      });
    } finally {
      if (originalLocation) {
        Object.defineProperty(globalThis, "location", originalLocation);
      } else {
        Reflect.deleteProperty(globalThis, "location");
      }
    }
  });

  test("prepares a direct remote source first in one transport load", async () => {
    const prepared = new PlaybackSourcePreparer();
    const playback = target();
    const sourceUrl = "https://radio.example/live.mp3";

    await prepared.load(radio(sourceUrl), playback.target);

    expect(playback.loadInputs).toEqual([
      {
        candidates: [
          { format: "progressive", src: sourceUrl },
          {
            format: "progressive",
            src: STREAM_PROXY_ROUTE + encodeURIComponent(sourceUrl),
          },
        ],
      },
    ]);
  });

  test("includes the generic proxy as the ordered HLS fallback", async () => {
    const prepared = new PlaybackSourcePreparer();
    const playback = target();
    const sourceUrl = "https://radio.example/live/playlist.m3u8?client=pwa";

    await prepared.load(radio(sourceUrl), playback.target);

    expect(playback.loadInputs[0]?.candidates).toEqual([
      { format: "hls", src: sourceUrl },
      {
        format: "hls",
        src: STREAM_PROXY_ROUTE + encodeURIComponent(sourceUrl),
      },
    ]);
  });

  test("orders compatible user relays between direct playback and the app fallback", async () => {
    const prepared = new PlaybackSourcePreparer(() => ({
      services: [
        {
          baseUrl: "https://relay-one.example",
          capabilities: ["stream"],
          enabled: true,
          kind: "stream-relay",
          name: "One",
        },
        {
          baseUrl: "https://metadata.example",
          capabilities: ["hls"],
          enabled: true,
          kind: "stream-relay",
          name: "HLS",
        },
        {
          baseUrl: "https://relay-two.example/edge",
          capabilities: ["stream"],
          enabled: true,
          kind: "stream-relay",
          name: "Two",
        },
      ],
      version: 1,
    }));
    const playback = target();
    const sourceUrl = "https://radio.example/live.mp3?token=a b";

    await prepared.load(radio(sourceUrl), playback.target);

    expect(playback.loadInputs[0]?.candidates).toEqual([
      { format: "progressive", src: sourceUrl },
      {
        credentials: "omit",
        format: "progressive",
        src: `https://relay-one.example/api/stream-proxy?${new URLSearchParams({ url: sourceUrl })}`,
      },
      {
        credentials: "omit",
        format: "progressive",
        src: `https://relay-two.example/edge/api/stream-proxy?${new URLSearchParams({ url: sourceUrl })}`,
      },
      {
        format: "progressive",
        src: STREAM_PROXY_ROUTE + encodeURIComponent(sourceUrl),
      },
    ]);
  });

  test("omits generic and platform app proxies while keeping direct and external relay candidates when compatibility fallbacks are disabled", async () => {
    const prepared = new PlaybackSourcePreparer(
      () => ({
        services: [
          {
            baseUrl: "https://relay.example",
            capabilities: ["stream"],
            enabled: true,
            kind: "stream-relay",
            name: "Relay",
          },
        ],
        version: 1,
      }),
      () => false
    );
    const sourceUrls = [
      "https://radio.example/live.mp3",
      "https://t4.bcbits.com/stream/example/mp3-128/1",
      "https://cf-media.sndcdn.com/example.128.mp3",
    ];

    for (const sourceUrl of sourceUrls) {
      const playback = target();
      await prepared.load(radio(sourceUrl), playback.target);

      expect(playback.loadInputs[0]?.candidates).toEqual([
        { format: "progressive", src: sourceUrl },
        {
          credentials: "omit",
          format: "progressive",
          src: `https://relay.example/api/stream-proxy?url=${encodeURIComponent(sourceUrl)}`,
        },
      ]);
    }
  });

  test("uses only HLS-aware relays for HLS playback", async () => {
    const prepared = new PlaybackSourcePreparer(() => ({
      services: [
        {
          baseUrl: "https://progressive.example",
          capabilities: ["stream"],
          enabled: true,
          kind: "stream-relay",
          name: "Progressive",
        },
        {
          baseUrl: "https://hls.example",
          capabilities: ["hls"],
          enabled: true,
          kind: "stream-relay",
          name: "HLS",
        },
      ],
      version: 1,
    }));
    const playback = target();
    const sourceUrl = "https://radio.example/live/master.m3u8";

    await prepared.load(radio(sourceUrl), playback.target);

    expect(playback.loadInputs[0]?.candidates).toEqual([
      { format: "hls", src: sourceUrl },
      {
        credentials: "omit",
        format: "hls",
        src: `https://hls.example/api/stream-proxy?url=${encodeURIComponent(sourceUrl)}`,
      },
      {
        format: "hls",
        src: STREAM_PROXY_ROUTE + encodeURIComponent(sourceUrl),
      },
    ]);
  });

  test("preserves explicit Radio Browser HLS without a manifest suffix", async () => {
    const prepared = new PlaybackSourcePreparer();
    const playback = target();
    const sourceUrl = "https://radio.example/signed-stream";

    await prepared.load(
      {
        name: "HLS radio",
        streamUrl: sourceUrl,
        platformMetadata: {
          platform: "radio-browser",
          itemType: "station",
          url: sourceUrl,
          stationUuid: "station-1",
          hls: true,
        },
      },
      playback.target
    );

    expect(playback.loadInputs[0]?.candidates).toEqual([
      { format: "hls", src: sourceUrl },
      {
        format: "hls",
        src: STREAM_PROXY_ROUTE + encodeURIComponent(sourceUrl),
      },
    ]);
  });

  test("honors an explicit stream format for extensionless HLS", async () => {
    const prepared = new PlaybackSourcePreparer(() => ({
      services: [
        {
          baseUrl: "https://hls.example",
          capabilities: ["hls"],
          enabled: true,
          kind: "stream-relay",
          name: "HLS",
        },
      ],
      version: 1,
    }));
    const playback = target();
    const sourceUrl = "https://radio.example/signed-stream";

    await prepared.load(
      { ...radio(sourceUrl), streamFormat: "hls" },
      playback.target
    );

    expect(playback.loadInputs[0]?.candidates).toEqual([
      { format: "hls", src: sourceUrl },
      {
        credentials: "omit",
        format: "hls",
        src: `https://hls.example/api/stream-proxy?url=${encodeURIComponent(sourceUrl)}`,
      },
      {
        format: "hls",
        src: STREAM_PROXY_ROUTE + encodeURIComponent(sourceUrl),
      },
    ]);
  });

  test("fails over Bandcamp through user relays before its app fallback", async () => {
    const prepared = new PlaybackSourcePreparer(() => ({
      services: [
        {
          baseUrl: "https://relay.example",
          capabilities: ["stream"],
          enabled: true,
          kind: "stream-relay",
          name: "Relay",
        },
      ],
      version: 1,
    }));
    const bandcamp = target();
    const bandcampUrl = "https://t4.bcbits.com/stream/example/mp3-128/1";

    await prepared.load(radio(bandcampUrl), bandcamp.target);

    expect(bandcamp.loadInputs[0]?.candidates).toEqual([
      { format: "progressive", src: bandcampUrl },
      {
        credentials: "omit",
        format: "progressive",
        src: `https://relay.example/api/stream-proxy?url=${encodeURIComponent(bandcampUrl)}`,
      },
      {
        format: "progressive",
        src: `/api/bandcamp-proxy?url=${encodeURIComponent(bandcampUrl)}`,
      },
    ]);
  });

  test("fails over progressive SoundCloud through user relays before its app fallback", async () => {
    const prepared = new PlaybackSourcePreparer(() => ({
      services: [
        {
          baseUrl: "https://relay.example",
          capabilities: ["stream"],
          enabled: true,
          kind: "stream-relay",
          name: "Relay",
        },
      ],
      version: 1,
    }));
    const soundCloud = target();
    const soundCloudUrl = "https://cf-media.sndcdn.com/example.128.mp3";

    await prepared.load(radio(soundCloudUrl), soundCloud.target);

    expect(soundCloud.loadInputs[0]?.candidates).toEqual([
      { format: "progressive", src: soundCloudUrl },
      {
        credentials: "omit",
        format: "progressive",
        src: `https://relay.example/api/stream-proxy?url=${encodeURIComponent(soundCloudUrl)}`,
      },
      {
        format: "progressive",
        src: `/api/soundcloud-proxy?url=${encodeURIComponent(soundCloudUrl)}`,
      },
    ]);
  });

  test("does not relay a YouTube provider's already-proxied media URL", async () => {
    const prepared = new PlaybackSourcePreparer(() => ({
      services: [
        {
          baseUrl: "https://relay.example",
          capabilities: ["stream"],
          enabled: true,
          kind: "stream-relay",
          name: "Relay",
        },
      ],
      version: 1,
    }));
    const playback = target();
    const streamUrl = "https://piped.example/proxy/audio?id=signed";

    await prepared.load(
      {
        name: "YouTube track",
        streamUrl,
        platformMetadata: {
          artist: "Artist",
          artwork: "",
          duration: 120,
          itemType: "video",
          name: "Track",
          platform: "youtube",
          streamUrl,
          url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
          videoId: "dQw4w9WgXcQ",
        },
      },
      playback.target
    );

    expect(playback.loadInputs[0]?.candidates).toEqual([
      { credentials: "omit", format: "progressive", src: streamUrl },
    ]);
  });

  test("does not send an insecure YouTube media URL directly from HTTPS", async () => {
    const originalLocation = Object.getOwnPropertyDescriptor(
      globalThis,
      "location"
    );
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("https://radio.example/app"),
    });

    try {
      const prepared = new PlaybackSourcePreparer(() => ({
        services: [
          {
            baseUrl: "https://relay.example",
            capabilities: ["stream"],
            enabled: true,
            kind: "stream-relay",
            name: "Relay",
          },
        ],
        version: 1,
      }));
      const playback = target();
      const streamUrl = "http://piped.example/proxy/audio?id=signed";

      await prepared.load(
        {
          name: "YouTube track",
          streamUrl,
          platformMetadata: {
            itemType: "video",
            platform: "youtube",
            url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
            videoId: "dQw4w9WgXcQ",
          },
        },
        playback.target
      );

      expect(playback.loadInputs[0]?.candidates).toEqual([
        {
          credentials: "omit",
          format: "progressive",
          src: `https://relay.example/api/stream-proxy?url=${encodeURIComponent(streamUrl)}`,
        },
        {
          format: "progressive",
          src: STREAM_PROXY_ROUTE + encodeURIComponent(streamUrl),
        },
      ]);
    } finally {
      if (originalLocation) {
        Object.defineProperty(globalThis, "location", originalLocation);
      } else {
        Reflect.deleteProperty(globalThis, "location");
      }
    }
  });

  test("passes the position through a single prepared refresh", async () => {
    const prepared = new PlaybackSourcePreparer();
    const playback = target();
    const sourceUrl = "https://radio.example/recording.mp3";

    await prepared.refresh(radio(sourceUrl), playback.target, 42.5);

    expect(playback.refreshInputs).toEqual([
      {
        input: {
          candidates: [
            { format: "progressive", src: sourceUrl },
            {
              format: "progressive",
              src: STREAM_PROXY_ROUTE + encodeURIComponent(sourceUrl),
            },
          ],
        },
        position: 42.5,
      },
    ]);
  });

  test("does not mutate the radio while preparing it", async () => {
    const prepared = new PlaybackSourcePreparer();
    const playback = target();
    const source = radio("https://radio.example/live.mp3");
    const original = structuredClone(source);

    await prepared.load(source, playback.target);

    expect(source).toEqual(original);
  });

  test("propagates the transport aggregate error without another load", async () => {
    const prepared = new PlaybackSourcePreparer();
    const sourceUrl = "https://user:secret@radio.example/live.mp3?token=hidden";
    const failure = new AggregateError(
      [new Error("Direct attempt failed"), new Error("Proxy attempt failed")],
      "Audio playback failed after all candidates"
    );
    let calls = 0;
    const playback = target({
      load: (input) => {
        calls += 1;
        expect(input.candidates).toHaveLength(2);
        return Promise.reject(failure);
      },
    });

    await expect(prepared.load(radio(sourceUrl), playback.target)).rejects.toBe(
      failure
    );
    expect(calls).toBe(1);
    expect(failure.errors).toHaveLength(2);
    expect(failure.message).not.toContain("secret");
    expect(failure.message).not.toContain("hidden");
  });
});
