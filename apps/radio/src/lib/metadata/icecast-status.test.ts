import { describe, expect, test } from "bun:test";
import { normalizeIcecastSource, selectIcecastSource } from "./icecast-status";

describe("Icecast status parsing", () => {
  test("normalizes a single source object", () => {
    const selected = selectIcecastSource(
      { icestats: { source: { title: "Artist - Title", bitrate: "128" } } },
      "https://radio.example/live"
    );

    expect(selected).not.toBeNull();
    const normalized = normalizeIcecastSource({
      source: selected ?? {},
      streamUrl: "https://radio.example/live",
      sampledAt: 1000,
      expiresAt: 16_000,
    });

    expect(normalized?.source).toBe("icecast-status-json");
    expect(normalized?.artist).toBe("Artist");
    expect(normalized?.title).toBe("Title");
    expect(normalized?.bitrate).toBe(128);
  });

  test("matches array source by mount path", () => {
    const selected = selectIcecastSource(
      {
        icestats: {
          source: [
            { title: "Wrong", listenurl: "https://radio.example/other" },
            { title: "Right", listenurl: "https://radio.example/live" },
          ],
        },
      },
      "https://radio.example/live"
    );

    expect(selected?.title).toBe("Right");
  });

  test("does not use another mount when no array source matches", () => {
    const selected = selectIcecastSource(
      {
        icestats: {
          source: [
            { title: "Wrong", listenurl: "https://radio.example/other" },
          ],
        },
      },
      "https://radio.example/live"
    );

    expect(selected).toBeNull();
  });

  test("returns null when title is missing", () => {
    const normalized = normalizeIcecastSource({
      source: { server_name: "Station" },
      streamUrl: "https://radio.example/live",
      sampledAt: 1000,
      expiresAt: 16_000,
    });

    expect(normalized).toBeNull();
  });
});
