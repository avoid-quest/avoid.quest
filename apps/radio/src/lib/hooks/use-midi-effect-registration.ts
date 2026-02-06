/**
 * Hook for dynamically registering MIDI actions for deck effects.
 *
 * Tracks effect IDs; registers new effects, unregisters removed ones,
 * and cleans up persisted mappings when effects are removed.
 */

import { useEffect, useRef } from "react";
import type { EffectConfig } from "@/lib/audio";
import { registerEffectActions, useMidiStore } from "@/lib/midi";

export function useMidiEffectRegistration(
  deckId: "deck-a" | "deck-b",
  effects: EffectConfig[]
) {
  const cleanupMapRef = useRef(new Map<string, () => void>());

  useEffect(() => {
    const currentIds = new Set(effects.map((e) => e.id));
    const prevMap = cleanupMapRef.current;

    // Unregister removed effects
    for (const [id, cleanup] of prevMap) {
      if (!currentIds.has(id)) {
        cleanup();
        prevMap.delete(id);
        // Clean up persisted mappings for removed effects
        useMidiStore.getState().removeEffectMappings(id);
      }
    }

    // Register new effects
    for (const effect of effects) {
      if (!prevMap.has(effect.id)) {
        const cleanup = registerEffectActions(deckId, effect);
        prevMap.set(effect.id, cleanup);
      }
    }

    return () => {
      // Cleanup all on unmount
      for (const cleanup of prevMap.values()) {
        cleanup();
      }
      prevMap.clear();
    };
  }, [deckId, effects]);
}
