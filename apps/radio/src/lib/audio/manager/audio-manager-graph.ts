import {
  generateErrorId,
  getAudioContext,
  type WorkletManager,
  type WorkletManagerEvents,
} from "../playback/index.js";
import { safeDisconnect } from "../utils.js";
import {
  type NotifySoundListeners,
  notifySoundError,
  notifySoundState,
} from "./audio-manager-state.js";
import type { SoundInstance } from "./audio-manager-types.js";

type MasterGraphNodes = {
  mainDelayNode: DelayNode;
};

type ConnectAudioGraphParams = {
  instance: SoundInstance;
  mainDelayNode: DelayNode | null;
  notifyListeners: NotifySoundListeners;
  connectEffectsGraph: (
    soundId: string,
    source: AudioNode,
    destination: AudioNode
  ) => Promise<boolean>;
};

type WorkletListenerParams = {
  wm: WorkletManager;
  sounds: Map<string, SoundInstance>;
  notifyListeners: NotifySoundListeners;
};

const STALE_SOURCE_CONTROL_ERROR = /^Cannot (pause|resume):/;

function cleanupSoundNodes(instance: SoundInstance): void {
  if (!instance.nodes) {
    return;
  }

  safeDisconnect(instance.nodes.gain, "AudioManager.cleanupSound");
  safeDisconnect(instance.nodes.pan, "AudioManager.cleanupSound");
  safeDisconnect(instance.nodes.filter, "AudioManager.cleanupSound");
  instance.nodes = null;
}

function createMasterGraphNodes(
  context: AudioContext,
  maxDelaySeconds: number
): MasterGraphNodes {
  const mainDelayNode = context.createDelay(maxDelaySeconds);
  mainDelayNode.delayTime.value = 0;
  mainDelayNode.connect(context.destination);

  return { mainDelayNode };
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
      isPlaying: false,
      hasEnded: true,
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
  mainDelayNode,
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

  const context = getAudioContext();
  if (!context) {
    console.warn(
      "[AudioManager] Cannot connect graph: no AudioContext available"
    );
    return false;
  }

  const { preFaderSend, gain, pan, filter } = instance.nodes;

  safeDisconnect(sourceOutput, "AudioManager.connectAudioGraph");
  safeDisconnect(preFaderSend, "AudioManager.connectAudioGraph");
  safeDisconnect(gain, "AudioManager.connectAudioGraph");
  safeDisconnect(pan, "AudioManager.connectAudioGraph");
  safeDisconnect(filter, "AudioManager.connectAudioGraph");

  sourceOutput.connect(pan);
  pan.connect(filter);

  const finalDestination = mainDelayNode ?? context.destination;

  // Connect the stable native shell before the first async effect-runtime
  // boundary. AudioManager can then request media playback in the original
  // user-activation task without exposing a disconnected or full-volume path.
  preFaderSend.connect(gain);
  gain.connect(finalDestination);

  if (await connectEffectsGraph(instance.sourceId, filter, preFaderSend)) {
    return true;
  }

  console.warn(
    `[AudioManager] Worklet unavailable for ${instance.sourceId}, effects bypassed`
  );
  notifyListeners(instance.sourceId, {
    isPlaying: false,
    isLoading: false,
    isBuffering: false,
    volume: instance.volume,
    error: {
      id: generateErrorId(),
      message: "Audio effects unavailable - worklet failed to initialize",
      code: "WORKLET_UNAVAILABLE",
      radio: instance.radio,
      timestamp: Date.now(),
      sourceId: instance.sourceId,
    },
    hasEnded: false,
  });

  filter.connect(preFaderSend);
  return true;
}

export type { MasterGraphNodes };
export {
  attachWorkletManagerListeners,
  cleanupSoundNodes,
  connectAudioGraph,
  createMasterGraphNodes,
};
