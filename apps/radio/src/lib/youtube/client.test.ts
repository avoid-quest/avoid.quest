import { describe, expect, mock, test } from "bun:test";
import {
  createConfiguredYouTubeClient,
  YouTubeProviderRequiredError,
} from "./client";

describe("configured YouTube client", () => {
  test("searches and resolves media through a configured browser provider", async () => {
    const fetchImpl = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search?")) {
        return Promise.resolve(
          Response.json({
            items: [
              {
                duration: 125,
                thumbnail: "https://media.example/thumb.jpg",
                title: "Browser Track",
                type: "stream",
                uploaderName: "Browser Artist",
                url: "/watch?v=abcdefghijk",
                views: 1200,
              },
            ],
          })
        );
      }
      if (url.endsWith("/streams/abcdefghijk")) {
        return Promise.resolve(
          Response.json({
            audioStreams: [
              {
                bitrate: 128_000,
                codec: "opus",
                mimeType: "audio/webm",
                url: "https://media.example/audio.webm",
              },
            ],
            duration: 125,
            livestream: false,
            thumbnailUrl: "https://media.example/thumb.jpg",
            title: "Browser Track",
            uploader: "Browser Artist",
          })
        );
      }
      return Promise.reject(new Error(`Unexpected provider request: ${url}`));
    });
    const client = createConfiguredYouTubeClient(
      {
        services: [
          {
            baseUrl: "https://piped.example",
            enabled: true,
            id: "piped-browser",
            kind: "piped",
            name: "Browser Piped",
          },
        ],
        version: 1,
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, verifyMedia: false }
    );

    await expect(client.search("ambient", "songs")).resolves.toEqual([
      {
        author: "Browser Artist",
        duration: 125,
        thumbnail: "https://media.example/thumb.jpg",
        title: "Browser Track",
        videoId: "abcdefghijk",
        views: "1.2K views",
      },
    ]);
    await expect(
      client.resolveItem("https://youtube.com/watch?v=abcdefghijk")
    ).resolves.toMatchObject({
      metadata: {
        artist: "Browser Artist",
        name: "Browser Track",
        platform: "youtube",
        videoId: "abcdefghijk",
      },
      streamUrl: "https://media.example/audio.webm",
      success: true,
    });
    await expect(client.resolveStream("abcdefghijk")).resolves.toBe(
      "https://media.example/audio.webm"
    );
  });

  test("keeps enabled providers in configured order", () => {
    const client = createConfiguredYouTubeClient({
      services: [
        {
          baseUrl: "https://one.example",
          enabled: true,
          id: "piped-one",
          kind: "piped",
          name: "One",
        },
        {
          baseUrl: "https://disabled.example",
          enabled: false,
          id: "disabled",
          kind: "invidious",
          name: "Disabled",
        },
        {
          baseUrl: "https://two.example",
          enabled: true,
          id: "invidious-two",
          kind: "invidious",
          name: "Two",
        },
      ],
      version: 1,
    });

    expect(client.providers.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "piped-one", kind: "piped" },
      { id: "invidious-two", kind: "invidious" },
    ]);
  });

  test("requires at least one enabled provider", () => {
    expect(() =>
      createConfiguredYouTubeClient({ services: [], version: 1 })
    ).toThrow(YouTubeProviderRequiredError);
  });
});
