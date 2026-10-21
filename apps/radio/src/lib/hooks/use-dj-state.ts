import { useStore } from "@tanstack/react-store";
import type { EffectConfig, FilterConfig, Radio } from "@/lib/audio";
import { useChannelState } from "@/lib/channel-state-manager";
import { getPlaybackSessionPersistence } from "@/lib/collections/node-session-persistence";
import {
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  getPlaybackChannel,
  getPlaybackSession,
  type PlaybackChannelRecord,
} from "@/lib/collections/playback-sessions";
import { usePlaybackSessionSelector } from "@/lib/hooks/use-dj-session";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";

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

function toMixerRecord(
  session = getPlaybackSession("dj")
): MixerRecord | undefined {
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
    crossfadePosition: session.crossfadePosition,
    deckACueEnabled: deckA?.cueEnabled ?? false,
    deckBCueEnabled: deckB?.cueEnabled ?? false,
    headphoneVolume: session.headphoneVolume,
    id: MIXER_ID,
    masterVolume: session.masterVolume,
  };
}

export function useMixer(): MixerRecord | undefined {
  return usePlaybackSessionSelector("dj", (session) =>
    session ? toMixerRecord(session) : undefined
  );
}

/** Media sessions observe source identity and playback status only. */
export function useDjMediaDeck(channelId: string) {
  const radio = usePlaybackSessionSelector(
    "dj",
    (session) =>
      session?.channels.find((channel) => channel.id === channelId)?.radio ??
      null
  );
  const isPlaying = useStore(
    playbackRuntimeStore,
    (state) => state.channels[channelId]?.isPlaying ?? false
  );
  return { isPlaying, radio };
}

export function useDeckA(): DeckState | null {
  return useChannelState("dj", DECK_A_CHANNEL_ID) as DeckState | null;
}

export function useDeckB(): DeckState | null {
  return useChannelState("dj", DECK_B_CHANNEL_ID) as DeckState | null;
}

export { useDjError } from "@/lib/stores/dj-runtime-store";

export function getDeckA(): DeckRecord | undefined {
  return getPlaybackChannel("dj", DECK_A_CHANNEL_ID);
}

export function getDeckB(): DeckRecord | undefined {
  return getPlaybackChannel("dj", DECK_B_CHANNEL_ID);
}

export function getMixer(): MixerRecord | undefined {
  return toMixerRecord();
}

export function updateMixer(
  updater: (draft: MixerRecord) => void,
  apply?: () => void
) {
  const mixer = toMixerRecord();
  if (!mixer) {
    return;
  }
  const draft = { ...mixer };
  updater(draft);
  getPlaybackSessionPersistence("dj").update((session) => {
    session.crossfadePosition = draft.crossfadePosition;
    session.masterVolume = draft.masterVolume;
    session.headphoneVolume = draft.headphoneVolume;
    const deckA = session.channels.find(
      (channel) => channel.id === DECK_A_CHANNEL_ID
    );
    const deckB = session.channels.find(
      (channel) => channel.id === DECK_B_CHANNEL_ID
    );
    if (deckA) {
      deckA.cueEnabled = draft.deckACueEnabled;
    }
    if (deckB) {
      deckB.cueEnabled = draft.deckBCueEnabled;
    }
  }, apply);
}
