import { AudioManager, type Radio } from "@/lib/audio";
import {
  activateChannel,
  type ChannelActivationOptions,
  type ChannelRuntimeSubscriptionOptions,
  clearAllChannelSubscriptionCleanups,
  deactivateChannel,
  setChannelVolume,
  subscribeChannelRuntime,
} from "@/lib/channel-state-manager";
import type { PlaybackSessionId } from "@/lib/collections/playback-sessions";
import { getMainOutputRouter } from "@/lib/main-output-router";
import type { PlaybackActionErrorReporter } from "./playback-action-errors.js";

export type MainOutputRouter = ReturnType<typeof getMainOutputRouter>;

export type PlaybackAudioRoutingLifecycle = {
  mainOutputSettingsApplied: boolean;
};

export type PlaybackActionChannelFacade = {
  activate: (
    sessionId: PlaybackSessionId,
    channelId: string,
    radio: Radio,
    optionsOrSoundId?: string | ChannelActivationOptions
  ) => string;
  clearSubscriptionCleanups: () => void;
  deactivate: (channelId: string) => void;
  setVolume: (
    sessionId: PlaybackSessionId,
    channelId: string,
    volume: number
  ) => void;
  subscribeRuntime: (
    sessionId: PlaybackSessionId,
    channelId: string,
    soundId: string,
    options?: ChannelRuntimeSubscriptionOptions
  ) => void;
};

export type PlaybackActionContext = {
  audio: AudioManager;
  channels: PlaybackActionChannelFacade;
  getMainOutputRouter: () => MainOutputRouter;
  lifecycle: PlaybackAudioRoutingLifecycle;
  reportError: PlaybackActionErrorReporter;
  resetAudioManager: () => void;
};

const defaultLifecycle: PlaybackAudioRoutingLifecycle = {
  mainOutputSettingsApplied: false,
};

const defaultChannels: PlaybackActionChannelFacade = {
  activate: activateChannel,
  clearSubscriptionCleanups: clearAllChannelSubscriptionCleanups,
  deactivate: deactivateChannel,
  setVolume: setChannelVolume,
  subscribeRuntime: subscribeChannelRuntime,
};

const noopReportError: PlaybackActionErrorReporter = () => undefined;

let defaultContext: PlaybackActionContext | null = null;

export function createDefaultPlaybackActionContext(): PlaybackActionContext {
  return {
    get audio() {
      return AudioManager.getInstance();
    },
    channels: defaultChannels,
    getMainOutputRouter,
    lifecycle: defaultLifecycle,
    reportError: noopReportError,
    resetAudioManager: AudioManager.resetInstance,
  };
}

export function getDefaultPlaybackActionContext(): PlaybackActionContext {
  defaultContext ??= createDefaultPlaybackActionContext();
  return defaultContext;
}

export function resetDefaultPlaybackActionContext(): void {
  defaultLifecycle.mainOutputSettingsApplied = false;
  defaultContext = null;
}
