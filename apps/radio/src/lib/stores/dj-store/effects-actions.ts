import type { StateCreator } from "zustand";
import {
  createDefaultEffectConfig,
  type EffectConfig,
  type FilterConfig,
  isEffectType,
} from "@/lib/audio";
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
    const { deckA } = get();
    set((state) => ({
      deckA: { ...state.deckA, filter: config },
    }));
    if (deckA.soundId) {
      getAudioManager().updateFilter(deckA.soundId, config);
    }
  },

  updateRightFilter: (config: FilterConfig) => {
    const { deckB } = get();
    set((state) => ({
      deckB: { ...state.deckB, filter: config },
    }));
    if (deckB.soundId) {
      getAudioManager().updateFilter(deckB.soundId, config);
    }
  },

  addLeftEffect: (effectType) => {
    // Runtime guard kept for defensive safety at store boundaries
    if (!isEffectType(effectType)) {
      throw new Error(`Invalid effect type: ${effectType}`);
    }

    const { deckA } = get();

    const newEffect = createDefaultEffectConfig(
      effectType,
      `effect_${Date.now()}_${Math.random()}`,
      deckA.effects.length
    );

    set((state) => ({
      deckA: {
        ...state.deckA,
        effects: [...state.deckA.effects, newEffect],
      },
    }));

    // Apply effect immediately if sound is loaded
    if (deckA.soundId) {
      getAudioManager().addEffect(deckA.soundId, newEffect);
    }
  },

  addRightEffect: (effectType) => {
    // Runtime guard kept for defensive safety at store boundaries
    if (!isEffectType(effectType)) {
      throw new Error(`Invalid effect type: ${effectType}`);
    }

    const { deckB } = get();

    const newEffect = createDefaultEffectConfig(
      effectType,
      `effect_${Date.now()}_${Math.random()}`,
      deckB.effects.length
    );

    set((state) => ({
      deckB: {
        ...state.deckB,
        effects: [...state.deckB.effects, newEffect],
      },
    }));

    // Apply effect immediately if sound is loaded
    if (deckB.soundId) {
      getAudioManager().addEffect(deckB.soundId, newEffect);
    }
  },

  updateLeftEffect: (effectId: string, config: Partial<EffectConfig>) => {
    const { deckA } = get();

    set((state) => ({
      deckA: {
        ...state.deckA,
        effects: state.deckA.effects.map((e) =>
          e.id === effectId ? ({ ...e, ...config } as EffectConfig) : e
        ),
      },
    }));

    // Apply effect update immediately if sound is loaded
    if (deckA.soundId) {
      getAudioManager().updateEffect(deckA.soundId, effectId, config);
    }
  },

  updateRightEffect: (effectId: string, config: Partial<EffectConfig>) => {
    const { deckB } = get();

    set((state) => ({
      deckB: {
        ...state.deckB,
        effects: state.deckB.effects.map((e) =>
          e.id === effectId ? ({ ...e, ...config } as EffectConfig) : e
        ),
      },
    }));

    // Apply effect update immediately if sound is loaded
    if (deckB.soundId) {
      getAudioManager().updateEffect(deckB.soundId, effectId, config);
    }
  },

  removeLeftEffect: (effectId: string) => {
    const { deckA } = get();

    set((state) => ({
      deckA: {
        ...state.deckA,
        effects: state.deckA.effects
          .filter((e) => e.id !== effectId)
          .map((e, i) => ({ ...e, order: i })),
      },
    }));

    // Apply removal immediately if sound is loaded
    if (deckA.soundId) {
      getAudioManager().removeEffect(deckA.soundId, effectId);
    }
  },

  removeRightEffect: (effectId: string) => {
    const { deckB } = get();

    set((state) => ({
      deckB: {
        ...state.deckB,
        effects: state.deckB.effects
          .filter((e) => e.id !== effectId)
          .map((e, i) => ({ ...e, order: i })),
      },
    }));

    // Apply removal immediately if sound is loaded
    if (deckB.soundId) {
      getAudioManager().removeEffect(deckB.soundId, effectId);
    }
  },

  reorderLeftEffects: (effectIds: string[]) => {
    const { deckA } = get();

    set((state) => ({
      deckA: {
        ...state.deckA,
        effects: effectIds
          .map((id, index) => {
            const effect = state.deckA.effects.find((e) => e.id === id);
            return effect ? { ...effect, order: index } : undefined;
          })
          .filter((e): e is EffectConfig => !!e),
      },
    }));

    // Apply reordering immediately if sound is loaded
    if (deckA.soundId) {
      getAudioManager().reorderEffects(deckA.soundId, effectIds);
    }
  },

  reorderRightEffects: (effectIds: string[]) => {
    const { deckB } = get();

    set((state) => ({
      deckB: {
        ...state.deckB,
        effects: effectIds
          .map((id, index) => {
            const effect = state.deckB.effects.find((e) => e.id === id);
            return effect ? { ...effect, order: index } : undefined;
          })
          .filter((e): e is EffectConfig => !!e),
      },
    }));

    // Apply reordering immediately if sound is loaded
    if (deckB.soundId) {
      getAudioManager().reorderEffects(deckB.soundId, effectIds);
    }
  },
});
