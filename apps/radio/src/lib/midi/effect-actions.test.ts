import { describe, expect, mock, test } from "bun:test";
import { createDefaultEffectConfig } from "@/lib/audio";
import { collectEffectActions, collectEffectIds } from "./effect-actions";

describe("effect MIDI actions", () => {
  test("reads the current effect tree when an action is dispatched", () => {
    const registered = createDefaultEffectConfig("limiter", "limiter", 0);
    registered.enabled = false;
    const current = { ...registered, enabled: true };
    const update = mock(() => undefined);
    const actions = collectEffectActions(
      registered,
      "deck-a:effect:limiter",
      "deck-a-effects",
      () => current,
      update
    );

    actions.find(({ targetId }) => targetId.endsWith(":enabled"))?.dispatch(1);

    expect(update).toHaveBeenCalledWith("limiter", { enabled: false });
  });

  test("tracks nested effect IDs for mapping cleanup", () => {
    const container = createDefaultEffectConfig("fxComposite", "root", 0);
    const nested = createDefaultEffectConfig("limiter", "nested", 0);
    const firstChain = container.chains[0];
    if (!firstChain) {
      throw new Error("Default FX Composite must contain a chain");
    }
    firstChain.effects = [nested];

    expect(collectEffectIds([container])).toEqual(new Set(["root", "nested"]));
  });
});
