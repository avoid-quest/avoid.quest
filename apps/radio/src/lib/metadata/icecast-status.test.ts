import { describe, expect, test } from "bun:test";
import { normalizeIcecastSource, selectIcecastSource } from "./icecast-status";

describe("Icecast status parsing", () => {
  test("normalizes a single source object", () => {
    const selected = selectIcecastSource(
      { icestats: { source: { bitrate: "128", title: "Artist - Title" } } },
      "https://radio.example/live"
    );

    expect(selected).not.toBeNull();
    const normalized = normalizeIcecastSource({
      expiresAt: 16_000,
      sampledAt: 1000,
      source: selected ?? {},
      streamUrl: "https://radio.example/live",
    });

    expect(normalized?.source).toBe("icecast-status-json");
    expect(normalized?.artist).toBe("Artist");
    expect(normalized?.title).toBe("Title");
    expect(normalized?.bitrate).toBe(128);
  });

  test("matches single source by mount path when path data is present", () => {
    const selected = selectIcecastSource(
      { icestats: { source: { mount: "/live", title: "Right" } } },
      "https://radio.example/live"
    );

    expect(selected?.title).toBe("Right");
  });

  test("does not use a single source with a different mount path", () => {
    const selected = selectIcecastSource(
      {
        icestats: {
          source: { listenurl: "https://radio.example/other", title: "Wrong" },
        },
      },
      "https://radio.example/live"
    );

    expect(selected).toBeNull();
  });

  test("matches array source by mount path", () => {
    const selected = selectIcecastSource(
      {
        icestats: {
          source: [
            { listenurl: "https://radio.example/other", title: "Wrong" },
            { listenurl: "https://radio.example/live", title: "Right" },
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
            { listenurl: "https://radio.example/other", title: "Wrong" },
          ],
        },
      },
      "https://radio.example/live"
    );

    expect(selected).toBeNull();
  });

  test("returns null when title is missing", () => {
    const normalized = normalizeIcecastSource({
      expiresAt: 16_000,
      sampledAt: 1000,
      source: { server_name: "Station" },
      streamUrl: "https://radio.example/live",
    });

    expect(normalized).toBeNull();
  });
});
