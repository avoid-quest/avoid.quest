import type { StateCreator } from "zustand";
import type { Radio } from "@/lib/types";
import type { DeckSide, DjState } from "./types";

// Helper to find next track in a platform playlist/album
export const findNextTrack = (
  radio: Radio | null
): { streamUrl: string } | null => {
  if (!radio?.platformMetadata?.tracks) {
    return null;
  }

  const { platformMetadata } = radio;
  const { tracks, platform, itemType } = platformMetadata;

  // Only handle collections (albums/playlists)
  const isCollection =
    (platform === "bandcamp" && itemType === "album") ||
    (platform === "soundcloud" && itemType === "playlist");

  if (!(isCollection && tracks) || tracks.length === 0) {
    return null;
  }

  // Find current track index
  const currentIndex = tracks.findIndex((t) => t.streamUrl === radio.streamUrl);

  if (currentIndex === -1) {
    // Current track not found, return first track
    return tracks[0];
  }

  // Return next track if available
  const nextIndex = currentIndex + 1;
  if (nextIndex < tracks.length) {
    return tracks[nextIndex];
  }

  // No more tracks
  return null;
};

const getDeckControls = (state: DjState, deckSide: DeckSide) => {
  const isLeft = deckSide === "left";
  return {
    deck: isLeft ? state.leftDeck : state.rightDeck,
    setRadio: isLeft ? state.setLeftRadio : state.setRightRadio,
    pause: isLeft ? state.pauseLeft : state.pauseRight,
    play: isLeft ? state.playLeft : state.playRight,
  };
};

export const createTrackActions: StateCreator<
  DjState,
  [],
  [],
  Pick<DjState, "loadTrack">
> = (_set, get) => ({
  // Track Management - Unified track loading
  loadTrack: async (
    deckSide: DeckSide,
    radio: Radio | null,
    autoPlay = false
  ) => {
    const state = get();
    const { deck, setRadio, pause, play } = getDeckControls(state, deckSide);

    // Handle clearing the deck
    if (!radio) {
      await setRadio(null);
      return;
    }

    // Prevent re-entry if already loading
    if (deck.isLoading) {
      return;
    }

    // Pause current track if playing
    if (deck.isPlaying) {
      pause();
    }

    // Load new track via setRadio
    await setRadio(radio);

    // Auto-play if requested (and not just clearing)
    if (autoPlay) {
      await play();
    }
  },
});
