import { describe, expect, test } from "bun:test";
import {
  getPublicKodiStations,
  KODI_DEFAULT_GROUP_TITLE,
  renderKodiM3uPlaylist,
} from "./kodi-playlist";
import type { Radio } from "./types";

describe("getPublicKodiStations", () => {
  test("keeps enabled public HTTP stations in stable order", () => {
    const radios: Radio[] = [
      {
        name: "Second Station",
        order: 2,
        streamUrl: "https://example.com/second.mp3",
      },
      {
        name: "First Station",
        order: 1,
        streamUrl: "https://example.com/first.mp3",
      },
    ];

    const stations = getPublicKodiStations(radios);

    expect(stations.map((station) => station.name)).toEqual([
      "First Station",
      "Second Station",
    ]);
    expect(stations[0]?.id).toBe("avoid-radio-first-station");
    expect(stations[0]?.groupTitle).toBe(KODI_DEFAULT_GROUP_TITLE);
  });

  test("filters disabled, private, and non-playable entries", () => {
    const radios: Radio[] = [
      {
        name: "Enabled",
        streamUrl: "https://example.com/live.aac",
      },
      {
        enabled: false,
        name: "Disabled",
        streamUrl: "https://example.com/disabled.mp3",
      },
      {
        name: "Local asset",
        streamUrl: "/audio/stream.mp3",
      },
      {
        name: "YouTube lazy token",
        streamUrl: "yt:dQw4w9WgXcQ",
      },
      {
        name: "Missing stream",
        streamUrl: " ",
      },
    ];

    const stations = getPublicKodiStations(radios);

    expect(stations).toHaveLength(1);
    expect(stations[0]?.name).toBe("Enabled");
  });

  test("keeps only public logo URLs", () => {
    const stations = getPublicKodiStations([
      {
        logoUrl: "https://example.com/logo.png",
        name: "With Logo",
        streamUrl: "https://example.com/live.mp3",
      },
      {
        logoUrl: "/logo.png",
        name: "Local Logo",
        streamUrl: "https://example.com/local.mp3",
      },
    ]);

    const withLogo = stations.find((station) => station.name === "With Logo");
    const localLogo = stations.find((station) => station.name === "Local Logo");

    expect(withLogo?.logoUrl).toBe("https://example.com/logo.png");
    expect(localLogo?.logoUrl).toBeUndefined();
  });
});

describe("renderKodiM3uPlaylist", () => {
  test("renders Kodi-compatible radio M3U with escaped attributes", () => {
    const playlist = renderKodiM3uPlaylist([
      {
        groupTitle: 'avoid "radio"',
        id: 'station-"one"',
        logoUrl: 'https://example.com/logo"one".png',
        name: 'Station "One"\nLive',
        order: 1,
        streamUrl: "https://example.com/live.m3u8",
      },
    ]);

    expect(playlist).toBe(
      [
        "#EXTM3U",
        '#EXTINF:-1 tvg-id="station-\'one\'" tvg-name="Station_\'One\'_Live" tvg-logo="https://example.com/logo\'one\'.png" group-title="avoid \'radio\'" radio="true",Station "One" Live',
        "https://example.com/live.m3u8",
        "",
      ].join("\n")
    );
  });
});
