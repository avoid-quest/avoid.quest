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
  getDeckBRuntime,
  setDeckARuntimeState,
  setDeckBRuntimeState,
} from "@/lib/stores/dj-runtime-store";

type DeckSide = "left" | "right";
type DeckId = "deck-a" | "deck-b";

type DeckConfig = {
  side: DeckSide;
  getDeck: typeof getDeckA;
  getRuntime: typeof getDeckARuntime;
  setRuntimeState: typeof setDeckARuntimeState;
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
    setRuntimeState: setDeckARuntimeState,
    updateDeck: updateDeckA,
  },
  "deck-b": {
    side: "right",
    getDeck: getDeckB,
    getRuntime: getDeckBRuntime,
    setRuntimeState: setDeckBRuntimeState,
    updateDeck: updateDeckB,
  },
};

export { deckConfig, getDeckRadio };
export type { DeckConfig, DeckId, DeckSide };
