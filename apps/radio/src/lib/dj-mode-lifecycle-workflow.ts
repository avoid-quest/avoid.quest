import { fadeOut, type Radio } from "@/lib/audio";
import {
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  getPlaybackSession,
  type PlaybackSessionRecord,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { clearDjErrorSurface } from "@/lib/dj/dj-error-surface";
import {
  cleanupAudioOnly,
  createDjDeckCommands,
  setCrossfadePosition,
  setMasterVolume,
} from "@/lib/dj-actions";
import type { DeckId } from "@/lib/dj-actions-decks.js";
import { resetDeck } from "@/lib/hooks/use-dj-state";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "@/lib/playback-action-context";
import {
  applySessionMasterVolume,
  ensureMainAudioSettingsApplied,
} from "@/lib/playback-actions-shared";
import {
  getPlaybackChannelRuntime,
  resetPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";

type FadeOutSound = (
  soundId: string,
  durationMs: number,
  stopAfter: boolean
) => Promise<void>;

type DjDeckCommands = ReturnType<typeof createDjDeckCommands>;

type CreateDjModeLifecycleWorkflowOptions = {
  ctx?: PlaybackActionContext;
  fadeOutDurationMs?: number;
  fadeOutSound?: FadeOutSound;
};

export type DjModeLifecycleWorkflow = {
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
};

const DJ_MODE_FADE_OUT_DURATION_MS = 150;
const DJ_DECK_CHANNEL_IDS = [DECK_A_CHANNEL_ID, DECK_B_CHANNEL_ID] as const;

async function fadeOutSoundIds(
  soundIds: string[],
  fadeOutSound: FadeOutSound,
  durationMs: number
): Promise<void> {
  await Promise.all(
    soundIds.map((soundId) => fadeOutSound(soundId, durationMs, true))
  );
}

function getDjRuntimeCleanupChannelIds(): string[] {
  const persistedChannelIds =
    getPlaybackSession("dj")?.channels.map((channel) => channel.id) ?? [];
  return Array.from(new Set([...persistedChannelIds, ...DJ_DECK_CHANNEL_IDS]));
}

function getActiveSoundIds(channelIds: readonly string[]): string[] {
  return channelIds.flatMap((channelId) => {
    const soundId = getPlaybackChannelRuntime(channelId).soundId;
    return soundId ? [soundId] : [];
  });
}

function cleanupOrphanedSounds(
  soundIds: string[],
  ctx: PlaybackActionContext
): void {
  const orphanedSoundIds = soundIds.filter((soundId) =>
    ctx.audio.hasSound(soundId)
  );
  for (const soundId of orphanedSoundIds) {
    ctx.audio.cleanupSound(soundId);
  }
  const remainingSoundIds = orphanedSoundIds.filter((soundId) =>
    ctx.audio.hasSound(soundId)
  );
  if (remainingSoundIds.length > 0) {
    throw new Error(
      `Orphaned dj sounds after deactivation: ${remainingSoundIds.join(", ")}`
    );
  }
}

async function getReadyDjPlaybackSession(): Promise<PlaybackSessionRecord> {
  await playbackSessionsCollection.stateWhenReady();
  const session = getPlaybackSession("dj");
  if (!session) {
    throw new Error("DJ playback session is not ready");
  }
  return session;
}

async function prepareReadyDjPlaybackSession(
  ctx: PlaybackActionContext
): Promise<PlaybackSessionRecord> {
  const session = await getReadyDjPlaybackSession();
  await ensureMainAudioSettingsApplied(ctx);
  return session;
}

async function restoreDjDeckRadio(
  deckId: DeckId,
  radio: Radio | null,
  deckCommands: DjDeckCommands
): Promise<void> {
  if (!radio) {
    return;
  }

  if (radio.platformMetadata?.platform === "local-file") {
    resetDeck(deckId);
    return;
  }

  switch (deckId) {
    case DECK_A_CHANNEL_ID:
      await deckCommands.setDeckARadio(radio);
      return;
    case DECK_B_CHANNEL_ID:
      await deckCommands.setDeckBRadio(radio);
      return;
    default:
      await deckCommands.setDeckBRadio(radio);
  }
}

async function activateDjMode(ctx: PlaybackActionContext): Promise<void> {
  const session = await prepareReadyDjPlaybackSession(ctx);
  clearDjErrorSurface();
  applySessionMasterVolume("dj", ctx);
  const deckCommands = createDjDeckCommands(ctx);

  const deckA = session.channels.find(
    (channel) => channel.id === DECK_A_CHANNEL_ID
  );
  const deckB = session.channels.find(
    (channel) => channel.id === DECK_B_CHANNEL_ID
  );

  await restoreDjDeckRadio(
    DECK_A_CHANNEL_ID,
    deckA?.radio ?? null,
    deckCommands
  );
  await restoreDjDeckRadio(
    DECK_B_CHANNEL_ID,
    deckB?.radio ?? null,
    deckCommands
  );

  setMasterVolume(session.masterVolume, ctx);
  setCrossfadePosition(session.crossfadePosition, ctx);
}

async function deactivateDjMode(
  ctx: PlaybackActionContext,
  fadeOutSound: FadeOutSound,
  fadeOutDurationMs: number
): Promise<void> {
  const channelIds = getDjRuntimeCleanupChannelIds();
  const soundIds = getActiveSoundIds(channelIds);
  await fadeOutSoundIds(soundIds, fadeOutSound, fadeOutDurationMs);
  await cleanupAudioOnly(ctx);
  for (const channelId of channelIds) {
    resetPlaybackChannelRuntime(channelId);
  }
  clearDjErrorSurface();
  cleanupOrphanedSounds(soundIds, ctx);
}

export function createDjModeLifecycleWorkflow({
  ctx = getDefaultPlaybackActionContext(),
  fadeOutDurationMs = DJ_MODE_FADE_OUT_DURATION_MS,
  fadeOutSound = fadeOut,
}: CreateDjModeLifecycleWorkflowOptions = {}): DjModeLifecycleWorkflow {
  return {
    activate: () => activateDjMode(ctx),
    deactivate: () => deactivateDjMode(ctx, fadeOutSound, fadeOutDurationMs),
  };
}
