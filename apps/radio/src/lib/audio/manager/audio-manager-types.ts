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
  analyser: AnalyserNode;
};

type SoundInstance = {
  radio: Radio;
  sourceId: string;
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
};

const MAX_MAIN_DELAY_MS = 500;
const MAX_MAIN_DELAY_SECONDS = MAX_MAIN_DELAY_MS / 1000;

function createAudioNodes(context: AudioContext): AudioNodes {
  const preFaderSend = context.createGain();
  preFaderSend.gain.value = 1;

  const gain = context.createGain();
  const pan = context.createStereoPanner();
  const filter = context.createBiquadFilter();
  const analyser = context.createAnalyser();

  filter.type = "highpass";
  filter.frequency.value = 0;

  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  return { preFaderSend, gain, pan, filter, analyser };
}

function createSoundInstance(radio: Radio, sourceId: string): SoundInstance {
  return {
    radio,
    sourceId,
    playbackSource: null,
    deviceSource: null,
    isDeviceInput: false,
    nodes: null,
    volume: 1,
    pan: 0,
    playing: false,
    loading: false,
    buffering: false,
    filterEnabled: false,
  };
}

export {
  createAudioNodes,
  createSoundInstance,
  MAX_MAIN_DELAY_MS,
  MAX_MAIN_DELAY_SECONDS,
};
export type { AudioNodes, FilterConfig, SoundInstance };
