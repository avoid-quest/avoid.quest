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
import { resetDeck } from "@/lib/hooks/use-dj-state";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "@/lib/playback-action-context";
import {
  applySessionMasterVolume,
  ensureMainAudioSettingsApplied,
} from "@/lib/playback-actions-shared";
import type { DeckId } from "@/lib/stores/dj-runtime-store";
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

async function fadeOutSoundIds(
  soundIds: string[],
  fadeOutSound: FadeOutSound,
  durationMs: number
): Promise<void> {
  await Promise.all(
    soundIds.map((soundId) => fadeOutSound(soundId, durationMs, true))
  );
}

function getSessionSoundIds(): string[] {
  const session = getPlaybackSession("dj");
  if (!session) {
    return [];
  }
  return session.channels.flatMap((channel) => {
    const soundId = getPlaybackChannelRuntime(channel.id).soundId;
    return soundId ? [soundId] : [];
  });
}

function getSessionChannelIds(): string[] {
  return getPlaybackSession("dj")?.channels.map((channel) => channel.id) ?? [];
}

function assertNoOrphanedSounds(
  soundIds: string[],
  ctx: PlaybackActionContext
): void {
  const orphanedSoundIds = soundIds.filter((soundId) =>
    ctx.audio.hasSound(soundId)
  );
  if (orphanedSoundIds.length > 0) {
    throw new Error(
      `Orphaned dj sounds after deactivation: ${orphanedSoundIds.join(", ")}`
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

function isRestorableDjRadio(radio: Radio | null): radio is Radio {
  return radio !== null && radio.platformMetadata?.platform !== "local-file";
}

async function restoreDjDeckRadio(
  deckId: DeckId,
  radio: Radio | null,
  deckCommands: DjDeckCommands
): Promise<void> {
  if (radio?.platformMetadata?.platform === "local-file") {
    resetDeck(deckId);
    return;
  }

  if (!isRestorableDjRadio(radio)) {
    return;
  }

  if (deckId === DECK_A_CHANNEL_ID) {
    await deckCommands.setDeckARadio(radio);
    return;
  }

  await deckCommands.setDeckBRadio(radio);
}

async function activateDjMode(ctx: PlaybackActionContext): Promise<void> {
  const session = await prepareReadyDjPlaybackSession(ctx);
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
  const soundIds = getSessionSoundIds();
  const channelIds = getSessionChannelIds();
  await fadeOutSoundIds(soundIds, fadeOutSound, fadeOutDurationMs);
  await cleanupAudioOnly(ctx);
  for (const channelId of channelIds) {
    resetPlaybackChannelRuntime(channelId);
  }
  clearDjErrorSurface();
  assertNoOrphanedSounds(soundIds, ctx);
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
