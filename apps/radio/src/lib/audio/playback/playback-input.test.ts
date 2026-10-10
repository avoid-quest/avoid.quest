import { describe, expect, test } from "bun:test";
import { toPlaybackInput } from "./playback-input";

describe("toPlaybackInput", () => {
  test("live metadata takes precedence over source-node provenance", () => {
    const radio = {
      name: "Source",
      streamUrl: "https://radio.example/live.mp3",
    };
    expect(toPlaybackInput(radio).live).toBe(true);
    expect(toPlaybackInput(radio, "station").live).toBe(true);
    expect(toPlaybackInput(radio, "media").live).toBeUndefined();
    expect(
      toPlaybackInput(
        {
          ...radio,
          platformMetadata: {
            hls: false,
            itemType: "station",
            platform: "radio-browser",
            stationUuid: "station",
            url: radio.streamUrl,
          },
        },
        "media"
      ).live
    ).toBe(true);
    expect(
      toPlaybackInput(
        {
          ...radio,
          platformMetadata: {
            itemType: "track",
            platform: "soundcloud",
            url: "https://soundcloud.com/artist/track",
          },
        },
        "station"
      ).live
    ).toBeUndefined();
  });

  test("upgrades the retired Sygma Ogg mount to its current MP3 stream", () => {
    expect(
      toPlaybackInput({
        name: "Sygma Radio",
        streamUrl: "https://radio.syg.ma/audio.ogg",
      })
    ).toMatchObject({ src: "https://radio.syg.ma/audio.mp3" });
  });

  test("upgrades persisted NTS relay URLs to Web Audio compatible sources", () => {
    expect(
      toPlaybackInput({
        name: "NTS 1",
        streamUrl: "https://stream-relay-geo.ntslive.net/stream",
      })
    ).toMatchObject({ src: "https://streams.radiomast.io/nts1" });
    expect(
      toPlaybackInput({
        name: "NTS 2",
        streamUrl: "https://stream-relay-geo.ntslive.net/stream2",
      })
    ).toMatchObject({ src: "https://streams.radiomast.io/nts2" });
    expect(
      toPlaybackInput({
        name: "Lookalike",
        streamUrl:
          "https://example.com/https://stream-relay-geo.ntslive.net/stream",
      })
    ).toMatchObject({
      src: "https://example.com/https://stream-relay-geo.ntslive.net/stream",
    });
  });

  test("routes Radio BlackOut through its same-origin Web Audio stream", () => {
    for (const streamUrl of [
      "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
      "https://s.streampunk.cc/blackout.mp3",
      "https://seep.eu.org/https://s.streampunk.cc/blackout.mp3",
      "https://proxy.cors.sh/https://s.streampunk.cc/blackout.mp3",
    ]) {
      expect(
        toPlaybackInput({
          name: "Radio BlackOut",
          streamUrl,
        })
      ).toMatchObject({ src: "/api/radio-blackout-stream" });
    }
    expect(
      toPlaybackInput({
        name: "Lookalike",
        streamUrl: "https://example.com/https://s.streampunk.cc/blackout.mp3",
      })
    ).toMatchObject({
      src: "https://example.com/https://s.streampunk.cc/blackout.mp3",
    });
  });

  test("uses the resolved URL as the only playback source", () => {
    expect(
      toPlaybackInput({
        id: "radio",
        name: "Radio",
        streamUrl: "https://radio.example/live",
      })
    ).toEqual({
      format: "progressive",
      live: true,
      src: "https://radio.example/live",
    });
  });

  test("preserves explicit HLS format and omits credentials for YouTube", () => {
    expect(
      toPlaybackInput({
        id: "youtube",
        name: "YouTube",
        platformMetadata: {
          itemType: "video",
          name: "Track",
          platform: "youtube",
          url: "https://youtube.com/watch?v=abcdefghijk",
          videoId: "abcdefghijk",
        },
        streamFormat: "hls",
        streamUrl: "https://provider.example/audio",
      })
    ).toEqual({
      credentials: "omit",
      format: "hls",
      src: "https://provider.example/audio",
    });
  });

  test("omits credentials for a Spotify track's YouTube stream", () => {
    expect(
      toPlaybackInput({
        name: "Get Lucky",
        platformMetadata: {
          itemType: "track",
          platform: "spotify",
          spotifyId: "2Foc5Q5nqNiosCNqttzHof",
          url: "https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof",
          youtubeVideoId: "Rgrt_8mXrK8",
        },
        streamUrl: "https://provider.example/videoplayback?expire=1",
      })
    ).toMatchObject({ credentials: "omit" });
  });

  test("allows native HLS only for curated or allowlisted sources", () => {
    expect(
      toPlaybackInput({
        name: "Same-origin HLS",
        streamFormat: "hls",
        streamUrl: "/audio/live.m3u8",
      })
    ).toMatchObject({ allowNativeHls: true });
    expect(
      toPlaybackInput({
        name: "SoundCloud HLS",
        platformMetadata: {
          itemType: "track",
          platform: "soundcloud",
          url: "https://soundcloud.com/artist/track",
        },
        streamFormat: "hls",
        streamUrl: "https://cf-hls-media.sndcdn.com/live.m3u8",
      })
    ).toMatchObject({ allowNativeHls: true });
    const mixcloud = {
      itemType: "show" as const,
      platform: "mixcloud" as const,
      url: "https://www.mixcloud.com/dholbach/cryptkeeper/",
    };
    expect(
      toPlaybackInput({
        name: "Mixcloud HLS",
        platformMetadata: mixcloud,
        streamFormat: "hls",
        streamUrl:
          "https://aod.mixcloud.stream/secure/hls/6/f/c/d/a.m4a/index.m3u8",
      })
    ).toMatchObject({ allowNativeHls: true });
    expect(
      toPlaybackInput({
        name: "Spoofed Mixcloud HLS",
        platformMetadata: mixcloud,
        streamFormat: "hls",
        streamUrl: "https://unknown.example/live.m3u8",
      })
    ).not.toHaveProperty("allowNativeHls");
    expect(
      toPlaybackInput({
        name: "Untrusted HLS",
        streamFormat: "hls",
        streamUrl: "https://unknown.example/live.m3u8",
      })
    ).not.toHaveProperty("allowNativeHls");
    expect(
      toPlaybackInput({
        name: "Spoofed SoundCloud HLS",
        platformMetadata: {
          itemType: "track",
          platform: "soundcloud",
          url: "https://soundcloud.com/artist/track",
        },
        streamFormat: "hls",
        streamUrl: "https://unknown.example/live.m3u8",
      })
    ).not.toHaveProperty("allowNativeHls");
    expect(
      toPlaybackInput({
        name: "Scheme-relative HLS",
        streamFormat: "hls",
        streamUrl: "//unknown.example/live.m3u8",
      })
    ).not.toHaveProperty("allowNativeHls");
    expect(
      toPlaybackInput({
        name: "Control-character HLS",
        streamFormat: "hls",
        streamUrl: "/\n/unknown.example/live.m3u8",
      })
    ).not.toHaveProperty("allowNativeHls");
  });
});
