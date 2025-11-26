import type { StateCreator } from "zustand";
import type { FilterConfig } from "@/components/audio/filter-control";
import { createDefaultEffectConfig } from "@/lib/audio/effects/registry";
import type { EffectConfig } from "@/lib/audio/effects/types";
import { getAudioManager } from "./audio-manager-helpers";
import type { DjState } from "./types";

export const createEffectsActions: StateCreator<
  DjState,
  [],
  [],
  Pick<
    DjState,
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
    if (!leftDeck.soundId) {
      return;
    }

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
    getAudioManager().addEffect(leftDeck.soundId, newEffect);
  },

  addRightEffect: (effectType: string) => {
    const { rightDeck } = get();
    if (!rightDeck.soundId) {
      return;
    }

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
    getAudioManager().addEffect(rightDeck.soundId, newEffect);
  },

  updateLeftEffect: (effectId: string, config: Partial<EffectConfig>) => {
    const { leftDeck } = get();
    if (!leftDeck.soundId) {
      return;
    }

    set((state) => ({
      leftDeck: {
        ...state.leftDeck,
        effects: state.leftDeck.effects.map((e) =>
          e.id === effectId ? ({ ...e, ...config } as EffectConfig) : e
        ),
      },
    }));
    getAudioManager().updateEffect(leftDeck.soundId, effectId, config);
  },

  updateRightEffect: (effectId: string, config: Partial<EffectConfig>) => {
    const { rightDeck } = get();
    if (!rightDeck.soundId) {
      return;
    }

    set((state) => ({
      rightDeck: {
        ...state.rightDeck,
        effects: state.rightDeck.effects.map((e) =>
          e.id === effectId ? ({ ...e, ...config } as EffectConfig) : e
        ),
      },
    }));
    getAudioManager().updateEffect(rightDeck.soundId, effectId, config);
  },

  removeLeftEffect: (effectId: string) => {
    const { leftDeck } = get();
    if (!leftDeck.soundId) {
      return;
    }

    set((state) => ({
      leftDeck: {
        ...state.leftDeck,
        effects: state.leftDeck.effects
          .filter((e) => e.id !== effectId)
          .map((e, i) => ({ ...e, order: i })),
      },
    }));
    getAudioManager().removeEffect(leftDeck.soundId, effectId);
  },

  removeRightEffect: (effectId: string) => {
    const { rightDeck } = get();
    if (!rightDeck.soundId) {
      return;
    }

    set((state) => ({
      rightDeck: {
        ...state.rightDeck,
        effects: state.rightDeck.effects
          .filter((e) => e.id !== effectId)
          .map((e, i) => ({ ...e, order: i })),
      },
    }));
    getAudioManager().removeEffect(rightDeck.soundId, effectId);
  },

  reorderLeftEffects: (effectIds: string[]) => {
    const { leftDeck } = get();
    if (!leftDeck.soundId) {
      return;
    }

    set((state) => ({
      leftDeck: {
        ...state.leftDeck,
        effects: effectIds
          .map((id) => state.leftDeck.effects.find((e) => e.id === id))
          .filter((e): e is EffectConfig => !!e),
      },
    }));

    getAudioManager().reorderEffects(leftDeck.soundId, effectIds);
  },

  reorderRightEffects: (effectIds: string[]) => {
    const { rightDeck } = get();
    if (!rightDeck.soundId) {
      return;
    }

    set((state) => ({
      rightDeck: {
        ...state.rightDeck,
        effects: effectIds
          .map((id) => state.rightDeck.effects.find((e) => e.id === id))
          .filter((e): e is EffectConfig => !!e),
      },
    }));

    getAudioManager().reorderEffects(rightDeck.soundId, effectIds);
  },
});
