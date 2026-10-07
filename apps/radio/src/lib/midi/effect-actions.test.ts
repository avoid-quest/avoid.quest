import { describe, expect, test } from "bun:test";
import { createDefaultEffectConfig } from "@/lib/audio/dsp/effects/registry";
import type { ChannelEffectsChange } from "@/lib/channel-effects";
import {
  createEffectMidiActions,
  type EffectChangeFactory,
} from "./effect-actions";

const eq = createDefaultEffectConfig("revamp", "eq", 0);

/** The patch a CC value sends to one of the deck's effect knobs. */
function patchFor(param: string, value: number): Record<string, unknown> {
  let change: ChannelEffectsChange | null = null;
  const actions = createEffectMidiActions({
    change: (factory: EffectChangeFactory) => {
      change = factory([eq]);
    },
    deckId: "deck-a",
    tree: [eq],
  });
  actions
    .find((action) => action.targetId === `deck-a:effect:eq:${param}`)
    ?.dispatch(value);
  return (change as { patch?: Record<string, unknown> } | null)?.patch ?? {};
}

describe("deck effect MIDI actions", () => {
  test("a frequency knob spreads by ratio, as its knob does", () => {
    expect(patchFor("midBellFrequency", 0.5).midBellFrequency).toBeCloseTo(
      Math.sqrt(20 * 20_000),
      6
    );
    expect(patchFor("midBellFrequency", 0).midBellFrequency).toBe(20);
    expect(patchFor("midBellFrequency", 1).midBellFrequency).toBe(20_000);
  });

  test("other knobs stay linear, and a value past 0..1 stays in range", () => {
    expect(patchFor("midBellGain", 0.5).midBellGain).toBeCloseTo(0, 6);
    expect(patchFor("midBellGain", 1.5).midBellGain).toBe(40);
    expect(patchFor("midBellFrequency", -0.5).midBellFrequency).toBe(20);
  });
});
