import {
  type AudioEngineFacade,
  AudioManager,
  createAudioEngineFacade,
  type Radio,
  resumeAudioContext,
} from "@/lib/audio";
import {
  activateChannel,
  type ChannelActivationOptions,
  type ChannelOutputMode,
  type ChannelRuntimeSubscriptionOptions,
  deactivateAllChannels,
  deactivateChannel,
  getChannelOutputMode,
  setChannelMuted,
  setChannelPan,
  setChannelSpeed,
  setChannelVolume,
  subscribeChannelRuntime,
} from "@/lib/channel-state-manager";
import type { PlaybackSessionId } from "@/lib/collections/playback-sessions";
import { getOutputRouting, type OutputRouting } from "@/lib/output-routing.js";
import type { PlaybackActionErrorReporter } from "./playback-action-errors.js";

export type MainOutputRouter = OutputRouting | null;

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
  deactivateAll: () => void;
  deactivate: (channelId: string) => void;
  getOutputMode?: (channelId: string) => ChannelOutputMode | null;
  setVolume: (
    sessionId: PlaybackSessionId,
    channelId: string,
    volume: number
  ) => void;
  setMuted: (
    sessionId: PlaybackSessionId,
    channelId: string,
    muted: boolean
  ) => void;
  setPan: (
    sessionId: PlaybackSessionId,
    channelId: string,
    pan: number
  ) => void;
  setSpeed: (
    sessionId: PlaybackSessionId,
    channelId: string,
    speed: number
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
  audioEngine: AudioEngineFacade;
  channels: PlaybackActionChannelFacade;
  getMainOutputRouter: () => MainOutputRouter;
  lifecycle: PlaybackAudioRoutingLifecycle;
  reportError: PlaybackActionErrorReporter;
  resumeAudioContext: () => Promise<void>;
  resetAudioManager: () => void;
};

const defaultLifecycle: PlaybackAudioRoutingLifecycle = {
  mainOutputSettingsApplied: false,
};

const defaultChannels: PlaybackActionChannelFacade = {
  activate: activateChannel,
  deactivate: deactivateChannel,
  deactivateAll: deactivateAllChannels,
  getOutputMode: getChannelOutputMode,
  setMuted: setChannelMuted,
  setPan: setChannelPan,
  setSpeed: setChannelSpeed,
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
    get audioEngine() {
      return createAudioEngineFacade(AudioManager.getInstance());
    },
    channels: defaultChannels,
    getMainOutputRouter: getOutputRouting,
    lifecycle: defaultLifecycle,
    reportError: noopReportError,
    resetAudioManager: AudioManager.resetInstance,
    resumeAudioContext,
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
