import { crossfade, type Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  getPlaybackChannel,
  getPlaybackSession,
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
  setPlaybackSessionActiveChannel,
  updatePlaybackChannel,
  upsertPlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { validateRadioForMode } from "@/lib/external-url/utils";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "./playback-action-context.js";
import { reportPlaybackActionError } from "./playback-action-errors.js";
import {
  applySessionMasterVolume,
  cleanupManagedChannel,
  createManagedSound,
  ensureMainAudioSettingsApplied,
  isSameRadio,
} from "./playback-actions-shared.js";

export function setSingleChannelVolume(
  channelId: string,
  volume: number,
  ctx = getDefaultPlaybackActionContext()
): void {
  ctx.channels.setVolume("single", channelId, volume);
}

export async function setSinglePlaybackState(
  playing: boolean,
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  const session = getPlaybackSession("single");
  const activeChannelId = session?.activeChannelId;
  if (!activeChannelId) {
    return;
  }
  const channel = session?.channels.find(
    (entry) => entry.id === activeChannelId
  );
  if (!channel?.radio) {
    return;
  }

  validateRadioForMode(channel.radio, "single");

  const runtime = getPlaybackChannelRuntime(activeChannelId);
  if (!playing) {
    if (runtime.soundId) {
      ctx.audio.pauseSound(runtime.soundId);
    }
    return;
  }

  const soundId =
    runtime.soundId ??
    createManagedSound(
      "single",
      activeChannelId,
      channel.radio,
      undefined,
      ctx
    );

  try {
    await ensureMainAudioSettingsApplied(ctx);
    applySessionMasterVolume("single", ctx);
    await ctx.audio.playSound(soundId, channel.volume);
  } catch (error) {
    throw reportPlaybackActionError(ctx.reportError, {
      mode: "single",
      code: "PLAY_ERROR",
      cause: error,
      channelId: activeChannelId,
      radio: channel.radio,
      fallbackMessage:
        "Playback could not start. Check the station stream and try again.",
    });
  }
}

export async function selectSinglePlaybackRadio(
  radio: Radio,
  transitionDuration: number,
  ctx: PlaybackActionContext = getDefaultPlaybackActionContext()
): Promise<void> {
  validateRadioForMode(radio, "single");

  const session = getPlaybackSession("single");
  if (!session) {
    return;
  }

  const activeChannelId = session.activeChannelId;
  const activeChannel = activeChannelId
    ? (session.channels.find((entry) => entry.id === activeChannelId) ?? null)
    : null;

  if (isSameRadio(activeChannel?.radio, radio)) {
    return;
  }

  const incomingChannelId =
    activeChannelId === SINGLE_ACTIVE_CHANNEL_ID
      ? SINGLE_STANDBY_CHANNEL_ID
      : SINGLE_ACTIVE_CHANNEL_ID;
  const outgoingChannelId =
    activeChannelId === incomingChannelId ? null : activeChannelId;

  const incomingChannel =
    getPlaybackChannel("single", incomingChannelId) ??
    createDefaultChannel(
      incomingChannelId,
      incomingChannelId === SINGLE_ACTIVE_CHANNEL_ID
        ? "single-primary"
        : "single-secondary",
      incomingChannelId === SINGLE_ACTIVE_CHANNEL_ID ? 0 : 1
    );

  const previousVolume = activeChannel?.volume ?? incomingChannel.volume;
  upsertPlaybackChannel("single", {
    ...incomingChannel,
    radio,
    volume: previousVolume,
  });

  const incomingSoundId = createManagedSound(
    "single",
    incomingChannelId,
    radio,
    undefined,
    ctx
  );
  await ensureMainAudioSettingsApplied(ctx);
  applySessionMasterVolume("single", ctx);

  const outgoingRuntime = outgoingChannelId
    ? getPlaybackChannelRuntime(outgoingChannelId)
    : null;
  const shouldCrossfade = !!(
    outgoingChannelId &&
    outgoingRuntime?.soundId &&
    outgoingRuntime.isPlaying
  );

  if (!shouldCrossfade) {
    if (outgoingChannelId && outgoingRuntime?.soundId) {
      cleanupManagedChannel(outgoingChannelId, ctx);
    }
    setPlaybackSessionActiveChannel("single", incomingChannelId);
    return;
  }

  try {
    await ctx.audio.playSound(incomingSoundId, 0);
    await crossfade(outgoingRuntime.soundId as string, incomingSoundId, {
      duration: transitionDuration,
      targetVolume: previousVolume,
      curve: "equalPower",
    });
  } catch (error) {
    throw reportPlaybackActionError(ctx.reportError, {
      mode: "single",
      code: "PLAY_ERROR",
      cause: error,
      channelId: incomingChannelId,
      radio,
      fallbackMessage:
        "Playback could not start. Check the station stream and try again.",
    });
  }

  if (outgoingChannelId) {
    cleanupManagedChannel(outgoingChannelId, ctx);
    updatePlaybackChannel("single", outgoingChannelId, (draft) => {
      draft.radio = null;
      draft.volume = previousVolume;
    });
  }

  setPlaybackSessionActiveChannel("single", incomingChannelId);
}
