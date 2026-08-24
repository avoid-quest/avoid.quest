import { useEffect, useRef } from "react";
import type { EffectConfig } from "@/lib/audio";
import type { DeckId } from "@/lib/dj-deck";
import { getMidiControl } from "@/lib/midi";

type EffectsBinding = ReturnType<
  ReturnType<typeof getMidiControl>["bindDeckEffects"]
>;

export function useMidiEffectRegistration(
  deckId: DeckId,
  effects: readonly EffectConfig[]
): void {
  const bindingRef = useRef<EffectsBinding | null>(null);
  const latestEffectsRef = useRef(effects);
  latestEffectsRef.current = effects;

  useEffect(() => {
    const binding = getMidiControl().bindDeckEffects(deckId);
    bindingRef.current = binding;
    binding.reconcile(latestEffectsRef.current);
    return () => {
      binding.dispose();
      if (bindingRef.current === binding) {
        bindingRef.current = null;
      }
    };
  }, [deckId]);

  useEffect(() => {
    bindingRef.current?.reconcile(effects);
  }, [effects]);
}
