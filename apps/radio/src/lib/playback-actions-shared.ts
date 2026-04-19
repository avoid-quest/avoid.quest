import { AudioManager, type Radio } from "@/lib/audio";
import {
  getPlaybackSession,
  type PlaybackSessionId,
} from "@/lib/collections/playback-sessions";
import { getAudioSettings, getDelaySettings } from "@/lib/collections/settings";
import { getMainOutputRouter } from "@/lib/main-output-router";
import {
  getPlaybackChannelRuntime,
  getPlaybackChannelSubscriptionCleanup,
  resetAllPlaybackRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelPeakLevel,
  setPlaybackChannelRuntime,
  setPlaybackChannelSoundId,
  setPlaybackChannelSubscriptionCleanup,
} from "@/lib/stores/playback-runtime-store";

let audioRoutingInitialized = false;

export function getAudioManager(): AudioManager {
  return AudioManager.getInstance();
}

export function isSameRadio(
  a: Radio | null | undefined,
  b: Radio | null | undefined
): boolean {
  if (!(a && b)) {
    return false;
  }
  if (a.id !== undefined && b.id !== undefined) {
    return String(a.id) === String(b.id);
  }
  return a.streamUrl === b.streamUrl;
}

function getOutputRouter() {
  return getMainOutputRouter();
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

export async function ensureMainAudioSettingsApplied(): Promise<void> {
  if (!audioRoutingInitialized) {
    await applyCurrentMainAudioSettings();
  }
}

export function resetManagedAudioState(): void {
  AudioManager.resetInstance();
  resetAllPlaybackRuntime();
  audioRoutingInitialized = false;
}

function getSessionMasterVolume(sessionId: PlaybackSessionId): number {
  return getPlaybackSession(sessionId)?.masterVolume ?? 1;
}

export function applySessionMasterVolume(sessionId: PlaybackSessionId): void {
  getAudioManager().setGlobalVolume(getSessionMasterVolume(sessionId));
}

export function getDefaultSoundId(
  sessionId: PlaybackSessionId,
  channelId: string
): string {
  return `${sessionId}:${channelId}`;
}

export function subscribeManagedChannel(
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

export function createManagedSound(
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
