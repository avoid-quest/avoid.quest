import type { Radio } from "@/lib/audio";
import {
  type DeckRecord,
  getDeckA,
  getDeckB,
  updateDeckA,
  updateDeckB,
} from "@/lib/hooks/use-dj-state";
import {
  getDeckARuntime,
  getDeckASubscriptionCleanup,
  getDeckBRuntime,
  getDeckBSubscriptionCleanup,
  resetDeckARuntime,
  resetDeckBRuntime,
  setDeckARuntimeState,
  setDeckASoundId,
  setDeckASubscriptionCleanup,
  setDeckBRuntimeState,
  setDeckBSoundId,
  setDeckBSubscriptionCleanup,
} from "@/lib/stores/dj-runtime-store";

type DeckSide = "left" | "right";
type DeckId = "deck-a" | "deck-b";

type DeckConfig = {
  side: DeckSide;
  getDeck: typeof getDeckA;
  getRuntime: typeof getDeckARuntime;
  getSubscriptionCleanup: typeof getDeckASubscriptionCleanup;
  setSubscriptionCleanup: typeof setDeckASubscriptionCleanup;
  setSoundId: typeof setDeckASoundId;
  setRuntimeState: typeof setDeckARuntimeState;
  resetRuntime: typeof resetDeckARuntime;
  updateDeck: typeof updateDeckA;
};

function getDeckRadio(deck: DeckRecord): Radio | null {
  return deck.radio;
}

const deckConfig: Record<DeckId, DeckConfig> = {
  "deck-a": {
    side: "left",
    getDeck: getDeckA,
    getRuntime: getDeckARuntime,
    getSubscriptionCleanup: getDeckASubscriptionCleanup,
    setSubscriptionCleanup: setDeckASubscriptionCleanup,
    setSoundId: setDeckASoundId,
    setRuntimeState: setDeckARuntimeState,
    resetRuntime: resetDeckARuntime,
    updateDeck: updateDeckA,
  },
  "deck-b": {
    side: "right",
    getDeck: getDeckB,
    getRuntime: getDeckBRuntime,
    getSubscriptionCleanup: getDeckBSubscriptionCleanup,
    setSubscriptionCleanup: setDeckBSubscriptionCleanup,
    setSoundId: setDeckBSoundId,
    setRuntimeState: setDeckBRuntimeState,
    resetRuntime: resetDeckBRuntime,
    updateDeck: updateDeckB,
  },
};

export { deckConfig, getDeckRadio };
export type { DeckConfig, DeckId, DeckSide };
