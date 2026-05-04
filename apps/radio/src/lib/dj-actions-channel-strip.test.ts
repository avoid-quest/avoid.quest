import { describe, expect, mock, test } from "bun:test";
import type { AudioManager, EffectConfig, FilterConfig } from "@/lib/audio";
import { createDefaultEffectConfig } from "@/lib/audio";
import { applyStoredEffectsAndFilters } from "./dj-actions-channel-strip";

const defaultFilter: FilterConfig = {
  enabled: false,
  type: "lowpass",
  frequency: 20_000,
  Q: Math.SQRT1_2,
  gain: 0,
};

describe("dj channel strip stored effect replay", () => {
  test("waits for explicit WorkletManager readiness before applying effects", async () => {
    const effect = createDefaultEffectConfig("delay", "delay-1", 0);
    const calls: string[] = [];
    const audioManager = {
      getWorkletManager: mock(() => null),
      ensureEffectsReady: mock((_soundId: string) => {
        calls.push("ready");
        return Promise.resolve(true);
      }),
      updateFilter: mock((_soundId: string, _filter: FilterConfig) => {
        calls.push("filter");
      }),
      addEffect: mock((_soundId: string, _effect: EffectConfig) => {
        calls.push("effect");
        return true;
      }),
    } as unknown as AudioManager;

    await applyStoredEffectsAndFilters(
      audioManager,
      "sound-1",
      [effect],
      defaultFilter
    );

    expect(audioManager.ensureEffectsReady).toHaveBeenCalledWith("sound-1");
    expect(audioManager.addEffect).toHaveBeenCalledWith("sound-1", effect);
    expect(calls).toEqual(["ready", "effect"]);
  });

  test("does not apply stored effects when worklet readiness fails", async () => {
    const effect = createDefaultEffectConfig("delay", "delay-1", 0);
    const audioManager = {
      getWorkletManager: mock(() => ({ isReady: false })),
      ensureEffectsReady: mock(async () => false),
      updateFilter: mock(() => undefined),
      addEffect: mock(() => true),
    } as unknown as AudioManager;

    await applyStoredEffectsAndFilters(
      audioManager,
      "sound-1",
      [effect],
      defaultFilter
    );

    expect(audioManager.addEffect).not.toHaveBeenCalled();
    expect(audioManager.updateFilter).not.toHaveBeenCalled();
  });

  test("replays stored effects by persisted order", async () => {
    const delay = createDefaultEffectConfig("delay", "delay-1", 2);
    const limiter = createDefaultEffectConfig("limiter", "limiter-1", 0);
    const crusher = createDefaultEffectConfig("crusher", "crusher-1", 1);
    const appliedEffectIds: string[] = [];
    const audioManager = {
      getWorkletManager: mock(() => ({ isReady: true })),
      ensureEffectsReady: mock(async () => true),
      updateFilter: mock(() => undefined),
      addEffect: mock((_soundId: string, effect: EffectConfig) => {
        appliedEffectIds.push(effect.id);
        return true;
      }),
    } as unknown as AudioManager;

    await applyStoredEffectsAndFilters(
      audioManager,
      "sound-1",
      [delay, limiter, crusher],
      defaultFilter
    );

    expect(appliedEffectIds).toEqual(["limiter-1", "crusher-1", "delay-1"]);
  });
});
