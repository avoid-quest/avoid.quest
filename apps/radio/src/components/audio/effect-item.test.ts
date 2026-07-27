import { describe, expect, test } from "bun:test";
import { createDefaultEffectConfig } from "@/lib/audio";
import { updateEffectInTree } from "@/lib/audio/dsp/routing/effect-tree";
import { createEffectResetPatch } from "./effect-item";

describe("effect reset", () => {
  test("clears optional sidechain state", () => {
    const effect = createDefaultEffectConfig("gate", "gate", 0);
    effect.sidechain = { channelId: "deck-b" };

    const [reset] = updateEffectInTree(
      [effect],
      effect.id,
      createEffectResetPatch(effect)
    );

    expect(reset?.sidechain).toBeUndefined();
  });
});
