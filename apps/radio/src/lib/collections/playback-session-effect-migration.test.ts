import { describe, expect, test } from "bun:test";
import {
  MAX_EFFECT_TEMPO,
  MIN_EFFECT_TEMPO,
} from "@/lib/audio/dsp/effects/tempo";
import { DEFAULT_EFFECT_TEMPO } from "@/lib/audio/dsp/routing/effect-tree";
import { parsePlaybackSessionRecord } from "./playback-sessions";

function channelWithEffects(effects: unknown[]) {
  return {
    channelFilter: 0,
    effects,
    effectsDryWet: 1,
    filter: {
      enabled: false,
      frequency: 1000,
      gain: 0,
      Q: 1,
      type: "lowpass",
    },
    id: "deck-a",
    muted: false,
    pan: 0,
    radio: null,
    role: "deck-a",
    speed: 1,
    volume: 1,
  };
}

function baseEffect(id: string, type: string, order: number) {
  return {
    dryWet: 1,
    enabled: true,
    id,
    inputGain: 1,
    order,
    outputGain: 1,
    type,
  };
}

describe("playback session effect migration", () => {
  test("clamps persisted tempo to the product-supported range", () => {
    const session = {
      channels: [channelWithEffects([])],
      id: "dj",
    };

    expect(parsePlaybackSessionRecord({ ...session, tempo: 1 }).tempo).toBe(
      MIN_EFFECT_TEMPO
    );
    expect(parsePlaybackSessionRecord({ ...session, tempo: 2000 }).tempo).toBe(
      MAX_EFFECT_TEMPO
    );
  });

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
      channels: [channelWithEffects(legacyEffects)],
      id: "dj",
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
      cross: 0,
      crossFeedback: 0,
      delayMillis: 250,
      delayMusical: "Off",
      tempoDivision: "1/4",
      tempoSync: false,
    });
  });

  test("derives native parameters from legacy delay, tidal, and compressor settings", () => {
    const migrated = parsePlaybackSessionRecord({
      channels: [
        channelWithEffects([
          {
            ...baseEffect("delay", "delay", 0),
            delayTime: 0.625,
            feedback: 0.4,
          },
          {
            ...baseEffect("tidal", "tidal", 1),
            channelOffset: 0,
            depth: 0.5,
            offset: 0,
            rate: 1,
            slope: 0,
            symmetry: 0,
          },
          {
            ...baseEffect("compressor", "compressor", 2),
            attack: 4,
            autoAttack: true,
            autoMakeup: false,
            autoRelease: false,
            knee: 5,
            lookahead: true,
            makeup: 2,
            mix: 0.75,
            ratio: 3,
            release: 180,
            threshold: -20,
          },
        ]),
      ],
      id: "dj",
    });

    expect(migrated.channels[0]?.effects).toMatchObject([
      { cross: 0, delayMillis: 625, delayMusical: "Off" },
      { rateDivision: "1/2" },
      { autoattack: true, automakeup: false, autorelease: false },
    ]);
  });

  test("migrates legacy plate pre-delay samples without re-migrating milliseconds", () => {
    const migrated = parsePlaybackSessionRecord({
      channels: [
        channelWithEffects([
          {
            ...baseEffect("legacy-plate", "plateReverb", 0),
            preDelay: 4800,
          },
          {
            ...baseEffect("current-plate", "plateReverb", 1),
            preDelayMillis: 125,
          },
        ]),
      ],
      id: "dj",
    });

    expect(migrated.channels[0]?.effects).toMatchObject([
      { preDelayMillis: 100 },
      { preDelayMillis: 125 },
    ]);
    expect(migrated.channels[0]?.effects[0]).not.toHaveProperty("preDelay");
  });

  test("round-trips nested routing, sidechains, and tempo through JSON", () => {
    const nestedSession = {
      channels: [
        channelWithEffects([
          {
            ...baseEffect("parallel", "fxComposite", 0),
            chains: [
              {
                effects: [
                  {
                    ...baseEffect("gate", "gate", 0),
                    attack: 5,
                    floor: -80,
                    hold: 20,
                    inverse: false,
                    release: 120,
                    sidechain: { channelId: "deck-b" },
                    threshold: -24,
                  },
                ],
                gain: 0.75,
                id: "parallel-a",
                muted: false,
                name: "Parallel A",
                order: 0,
                pan: -0.25,
                solo: true,
              },
            ],
          },
        ]),
      ],
      id: "dj",
      tempo: 128,
    };

    const parsed = parsePlaybackSessionRecord(nestedSession);
    const roundTripped = parsePlaybackSessionRecord(
      JSON.parse(JSON.stringify(parsed))
    );

    expect(roundTripped).toEqual(parsed);
    expect(roundTripped.tempo).toBe(128);
    expect(roundTripped.channels[0]?.effects[0]).toMatchObject({
      chains: [
        {
          effects: [
            {
              id: "gate",
              sidechain: { channelId: "deck-b" },
            },
          ],
          id: "parallel-a",
        },
      ],
      id: "parallel",
      type: "fxComposite",
    });
  });

  test("rejects malformed containers instead of silently dropping children", () => {
    expect(() =>
      parsePlaybackSessionRecord({
        channels: [
          channelWithEffects([
            baseEffect("missing-children", "frequencySplit", 0),
          ]),
        ],
        id: "dj",
      })
    ).toThrow();
  });
});
