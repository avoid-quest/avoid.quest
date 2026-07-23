import { describe, expect, test } from "bun:test";
import { DEFAULT_EFFECT_TEMPO } from "@/lib/audio/dsp/routing/effect-tree";
import { parsePlaybackSessionRecord } from "./playback-sessions";

function channelWithEffects(effects: unknown[]) {
  return {
    id: "deck-a",
    role: "deck-a",
    radio: null,
    volume: 1,
    muted: false,
    pan: 0,
    speed: 1,
    channelFilter: 0,
    effects,
    filter: {
      type: "lowpass",
      frequency: 1000,
      Q: 1,
      gain: 0,
      enabled: false,
    },
    effectsDryWet: 1,
  };
}

function baseEffect(id: string, type: string, order: number) {
  return {
    id,
    type,
    enabled: true,
    order,
    dryWet: 1,
    inputGain: 1,
    outputGain: 1,
  };
}

describe("playback session effect migration", () => {
  test("adds tempo without dropping legacy radio effects or parameters", () => {
    const legacyEffects = [
      {
        ...baseEffect("delay", "delay", 3),
        delayTime: 0.25,
        feedback: 0.4,
      },
      {
        ...baseEffect("pitch", "pitchShifter", 0),
        pitchFactor: 1.25,
      },
      {
        ...baseEffect("distortion", "distortion", 1),
        amount: 2,
        oversample: "2x",
      },
      {
        ...baseEffect("limiter", "limiter", 2),
        threshold: -3,
      },
    ];

    const migrated = parsePlaybackSessionRecord({
      id: "dj",
      channels: [channelWithEffects(legacyEffects)],
    });

    expect(migrated.tempo).toBe(DEFAULT_EFFECT_TEMPO);
    expect(migrated.channels[0]?.effects.map(({ id }) => id)).toEqual([
      "pitch",
      "distortion",
      "limiter",
      "delay",
    ]);
    expect(migrated.channels[0]?.effects).toMatchObject([
      { ...legacyEffects[1], order: 0 },
      { ...legacyEffects[2], order: 1 },
      { ...legacyEffects[3], order: 2 },
      { ...legacyEffects[0], order: 3 },
    ] as Record<string, unknown>[]);
    expect(migrated.channels[0]?.effects[3]).toMatchObject({
      tempoSync: false,
      tempoDivision: "1/4",
      crossFeedback: 0,
    });
  });

  test("round-trips nested routing, sidechains, and tempo through JSON", () => {
    const nestedSession = {
      id: "dj",
      tempo: 128,
      channels: [
        channelWithEffects([
          {
            ...baseEffect("parallel", "fxComposite", 0),
            chains: [
              {
                id: "parallel-a",
                name: "Parallel A",
                order: 0,
                gain: 0.75,
                pan: -0.25,
                muted: false,
                solo: true,
                effects: [
                  {
                    ...baseEffect("gate", "gate", 0),
                    sidechain: { channelId: "deck-b" },
                    threshold: -24,
                    attack: 5,
                    hold: 20,
                    release: 120,
                    floor: -80,
                    inverse: false,
                  },
                ],
              },
            ],
          },
        ]),
      ],
    };

    const parsed = parsePlaybackSessionRecord(nestedSession);
    const roundTripped = parsePlaybackSessionRecord(
      JSON.parse(JSON.stringify(parsed))
    );

    expect(roundTripped).toEqual(parsed);
    expect(roundTripped.tempo).toBe(128);
    expect(roundTripped.channels[0]?.effects[0]).toMatchObject({
      id: "parallel",
      type: "fxComposite",
      chains: [
        {
          id: "parallel-a",
          effects: [
            {
              id: "gate",
              sidechain: { channelId: "deck-b" },
            },
          ],
        },
      ],
    });
  });

  test("rejects malformed containers instead of silently dropping children", () => {
    expect(() =>
      parsePlaybackSessionRecord({
        id: "dj",
        channels: [
          channelWithEffects([
            baseEffect("missing-children", "frequencySplit", 0),
          ]),
        ],
      })
    ).toThrow();
  });
});
