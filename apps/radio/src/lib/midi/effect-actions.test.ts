import { describe, expect, mock, test } from "bun:test";
import { createDefaultEffectConfig } from "@/lib/audio";
import { collectEffectActions } from "./effect-actions";

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
});
