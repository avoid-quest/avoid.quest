import type { Radio } from "@/lib/audio";
import type { SettingsRecord } from "@/lib/collections/settings";
import type { RadioNowPlaying } from "@/lib/metadata/types";

/*
 * Stable, offline Radio fixtures for Storybook. Stream URLs use the reserved
 * `.invalid` domain and stations carry no logo or metadata configuration, so
 * nothing is fetched or played.
 */

export const FIXTURE_STATION: Radio = {
  countryTitle: "United Kingdom",
  description: "Independent radio from London.",
  id: "storybook-station-harbour",
  name: "Harbour FM",
  placeTitle: "London",
  streamUrl: "https://harbour.streams.invalid/live.mp3",
};

export const FIXTURE_STATIONS: Radio[] = [
  FIXTURE_STATION,
  {
    countryTitle: "Germany",
    id: "storybook-station-kiez",
    name: "Kiez Radio",
    placeTitle: "Berlin",
    streamUrl: "https://kiez.streams.invalid/live.aac",
  },
  {
    description: "Ambient and drone, around the clock.",
    id: "storybook-station-drift",
    name: "Drift",
    streamUrl: "https://drift.streams.invalid/live.ogg",
  },
];

export const FIXTURE_NOW_PLAYING: RadioNowPlaying = {
  album: null,
  artist: "Lena Hart",
  artworkUrl: null,
  bitrate: 128,
  expiresAt: Date.parse("2026-10-20T13:00:00.000Z"),
  genre: "Electronic, Ambient",
  itemUrl: null,
  rawTitle: "Lena Hart - Low Tide",
  resolvedUrl: undefined,
  sampledAt: Date.parse("2026-10-20T12:00:00.000Z"),
  source: "icy",
  stationDescription: null,
  stationName: null,
  streamUrl: FIXTURE_STATION.streamUrl,
  title: "Low Tide",
};

export const FIXTURE_SETTINGS: SettingsRecord = {
  id: "app-settings",
  player: { mode: "single", restoreStateOnLoad: false },
};
