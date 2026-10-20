import { useDeckAState, useDeckBState } from "@/lib/hooks/use-deck-state";
import { useMidiEffectRegistration } from "@/lib/hooks/use-midi-effect-registration";

/** Both decks keep their MIDI actions across tab and layout changes. */
export function DjMidiEffects() {
  const deckA = useDeckAState();
  const deckB = useDeckBState();
  useMidiEffectRegistration("deck-a", deckA.effects);
  useMidiEffectRegistration("deck-b", deckB.effects);
  return null;
}
