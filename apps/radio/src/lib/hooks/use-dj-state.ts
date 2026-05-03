import { useMemo } from "react";
import type { EffectConfig, FilterConfig, Radio } from "@/lib/audio";
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
import {
  getPlaybackChannelRuntime,
  usePlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";

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

function combineDeckState(
  persisted: DeckRecord | undefined,
  runtime: ReturnType<typeof getPlaybackChannelRuntime>
): DeckState | null {
  if (!persisted) {
    return null;
  }

  return {
    radio: persisted.radio as Radio | null,
    soundId: runtime.soundId,
    isPlaying: runtime.isPlaying,
    isLoading: runtime.isLoading,
    isBuffering: runtime.isBuffering,
    volume: persisted.volume,
    muted: persisted.muted,
    pan: persisted.pan,
    speed: persisted.speed,
    channelFilter: persisted.channelFilter,
    effects: persisted.effects as EffectConfig[],
    filter: persisted.filter as FilterConfig,
    effectsDryWet: persisted.effectsDryWet,
    repeat: persisted.repeat,
    autoplay: persisted.autoplay ?? true,
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
  const persisted = useDeckAPersisted();
  const runtime = usePlaybackChannelRuntime(DECK_A_CHANNEL_ID);
  return combineDeckState(persisted, runtime);
}

export function useDeckB(): DeckState | null {
  const persisted = useDeckBPersisted();
  const runtime = usePlaybackChannelRuntime(DECK_B_CHANNEL_ID);
  return combineDeckState(persisted, runtime);
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
  setDeckASubscriptionCleanup,
  setDeckBRuntimeState,
  setDeckBSoundId,
  setDeckBSubscriptionCleanup,
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
  updatePlaybackChannel("dj", deckId, (draft) => {
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
  return combineDeckState(
    getPlaybackChannel("dj", DECK_A_CHANNEL_ID),
    getPlaybackChannelRuntime(DECK_A_CHANNEL_ID)
  );
}

export function getDeckBState(): DeckState | null {
  return combineDeckState(
    getPlaybackChannel("dj", DECK_B_CHANNEL_ID),
    getPlaybackChannelRuntime(DECK_B_CHANNEL_ID)
  );
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
