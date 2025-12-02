import type { EffectConfig, FilterConfig } from "@avoid.quest/radio-audio";
import { createDefaultEffectConfig } from "@avoid.quest/radio-audio";
import type { StateCreator } from "zustand";
import { getAudioManager } from "./audio-manager-helpers";
import type { InternalDjState } from "./types";

export const createEffectsActions: StateCreator<
  InternalDjState,
  [],
  [],
  Pick<
    InternalDjState,
    | "updateLeftFilter"
    | "updateRightFilter"
    | "addLeftEffect"
    | "addRightEffect"
    | "updateLeftEffect"
    | "updateRightEffect"
    | "removeLeftEffect"
    | "removeRightEffect"
    | "reorderLeftEffects"
    | "reorderRightEffects"
  >
> = (set, get) => ({
  updateLeftFilter: (config: FilterConfig) => {
    const { leftDeck } = get();
    set((state) => ({
      leftDeck: { ...state.leftDeck, filter: config },
    }));
    if (leftDeck.soundId) {
      getAudioManager().updateFilter(leftDeck.soundId, config);
    }
  },

  updateRightFilter: (config: FilterConfig) => {
    const { rightDeck } = get();
    set((state) => ({
      rightDeck: { ...state.rightDeck, filter: config },
    }));
    if (rightDeck.soundId) {
      getAudioManager().updateFilter(rightDeck.soundId, config);
    }
  },

  addLeftEffect: (effectType: string) => {
    const { leftDeck } = get();

    const newEffect = createDefaultEffectConfig(
      effectType as EffectConfig["type"],
      `effect_${Date.now()}_${Math.random()}`,
      leftDeck.effects.length
    );

    set((state) => ({
      leftDeck: {
        ...state.leftDeck,
        effects: [...state.leftDeck.effects, newEffect],
      },
    }));

    // Apply effect immediately if sound is loaded
    if (leftDeck.soundId) {
      getAudioManager().addEffect(leftDeck.soundId, newEffect);
    }
  },

  addRightEffect: (effectType: string) => {
    const { rightDeck } = get();

    const newEffect = createDefaultEffectConfig(
      effectType as EffectConfig["type"],
      `effect_${Date.now()}_${Math.random()}`,
      rightDeck.effects.length
    );

    set((state) => ({
      rightDeck: {
        ...state.rightDeck,
        effects: [...state.rightDeck.effects, newEffect],
      },
    }));

    // Apply effect immediately if sound is loaded
    if (rightDeck.soundId) {
      getAudioManager().addEffect(rightDeck.soundId, newEffect);
    }
  },

  updateLeftEffect: (effectId: string, config: Partial<EffectConfig>) => {
    const { leftDeck } = get();

    set((state) => ({
      leftDeck: {
        ...state.leftDeck,
        effects: state.leftDeck.effects.map((e) =>
          e.id === effectId ? ({ ...e, ...config } as EffectConfig) : e
        ),
      },
    }));

    // Apply effect update immediately if sound is loaded
    if (leftDeck.soundId) {
      getAudioManager().updateEffect(leftDeck.soundId, effectId, config);
    }
  },

  updateRightEffect: (effectId: string, config: Partial<EffectConfig>) => {
    const { rightDeck } = get();

    set((state) => ({
      rightDeck: {
        ...state.rightDeck,
        effects: state.rightDeck.effects.map((e) =>
          e.id === effectId ? ({ ...e, ...config } as EffectConfig) : e
        ),
      },
    }));

    // Apply effect update immediately if sound is loaded
    if (rightDeck.soundId) {
      getAudioManager().updateEffect(rightDeck.soundId, effectId, config);
    }
  },

  removeLeftEffect: (effectId: string) => {
    const { leftDeck } = get();

    set((state) => ({
      leftDeck: {
        ...state.leftDeck,
        effects: state.leftDeck.effects
          .filter((e) => e.id !== effectId)
          .map((e, i) => ({ ...e, order: i })),
      },
    }));

    // Apply removal immediately if sound is loaded
    if (leftDeck.soundId) {
      getAudioManager().removeEffect(leftDeck.soundId, effectId);
    }
  },

  removeRightEffect: (effectId: string) => {
    const { rightDeck } = get();

    set((state) => ({
      rightDeck: {
        ...state.rightDeck,
        effects: state.rightDeck.effects
          .filter((e) => e.id !== effectId)
          .map((e, i) => ({ ...e, order: i })),
      },
    }));

    // Apply removal immediately if sound is loaded
    if (rightDeck.soundId) {
      getAudioManager().removeEffect(rightDeck.soundId, effectId);
    }
  },

  reorderLeftEffects: (effectIds: string[]) => {
    const { leftDeck } = get();

    set((state) => ({
      leftDeck: {
        ...state.leftDeck,
        effects: effectIds
          .map((id) => state.leftDeck.effects.find((e) => e.id === id))
          .filter((e): e is EffectConfig => !!e),
      },
    }));

    // Apply reordering immediately if sound is loaded
    if (leftDeck.soundId) {
      getAudioManager().reorderEffects(leftDeck.soundId, effectIds);
    }
  },

  reorderRightEffects: (effectIds: string[]) => {
    const { rightDeck } = get();

    set((state) => ({
      rightDeck: {
        ...state.rightDeck,
        effects: effectIds
          .map((id) => state.rightDeck.effects.find((e) => e.id === id))
          .filter((e): e is EffectConfig => !!e),
      },
    }));

    // Apply reordering immediately if sound is loaded
    if (rightDeck.soundId) {
      getAudioManager().reorderEffects(rightDeck.soundId, effectIds);
    }
  },
});
