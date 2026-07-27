/**
 * Hook for dynamically registering MIDI actions for deck effects.
 *
 * Tracks effect IDs; registers new effects, unregisters removed ones,
 * and cleans up persisted mappings when effects are removed.
 */

import { useEffect, useRef } from "react";
import type { EffectConfig } from "@/lib/audio";
import {
  collectEffectIds,
  registerEffectActions,
  useMidiStore,
} from "@/lib/midi";

export function useMidiEffectRegistration(
  deckId: "deck-a" | "deck-b",
  effects: EffectConfig[]
) {
  const effectIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const currentEffectIds = collectEffectIds(effects);

    for (const id of effectIdsRef.current) {
      if (!currentEffectIds.has(id)) {
        useMidiStore.getState().removeEffectMappings(id);
      }
    }
    effectIdsRef.current = currentEffectIds;

    const cleanups = effects.map((effect) =>
      registerEffectActions(deckId, effect)
    );

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [deckId, effects]);
}
