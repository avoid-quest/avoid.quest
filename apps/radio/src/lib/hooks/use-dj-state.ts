import { useMemo } from "react";
import type { EffectConfig, FilterConfig, Radio } from "@/lib/audio";
import {
  getChannelState,
  updateChannel,
  useChannelState,
} from "@/lib/channel-state-manager";
import {
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  getPlaybackChannel,
  getPlaybackSession,
  type PlaybackChannelRecord,
  updatePlaybackSession,
} from "@/lib/collections/playback-sessions";
import { useDjSession } from "@/lib/hooks/use-dj-session";

const MIXER_ID = "mixer";

export type DeckRecord = PlaybackChannelRecord;

export type MixerRecord = {
  id: typeof MIXER_ID;
  crossfadePosition: number;
  masterVolume: number;
  headphoneVolume: number;
  deckACueEnabled: boolean;
  deckBCueEnabled: boolean;
};

export type DeckState = {
  radio: Radio | null;
  soundId: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  volume: number;
  muted: boolean;
  pan: number;
  speed: number;
  channelFilter: number;
  effects: EffectConfig[];
  filter: FilterConfig;
  effectsDryWet: number;
  repeat: boolean;
  autoplay: boolean;
};

function toMixerRecord(): MixerRecord | undefined {
  const session = getPlaybackSession("dj");
  const deckA = session?.channels.find(
    (channel) => channel.id === DECK_A_CHANNEL_ID
  );
  const deckB = session?.channels.find(
    (channel) => channel.id === DECK_B_CHANNEL_ID
  );
  if (!session) {
    return;
  }
  return {
    id: MIXER_ID,
    crossfadePosition: session.crossfadePosition,
    masterVolume: session.masterVolume,
    headphoneVolume: session.headphoneVolume,
    deckACueEnabled: deckA?.cueEnabled ?? false,
    deckBCueEnabled: deckB?.cueEnabled ?? false,
  };
}

export function useDeckAPersisted(): DeckRecord | undefined {
  const session = useDjSession();
  return session?.channels.find((channel) => channel.id === DECK_A_CHANNEL_ID);
}

export function useDeckBPersisted(): DeckRecord | undefined {
  const session = useDjSession();
  return session?.channels.find((channel) => channel.id === DECK_B_CHANNEL_ID);
}

export function useMixer(): MixerRecord | undefined {
  const session = useDjSession();
  return useMemo(() => {
    if (!session) {
      return;
    }
    const deckA = session.channels.find(
      (channel) => channel.id === DECK_A_CHANNEL_ID
    );
    const deckB = session.channels.find(
      (channel) => channel.id === DECK_B_CHANNEL_ID
    );
    return {
      id: MIXER_ID,
      crossfadePosition: session.crossfadePosition,
      masterVolume: session.masterVolume,
      headphoneVolume: session.headphoneVolume,
      deckACueEnabled: deckA?.cueEnabled ?? false,
      deckBCueEnabled: deckB?.cueEnabled ?? false,
    };
  }, [session]);
}

export function useDeckA(): DeckState | null {
  return useChannelState("dj", DECK_A_CHANNEL_ID) as DeckState | null;
}

export function useDeckB(): DeckState | null {
  return useChannelState("dj", DECK_B_CHANNEL_ID) as DeckState | null;
}

export function useDecks() {
  const deckA = useDeckA();
  const deckB = useDeckB();
  return { deckA, deckB };
}

export {
  getDeckARuntime,
  getDeckBRuntime,
  resetDeckARuntime,
  resetDeckBRuntime,
  setActiveDragRadio,
  setDeckARuntimeState,
  setDeckASoundId,
  setDeckBRuntimeState,
  setDeckBSoundId,
  setDjError,
  setPendingPlatformItem,
  useActiveDragRadio,
  useDeckAIsLoading,
  useDeckAIsPlaying,
  useDeckASoundId,
  useDeckBIsLoading,
  useDeckBIsPlaying,
  useDeckBSoundId,
  useDjError,
  usePendingPlatformItem,
} from "@/lib/stores/dj-runtime-store";

export function resetDeck(deckId: "deck-a" | "deck-b") {
  updateChannel("dj", deckId, (draft) => {
    const next = getPlaybackChannel("dj", deckId);
    Object.assign(draft, {
      ...(next ?? draft),
      radio: null,
      volume: 1,
      muted: false,
      pan: 0,
      speed: 1,
      channelFilter: 0,
      effects: [],
      filter: {
        type: "lowpass",
        frequency: 1000,
        Q: 1,
        gain: 0,
        enabled: false,
      },
      effectsDryWet: 1,
      repeat: false,
      autoplay: true,
      cueEnabled: next?.cueEnabled ?? draft.cueEnabled,
    });
  });
}

export function resetAllDjState() {
  resetDeck(DECK_A_CHANNEL_ID);
  resetDeck(DECK_B_CHANNEL_ID);
  updatePlaybackSession("dj", (draft) => {
    draft.crossfadePosition = 0.5;
    draft.masterVolume = 1;
    draft.headphoneVolume = 1;
  });
}

export function getDeckAState(): DeckState | null {
  return getChannelState("dj", DECK_A_CHANNEL_ID) as DeckState | null;
}

export function getDeckBState(): DeckState | null {
  return getChannelState("dj", DECK_B_CHANNEL_ID) as DeckState | null;
}

export function getMixerState(): MixerRecord | undefined {
  return toMixerRecord();
}

export function getDeckA(): DeckRecord | undefined {
  return getPlaybackChannel("dj", DECK_A_CHANNEL_ID);
}

export function getDeckB(): DeckRecord | undefined {
  return getPlaybackChannel("dj", DECK_B_CHANNEL_ID);
}

export function getMixer(): MixerRecord | undefined {
  return toMixerRecord();
}

export function updateDeckA(updater: (draft: DeckRecord) => void) {
  updateChannel("dj", DECK_A_CHANNEL_ID, updater);
}

export function updateDeckB(updater: (draft: DeckRecord) => void) {
  updateChannel("dj", DECK_B_CHANNEL_ID, updater);
}

export function updateMixer(updater: (draft: MixerRecord) => void) {
  const mixer = toMixerRecord();
  if (!mixer) {
    return;
  }
  const draft = { ...mixer };
  updater(draft);
  updatePlaybackSession("dj", (session) => {
    session.crossfadePosition = draft.crossfadePosition;
    session.masterVolume = draft.masterVolume;
    session.headphoneVolume = draft.headphoneVolume;
  });
  updateChannel("dj", DECK_A_CHANNEL_ID, (channel) => {
    channel.cueEnabled = draft.deckACueEnabled;
  });
  updateChannel("dj", DECK_B_CHANNEL_ID, (channel) => {
    channel.cueEnabled = draft.deckBCueEnabled;
  });
}
