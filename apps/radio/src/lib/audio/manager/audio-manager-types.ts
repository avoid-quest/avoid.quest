import type {
  DeviceSource,
  FilterType,
  PlaybackSource,
  Radio,
} from "../playback/index.js";

type FilterConfig = {
  enabled: boolean;
  type: FilterType;
  frequency: number;
  Q: number;
  gain: number;
};

type AudioNodes = {
  preFaderSend: GainNode;
  gain: GainNode;
  pan: StereoPannerNode;
  filter: BiquadFilterNode;
};

type SoundOutputMode = "audio-graph" | "native";

type SoundInstance = {
  radio: Radio;
  sourceId: string;
  mainOutputCleanup: (() => void) | null;
  playbackSource: PlaybackSource | null;
  deviceSource: DeviceSource | null;
  isDeviceInput: boolean;
  nodes: AudioNodes | null;
  volume: number;
  pan: number;
  playing: boolean;
  loading: boolean;
  buffering: boolean;
  filterEnabled: boolean;
  outputMode: SoundOutputMode;
};

function createAudioNodes(context: AudioContext, initialGain = 1): AudioNodes {
  const preFaderSend = context.createGain();
  preFaderSend.gain.value = 1;

  const gain = context.createGain();
  gain.gain.value = Math.max(0, initialGain);
  const pan = context.createStereoPanner();
  const filter = context.createBiquadFilter();

  filter.type = "highpass";
  filter.frequency.value = 0;

  return { filter, gain, pan, preFaderSend };
}

function createSoundInstance(
  radio: Radio,
  sourceId: string,
  outputMode: SoundOutputMode = "audio-graph"
): SoundInstance {
  return {
    buffering: false,
    deviceSource: null,
    filterEnabled: false,
    isDeviceInput: false,
    loading: false,
    mainOutputCleanup: null,
    nodes: null,
    outputMode,
    pan: 0,
    playbackSource: null,
    playing: false,
    radio,
    sourceId,
    volume: 1,
  };
}

export type { AudioNodes, FilterConfig, SoundInstance, SoundOutputMode };
export { createAudioNodes, createSoundInstance };
