import { useMemo } from "react";
import type { EffectConfig, FilterConfig, Radio } from "@/lib/audio";
import { getChannelState, useChannelState } from "@/lib/channel-state-manager";
import {
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  getPlaybackChannel,
  getPlaybackSession,
  type PlaybackChannelRecord,
  updatePlaybackChannel,
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
  updatePlaybackChannel("dj", DECK_A_CHANNEL_ID, updater);
}

export function updateDeckB(updater: (draft: DeckRecord) => void) {
  updatePlaybackChannel("dj", DECK_B_CHANNEL_ID, updater);
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
  updatePlaybackChannel("dj", DECK_A_CHANNEL_ID, (channel) => {
    channel.cueEnabled = draft.deckACueEnabled;
  });
  updatePlaybackChannel("dj", DECK_B_CHANNEL_ID, (channel) => {
    channel.cueEnabled = draft.deckBCueEnabled;
  });
}
