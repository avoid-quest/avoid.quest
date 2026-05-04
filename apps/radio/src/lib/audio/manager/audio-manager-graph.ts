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

type MeterListener = (level: { left: number; right: number }) => void;

type MasterGraphNodes = {
  mainDelayNode: DelayNode;
  masterSplitter: ChannelSplitterNode;
  masterAnalyserL: AnalyserNode;
  masterAnalyserR: AnalyserNode;
};

type ConnectAudioGraphParams = {
  instance: SoundInstance;
  mainDelayNode: DelayNode | null;
  notifyListeners: NotifySoundListeners;
  getOrCreateWorkletManager: (soundId: string) => Promise<WorkletManager>;
};

type WorkletListenerParams = {
  wm: WorkletManager;
  soundId: string;
  sounds: Map<string, SoundInstance>;
  meterListeners: Map<string, Set<MeterListener>>;
  notifyListeners: NotifySoundListeners;
};

function cleanupSoundNodes(instance: SoundInstance): void {
  if (!instance.nodes) {
    return;
  }

  safeDisconnect(instance.nodes.gain, "AudioManager.cleanupSound");
  safeDisconnect(instance.nodes.pan, "AudioManager.cleanupSound");
  safeDisconnect(instance.nodes.filter, "AudioManager.cleanupSound");
  safeDisconnect(instance.nodes.analyser, "AudioManager.cleanupSound");
  instance.nodes = null;
}

function createMasterGraphNodes(
  context: AudioContext,
  maxDelaySeconds: number
): MasterGraphNodes {
  const mainDelayNode = context.createDelay(maxDelaySeconds);
  mainDelayNode.delayTime.value = 0;
  mainDelayNode.connect(context.destination);

  const masterSplitter = context.createChannelSplitter(2);
  mainDelayNode.connect(masterSplitter);

  const masterAnalyserL = context.createAnalyser();
  masterAnalyserL.fftSize = 2048;

  const masterAnalyserR = context.createAnalyser();
  masterAnalyserR.fftSize = 2048;

  masterSplitter.connect(masterAnalyserL, 0);
  masterSplitter.connect(masterAnalyserR, 1);

  return {
    mainDelayNode,
    masterSplitter,
    masterAnalyserL,
    masterAnalyserR,
  };
}

function startMasterMeterLoop(
  analyserL: AnalyserNode,
  analyserR: AnalyserNode,
  listeners: Set<MeterListener>,
  frameCounter: { count: number; value: number }
): number {
  const bufferL = new Float32Array(2048);
  const bufferR = new Float32Array(2048);

  const tick = (): void => {
    frameCounter.value = requestAnimationFrame(tick);
    frameCounter.count++;
    if (frameCounter.count % 2 !== 0) {
      return;
    }

    analyserL.getFloatTimeDomainData(bufferL);
    analyserR.getFloatTimeDomainData(bufferR);

    let sumL = 0;
    let sumR = 0;
    for (let i = 0; i < bufferL.length; i++) {
      sumL += bufferL[i] * bufferL[i];
      sumR += bufferR[i] * bufferR[i];
    }

    const level = {
      left: Math.sqrt(sumL / bufferL.length),
      right: Math.sqrt(sumR / bufferR.length),
    };

    for (const listener of listeners) {
      listener(level);
    }
  };

  frameCounter.count = 0;
  return requestAnimationFrame(tick);
}

function stopMasterMeterLoop(rafId: number | null): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
}

function attachWorkletManagerListeners({
  wm,
  soundId,
  sounds,
  meterListeners,
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

  wm.on("peakMeter", ({ peakL, peakR }: WorkletManagerEvents["peakMeter"]) => {
    const callbacks = meterListeners.get(soundId);
    if (!callbacks) {
      return;
    }

    for (const callback of callbacks) {
      callback({ left: peakL, right: peakR });
    }
  });
}

async function connectAudioGraph({
  instance,
  mainDelayNode,
  notifyListeners,
  getOrCreateWorkletManager,
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

  const { preFaderSend, gain, pan, filter, analyser } = instance.nodes;

  safeDisconnect(sourceOutput, "AudioManager.connectAudioGraph");
  safeDisconnect(preFaderSend, "AudioManager.connectAudioGraph");
  safeDisconnect(gain, "AudioManager.connectAudioGraph");
  safeDisconnect(pan, "AudioManager.connectAudioGraph");
  safeDisconnect(filter, "AudioManager.connectAudioGraph");
  safeDisconnect(analyser, "AudioManager.connectAudioGraph");

  const wm = await getOrCreateWorkletManager(instance.sourceId);
  wm.createStreamSource(instance.sourceId);
  wm.startSource(instance.sourceId);

  sourceOutput.connect(pan);
  pan.connect(filter);

  const finalDestination = mainDelayNode ?? context.destination;

  if (wm.node && wm.outputNode) {
    filter.connect(wm.node);
    wm.outputNode.connect(preFaderSend);
    preFaderSend.connect(gain);
    gain.connect(analyser);
    analyser.connect(finalDestination);
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
  preFaderSend.connect(gain);
  gain.connect(analyser);
  analyser.connect(finalDestination);
  return true;
}

export {
  attachWorkletManagerListeners,
  cleanupSoundNodes,
  connectAudioGraph,
  createMasterGraphNodes,
  startMasterMeterLoop,
  stopMasterMeterLoop,
};
export type { MasterGraphNodes, MeterListener };
