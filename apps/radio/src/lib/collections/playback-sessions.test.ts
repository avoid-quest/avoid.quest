import { describe, expect, test } from "bun:test";
import {
  buildDjSessionFromLegacyState,
  buildMultipleSessionFromRadios,
  buildSingleSessionFromLegacyState,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  SINGLE_ACTIVE_CHANNEL_ID,
} from "./playback-sessions";

describe("buildSingleSessionFromLegacyState", () => {
  test("maps legacy single radio and volume onto the active hidden channel", () => {
    const radio = {
      id: "radio-1",
      name: "Legacy FM",
      streamUrl: "https://radio.example/live.mp3",
    };

    const session = buildSingleSessionFromLegacyState({
      radio,
      volume: 0.42,
    });

    expect(session.id).toBe("single");
    expect(session.activeChannelId).toBe(SINGLE_ACTIVE_CHANNEL_ID);
    expect(session.channels).toHaveLength(2);
    expect(session.channels[0]?.radio).toEqual(radio);
    expect(session.channels[0]?.volume).toBe(0.42);
    expect(session.channels[1]?.radio).toBeNull();
  });

  test("falls back to an empty session when legacy data is missing", () => {
    const session = buildSingleSessionFromLegacyState();

    expect(session.activeChannelId).toBeNull();
    expect(session.channels[0]?.radio).toBeNull();
    expect(session.channels[0]?.volume).toBe(1);
  });
});

describe("buildDjSessionFromLegacyState", () => {
  test("preserves deck assignment and mixer values from legacy dj state", () => {
    const deckARadio = {
      id: "deck-a-radio",
      name: "Deck A",
      streamUrl: "https://radio.example/deck-a.mp3",
    };
    const deckBRadio = {
      id: "deck-b-radio",
      name: "Deck B",
      streamUrl: "https://radio.example/deck-b.mp3",
    };

    const session = buildDjSessionFromLegacyState({
      legacyDecks: [
        {
          id: DECK_A_CHANNEL_ID,
          radio: deckARadio,
          volume: 0.7,
          pan: -0.25,
          speed: 1.1,
        },
        {
          id: DECK_B_CHANNEL_ID,
          radio: deckBRadio,
          volume: 0.9,
          muted: true,
        },
      ],
      legacyMixer: {
        crossfadePosition: 0.2,
        masterVolume: 0.8,
        headphoneVolume: 0.6,
        deckACueEnabled: true,
        deckBCueEnabled: false,
      },
    });

    const deckA = session.channels.find((channel) => channel.id === "deck-a");
    const deckB = session.channels.find((channel) => channel.id === "deck-b");

    expect(session.id).toBe("dj");
    expect(session.crossfadePosition).toBe(0.2);
    expect(session.masterVolume).toBe(0.8);
    expect(session.headphoneVolume).toBe(0.6);
    expect(deckA?.radio).toEqual(deckARadio);
    expect(deckA?.volume).toBe(0.7);
    expect(deckA?.pan).toBe(-0.25);
    expect(deckA?.speed).toBe(1.1);
    expect(deckA?.cueEnabled).toBe(true);
    expect(deckB?.radio).toEqual(deckBRadio);
    expect(deckB?.volume).toBe(0.9);
    expect(deckB?.muted).toBe(true);
    expect(deckB?.cueEnabled).toBe(false);
  });
});

describe("buildMultipleSessionFromRadios", () => {
  test("creates one multiple-mode channel per enabled radio in order", () => {
    const session = buildMultipleSessionFromRadios([
      {
        id: "radio-2",
        name: "Disabled",
        streamUrl: "https://radio.example/disabled.mp3",
        enabled: false,
        order: 0,
      },
      {
        id: "radio-3",
        name: "Second",
        streamUrl: "https://radio.example/second.mp3",
        enabled: true,
        order: 2,
      },
      {
        id: "radio-1",
        name: "First",
        streamUrl: "https://radio.example/first.mp3",
        enabled: true,
        order: 1,
      },
    ]);

    expect(session.id).toBe("multiple");
    expect(session.channels.map((channel) => channel.radio?.name)).toEqual([
      "First",
      "Second",
    ]);
    expect(session.channels.map((channel) => channel.id)).toEqual([
      "multi:radio-1",
      "multi:radio-3",
    ]);
  });
});
