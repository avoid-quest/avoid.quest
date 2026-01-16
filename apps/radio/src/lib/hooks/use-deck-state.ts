import { useShallow } from "zustand/react/shallow";
import type { DeckId } from "@/lib/stores/dj-store";
import { useDjStore } from "@/lib/stores/dj-store";

export function useDeckState(deckId: DeckId) {
  return useDjStore(
    useShallow((state) => {
      const isLeft = deckId === "left-deck";
      const deckState = isLeft ? state.leftDeck : state.rightDeck;

      return {
        // State
        radio: deckState.radio,
        isPlaying: deckState.isPlaying,
        isLoading: deckState.isLoading,
        isBuffering: deckState.isBuffering,
        volume: deckState.volume,
        muted: deckState.muted,
        effects: deckState.effects,
        filter: deckState.filter,
        soundId: deckState.soundId,

        // Actions
        play: isLeft ? state.playLeft : state.playRight,
        pause: isLeft ? state.pauseLeft : state.pauseRight,
        setVolume: isLeft ? state.setLeftVolume : state.setRightVolume,
        setMute: isLeft ? state.setLeftMute : state.setRightMute,
        loadTrack: state.loadTrack,
        reset: isLeft ? state.resetLeft : state.resetRight,
      };
    })
  );
}
