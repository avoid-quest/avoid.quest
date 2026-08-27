import {
  type ChannelSelection,
  generateErrorId,
  type WorkletManager,
  type WorkletManagerEvents,
} from "../playback/index.js";
import { safeDisconnect, safeDisconnectFrom } from "../utils.js";
import {
  type NotifySoundListeners,
  notifySoundError,
  notifySoundState,
} from "./audio-manager-state.js";
import type { SoundInstance } from "./audio-manager-types.js";

type ConnectAudioGraphParams = {
  instance: SoundInstance;
  connectMainOutput: (source: AudioNode, realtime: boolean) => () => void;
  notifyListeners: NotifySoundListeners;
  connectEffectsGraph: (
    soundId: string,
    source: AudioNode,
    destination: AudioNode,
    inputChannels: 1 | 2
  ) => Promise<boolean>;
};

type WorkletListenerParams = {
  wm: WorkletManager;
  sounds: Map<string, SoundInstance>;
  notifyListeners: NotifySoundListeners;
};

type UpdateDeviceChannelSelectionParams = {
  instance: SoundInstance;
  reconnectGraph: (instance: SoundInstance) => Promise<boolean>;
  selection: ChannelSelection;
};

const STALE_SOURCE_CONTROL_ERROR = /^Cannot (pause|resume):/;
const deviceGraphReconnects = new WeakMap<SoundInstance, Promise<void>>();

function cleanupSoundNodes(instance: SoundInstance): void {
  instance.mainOutputCleanup?.();
  instance.mainOutputCleanup = null;
  if (!instance.nodes) {
    return;
  }

  safeDisconnect(instance.nodes.preFaderSend, "AudioManager.cleanupSound");
  safeDisconnect(instance.nodes.gain, "AudioManager.cleanupSound");
  safeDisconnect(instance.nodes.pan, "AudioManager.cleanupSound");
  safeDisconnect(instance.nodes.filter, "AudioManager.cleanupSound");
  instance.nodes = null;
}

function attachWorkletManagerListeners({
  wm,
  sounds,
  notifyListeners,
}: WorkletListenerParams): void {
  wm.on("sourceEnded", ({ sourceId }: WorkletManagerEvents["sourceEnded"]) => {
    const instance = sounds.get(sourceId);
    if (!instance) {
      return;
    }

    instance.playing = false;
    notifySoundState(notifyListeners, sourceId, instance, {
      hasEnded: true,
      isPlaying: false,
    });
  });

  wm.on(
    "sourceError",
    ({
      id,
      sourceId,
      error,
      code,
      effectId,
      timestamp,
    }: WorkletManagerEvents["sourceError"]) => {
      const instance = sounds.get(sourceId);
      if (!instance) {
        return;
      }

      if (
        code === "SOURCE_NOT_FOUND" &&
        STALE_SOURCE_CONTROL_ERROR.test(error)
      ) {
        console.warn(
          `[AudioManager] Ignoring stale worklet source error: ${error}`
        );
        return;
      }

      const message = effectId ? `[${effectId}] ${error}` : error;
      notifySoundError(
        notifyListeners,
        sourceId,
        instance,
        code === "EFFECT_PROCESS_FAILED"
          ? "EFFECT_PROCESS_FAILED"
          : "PLAYBACK_FAILED",
        message,
        { id, timestamp }
      );
    }
  );
}

async function connectAudioGraph({
  instance,
  connectMainOutput,
  notifyListeners,
  connectEffectsGraph,
}: ConnectAudioGraphParams): Promise<boolean> {
  const sourceOutput =
    instance.playbackSource?.output ?? instance.deviceSource?.output;
  if (!(sourceOutput && instance.nodes)) {
    console.warn(
      `[AudioManager] Cannot connect graph: missing source or nodes for ${instance.sourceId}`
    );
    return false;
  }

  const { preFaderSend, gain, pan, filter } = instance.nodes;

  instance.mainOutputCleanup?.();
  instance.mainOutputCleanup = null;
  safeDisconnect(sourceOutput, "AudioManager.connectAudioGraph");
  safeDisconnectFrom(preFaderSend, gain, "AudioManager.connectAudioGraph");
  safeDisconnect(gain, "AudioManager.connectAudioGraph");
  safeDisconnect(pan, "AudioManager.connectAudioGraph");
  safeDisconnect(filter, "AudioManager.connectAudioGraph");

  const panAfterEffects = instance.isDeviceInput;
  if (panAfterEffects) {
    sourceOutput.connect(filter);
    pan.connect(preFaderSend);
  } else {
    sourceOutput.connect(pan);
    pan.connect(filter);
  }

  // Connect the stable native shell before the first async effect-runtime
  // boundary. AudioManager can then request media playback in the original
  // user-activation task without exposing a disconnected or full-volume path.
  preFaderSend.connect(gain);
  instance.mainOutputCleanup = connectMainOutput(gain, instance.isDeviceInput);

  const inputChannels = instance.deviceSource?.outputChannelCount ?? 2;
  if (
    await connectEffectsGraph(
      instance.sourceId,
      filter,
      panAfterEffects ? pan : preFaderSend,
      inputChannels
    )
  ) {
    return true;
  }

  console.warn(
    `[AudioManager] Worklet unavailable for ${instance.sourceId}, effects bypassed`
  );
  notifyListeners(instance.sourceId, {
    error: {
      code: "WORKLET_UNAVAILABLE",
      id: generateErrorId(),
      message: "Audio effects unavailable - worklet failed to initialize",
      radio: instance.radio,
      sourceId: instance.sourceId,
      timestamp: Date.now(),
    },
    hasEnded: false,
    isBuffering: false,
    isLoading: false,
    isPlaying: false,
    volume: instance.volume,
  });

  filter.connect(panAfterEffects ? pan : preFaderSend);
  return true;
}

function updateDeviceChannelSelection({
  instance,
  reconnectGraph,
  selection,
}: UpdateDeviceChannelSelectionParams): void {
  const { deviceSource } = instance;
  if (!deviceSource) {
    return;
  }
  const previousOutputChannelCount = deviceSource.outputChannelCount;
  deviceSource.setChannelSelection(selection);
  if (
    deviceSource.isActive &&
    deviceSource.outputChannelCount !== previousOutputChannelCount &&
    instance.nodes
  ) {
    const reconnect = async (): Promise<void> => {
      await reconnectGraph(instance);
    };
    const previous = deviceGraphReconnects.get(instance);
    const pending = (previous ? previous.then(reconnect) : reconnect()).catch(
      (error: unknown) =>
        console.warn(
          `[AudioManager] Failed to reconnect device input ${instance.sourceId}`,
          error
        )
    );
    deviceGraphReconnects.set(instance, pending);
  }
}

export {
  attachWorkletManagerListeners,
  cleanupSoundNodes,
  connectAudioGraph,
  updateDeviceChannelSelection,
};
