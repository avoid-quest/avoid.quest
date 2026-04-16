import type { EffectConfig } from "@/lib/audio";
import {
  AudioManager,
  createOutputRouter,
  crossfade,
  type FilterConfig,
  getAudioContext,
  type OutputRouter,
  type Radio,
} from "@/lib/audio";
import {
  createDefaultChannel,
  getMultipleChannelId,
  getPlaybackChannel,
  getPlaybackSession,
  type PlaybackChannelRecord,
  type PlaybackSessionId,
  removePlaybackChannel,
  replacePlaybackChannels,
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
  setPlaybackSessionActiveChannel,
  updatePlaybackChannel,
  updatePlaybackSession,
  upsertPlaybackChannel,
} from "@/lib/collections/playback-sessions";
import {
  getAudioSettings,
  getDelaySettings,
  getSettings,
} from "@/lib/collections/settings";
import { validateRadioForMode } from "@/lib/external-url/utils";
import {
  getPlaybackChannelRuntime,
  getPlaybackChannelSubscriptionCleanup,
  resetPlaybackChannelRuntime,
  setPlaybackChannelPeakLevel,
  setPlaybackChannelRuntime,
  setPlaybackChannelSoundId,
  setPlaybackChannelSubscriptionCleanup,
} from "@/lib/stores/playback-runtime-store";

let outputRouter: OutputRouter | null = null;
let audioRoutingInitialized = false;

function getAudioManager(): AudioManager {
  return AudioManager.getInstance();
}

function isSameRadio(a: Radio | null | undefined, b: Radio | null | undefined) {
  if (!(a && b)) {
    return false;
  }
  if (a.id !== undefined && b.id !== undefined) {
    return String(a.id) === String(b.id);
  }
  return a.streamUrl === b.streamUrl;
}

function getOutputRouter(): OutputRouter | null {
  const context = getAudioContext();
  if (!context) {
    return null;
  }
  if (!outputRouter) {
    outputRouter = createOutputRouter(context);
  }
  return outputRouter;
}

export async function applyMainOutputDevice(deviceId: string): Promise<void> {
  const router = getOutputRouter();
  if (router) {
    await router.setMainOutput(deviceId);
  }
}

export async function applyCurrentMainAudioSettings(): Promise<void> {
  const router = getOutputRouter();
  if (!router) {
    audioRoutingInitialized = false;
    return;
  }

  const settings = getAudioSettings();
  if (settings.mainOutputId && settings.mainOutputId !== "default") {
    await router.setMainOutput(settings.mainOutputId);
  }

  const { mainDelayMs } = getDelaySettings();
  getAudioManager().setMainDelay(mainDelayMs);
  audioRoutingInitialized = true;
}

async function ensureMainAudioSettingsApplied(): Promise<void> {
  if (!audioRoutingInitialized) {
    await applyCurrentMainAudioSettings();
  }
}

function getSessionMasterVolume(sessionId: PlaybackSessionId): number {
  return getPlaybackSession(sessionId)?.masterVolume ?? 1;
}

function applySessionMasterVolume(sessionId: PlaybackSessionId): void {
  getAudioManager().setGlobalVolume(getSessionMasterVolume(sessionId));
}

function getDefaultSoundId(
  sessionId: PlaybackSessionId,
  channelId: string
): string {
  return `${sessionId}:${channelId}`;
}

function subscribeManagedChannel(
  sessionId: PlaybackSessionId,
  channelId: string,
  soundId: string
): void {
  const manager = getAudioManager();
  const cleanup = manager.subscribe(soundId, (audioState) => {
    setPlaybackChannelRuntime(channelId, () => ({
      soundId,
      isPlaying: audioState.isPlaying,
      isLoading: audioState.isLoading,
      isBuffering: audioState.isBuffering,
      error: audioState.error,
    }));
  });

  const meterCleanup =
    sessionId === "dj"
      ? manager.subscribeMeter(soundId, (level) => {
          setPlaybackChannelPeakLevel(channelId, level);
        })
      : null;

  setPlaybackChannelSubscriptionCleanup(channelId, () => {
    cleanup();
    meterCleanup?.();
  });
}

function createManagedSound(
  sessionId: PlaybackSessionId,
  channelId: string,
  radio: Radio,
  soundId = getDefaultSoundId(sessionId, channelId)
): string {
  const manager = getAudioManager();

  const previousCleanup = getPlaybackChannelSubscriptionCleanup(channelId);
  if (previousCleanup) {
    previousCleanup();
    setPlaybackChannelSubscriptionCleanup(channelId, null);
  }

  const previousRuntime = getPlaybackChannelRuntime(channelId);
  if (previousRuntime.soundId) {
    manager.cleanupSound(previousRuntime.soundId);
  }

  manager.createSound(radio, soundId);
  setPlaybackChannelSoundId(channelId, soundId);
  subscribeManagedChannel(sessionId, channelId, soundId);

  return soundId;
}

export function cleanupManagedChannel(channelId: string): void {
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().cleanupSound(runtime.soundId);
  }
  resetPlaybackChannelRuntime(channelId);
}

export function cleanupPlaybackSessionAudio(
  sessionId: PlaybackSessionId
): void {
  const session = getPlaybackSession(sessionId);
  if (!session) {
    return;
  }
  for (const channel of session.channels) {
    cleanupManagedChannel(channel.id);
  }
}

export function cleanupAudioForModeChange(nextMode: PlaybackSessionId): void {
  for (const sessionId of ["single", "multiple", "dj"] as const) {
    if (sessionId !== nextMode) {
      cleanupPlaybackSessionAudio(sessionId);
    }
  }
  applySessionMasterVolume(nextMode);
}

export function syncMultiplePlaybackChannels(radios: Radio[]): void {
  const existingChannels = getPlaybackSession("multiple")?.channels ?? [];
  const nextChannelIds = new Set(
    radios.map((radio) => getMultipleChannelId(radio))
  );

  for (const channel of existingChannels) {
    if (!nextChannelIds.has(channel.id)) {
      cleanupManagedChannel(channel.id);
    }
  }

  const channels = radios.map((radio, index) => {
    const channelId = getMultipleChannelId(radio);
    const existingChannel = existingChannels.find(
      (channel) => channel.id === channelId
    );

    return {
      ...(existingChannel ??
        createDefaultChannel(channelId, "multiple", index)),
      id: channelId,
      role: "multiple" as const,
      radio,
      order: index,
    };
  });
  replacePlaybackChannels("multiple", channels);
}

export function addMultiplePlaybackChannel(
  radio: Radio,
  order?: number
): PlaybackChannelRecord {
  const channel = {
    ...createDefaultChannel(
      getMultipleChannelId(radio),
      "multiple",
      order ?? getPlaybackSession("multiple")?.channels.length ?? 0
    ),
    radio,
  };
  upsertPlaybackChannel("multiple", channel);
  return channel;
}

export function removeMultiplePlaybackChannel(channelId: string): void {
  cleanupManagedChannel(channelId);
  removePlaybackChannel("multiple", channelId);
}

export async function setMultipleChannelPlaying(
  channelId: string,
  playing: boolean
): Promise<void> {
  const channel = getPlaybackChannel("multiple", channelId);
  if (!channel?.radio) {
    return;
  }

  validateRadioForMode(channel.radio, "multiple");

  if (!playing) {
    const runtime = getPlaybackChannelRuntime(channelId);
    if (runtime.soundId) {
      getAudioManager().pauseSound(runtime.soundId);
    }
    return;
  }

  const runtime = getPlaybackChannelRuntime(channelId);
  const soundId =
    runtime.soundId ?? createManagedSound("multiple", channelId, channel.radio);

  await ensureMainAudioSettingsApplied();
  applySessionMasterVolume("multiple");
  await getAudioManager().playSound(soundId, channel.volume);
}

export function setMultipleChannelVolume(
  channelId: string,
  volume: number
): void {
  updatePlaybackChannel("multiple", channelId, (draft) => {
    draft.volume = volume;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().setVolume(runtime.soundId, volume);
  }
}

export function setMultipleSessionMasterVolume(volume: number): void {
  updatePlaybackSession("multiple", (draft) => {
    draft.masterVolume = volume;
  });
  if ((getSettings()?.player.mode ?? "single") === "multiple") {
    getAudioManager().setGlobalVolume(volume);
  }
}

export async function playAllMultipleChannels(): Promise<void> {
  const channels = getPlaybackSession("multiple")?.channels ?? [];
  for (const channel of channels) {
    await setMultipleChannelPlaying(channel.id, true);
  }
}

export function pauseAllMultipleChannels(): void {
  const channels = getPlaybackSession("multiple")?.channels ?? [];
  for (const channel of channels) {
    const runtime = getPlaybackChannelRuntime(channel.id);
    if (runtime.soundId) {
      getAudioManager().pauseSound(runtime.soundId);
    }
  }
}

export function setSingleChannelVolume(
  channelId: string,
  volume: number
): void {
  updatePlaybackChannel("single", channelId, (draft) => {
    draft.volume = volume;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().setVolume(runtime.soundId, volume);
  }
}

export async function setSinglePlaybackState(playing: boolean): Promise<void> {
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
      getAudioManager().pauseSound(runtime.soundId);
    }
    return;
  }

  const soundId =
    runtime.soundId ??
    createManagedSound("single", activeChannelId, channel.radio);

  await ensureMainAudioSettingsApplied();
  applySessionMasterVolume("single");
  await getAudioManager().playSound(soundId, channel.volume);
}

export async function selectSinglePlaybackRadio(
  radio: Radio,
  transitionDuration: number
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
    radio
  );
  await ensureMainAudioSettingsApplied();
  applySessionMasterVolume("single");

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
      cleanupManagedChannel(outgoingChannelId);
    }
    setPlaybackSessionActiveChannel("single", incomingChannelId);
    return;
  }

  await getAudioManager().playSound(incomingSoundId, 0);
  await crossfade(outgoingRuntime.soundId as string, incomingSoundId, {
    duration: transitionDuration,
    targetVolume: previousVolume,
    curve: "equalPower",
  });

  if (outgoingChannelId) {
    cleanupManagedChannel(outgoingChannelId);
    updatePlaybackChannel("single", outgoingChannelId, (draft) => {
      draft.radio = null;
      draft.volume = previousVolume;
    });
  }

  setPlaybackSessionActiveChannel("single", incomingChannelId);
}

export function updateManagedChannel(
  sessionId: PlaybackSessionId,
  channelId: string,
  updater: (draft: PlaybackChannelRecord) => void
): void {
  updatePlaybackChannel(sessionId, channelId, updater);
}

export function updateManagedChannelFilter(
  sessionId: PlaybackSessionId,
  channelId: string,
  filter: FilterConfig
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.filter = filter;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().updateFilter(runtime.soundId, filter);
  }
}

export function setManagedChannelEffectsDryWet(
  sessionId: PlaybackSessionId,
  channelId: string,
  value: number
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.effectsDryWet = value;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().setEffectsDryWet(runtime.soundId, value);
  }
}

export function setManagedChannelPan(
  sessionId: PlaybackSessionId,
  channelId: string,
  pan: number
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.pan = pan;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().setPan(runtime.soundId, pan);
  }
}

export function setManagedChannelSpeed(
  sessionId: PlaybackSessionId,
  channelId: string,
  speed: number
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.speed = speed;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().setPlaybackRate(runtime.soundId, speed);
  }
}

export function setManagedChannelMuted(
  sessionId: PlaybackSessionId,
  channelId: string,
  muted: boolean
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.muted = muted;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    if (muted) {
      getAudioManager().muteSound(runtime.soundId);
    } else {
      getAudioManager().unmuteSound(runtime.soundId);
    }
  }
}

export function setManagedChannelRepeat(
  sessionId: PlaybackSessionId,
  channelId: string,
  repeat: boolean
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.repeat = repeat;
  });
}

export function setManagedChannelAutoplay(
  sessionId: PlaybackSessionId,
  channelId: string,
  autoplay: boolean
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.autoplay = autoplay;
  });
}

export function seekManagedChannel(channelId: string, position: number): void {
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().seekSound(runtime.soundId, position);
  }
}

export function setManagedChannelFilterValue(
  sessionId: PlaybackSessionId,
  channelId: string,
  value: number
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.channelFilter = value;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().setChannelFilter(runtime.soundId, value);
  }
}

export function addManagedChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effect: EffectConfig
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.effects.push(effect);
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().addEffect(runtime.soundId, effect);
  }
}

export function updateManagedChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectId: string,
  effectConfig: Partial<EffectConfig>
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    const effect = draft.effects.find((entry) => entry.id === effectId);
    if (effect) {
      Object.assign(effect, effectConfig);
    }
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().updateEffect(runtime.soundId, effectId, effectConfig);
  }
}

export function removeManagedChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectId: string
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.effects = draft.effects.filter((effect) => effect.id !== effectId);
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().removeEffect(runtime.soundId, effectId);
  }
}

export function reorderManagedChannelEffects(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectIds: string[]
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.effects = effectIds
      .map((effectId) => draft.effects.find((effect) => effect.id === effectId))
      .filter((effect): effect is EffectConfig => Boolean(effect));
    for (const [index, effect] of draft.effects.entries()) {
      effect.order = index;
    }
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().reorderEffects(runtime.soundId, effectIds);
  }
}
