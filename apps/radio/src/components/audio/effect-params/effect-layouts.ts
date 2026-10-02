import type { EffectType } from "@/lib/audio";

/**
 * Per-effect presentation: which parameters sit together, in what order,
 * with short labels that fit under a knob. Parameters an effect defines but
 * a layout leaves out are still shown, folded into a trailing "More" row.
 */
export type LayoutRow = {
  title?: string;
  keys: string[];
  /** Folded by default. */
  collapsible?: boolean;
};

export type EffectLayout = {
  rows: LayoutRow[];
  labels?: Record<string, string>;
  /** Knobs whose arc fills outward from their default instead of from the minimum. */
  bipolar?: string[];
};

export const EFFECT_LAYOUTS: Partial<Record<EffectType, EffectLayout>> = {
  autotune: {
    labels: { retuneAmount: "Retune", shift: "Shift" },
    rows: [
      { keys: ["key", "scale"] },
      { keys: ["amount", "retuneAmount", "smooth", "shift"] },
    ],
  },
  cheapReverb: {
    bipolar: ["filter"],
    labels: { dry: "Dry", preDelay: "Pre-delay", wet: "Wet" },
    rows: [
      { keys: ["decay", "preDelay", "damp", "filter"] },
      { collapsible: true, keys: ["dry", "wet"], title: "Levels" },
    ],
  },
  compressor: {
    labels: {
      autoattack: "Auto attack",
      automakeup: "Auto makeup",
      autorelease: "Auto release",
      inputgain: "Input",
      lookahead: "Lookahead",
      makeup: "Makeup",
      mix: "Blend",
    },
    rows: [
      { keys: ["threshold", "ratio", "knee"] },
      { keys: ["attack", "release"], title: "Timing" },
      { keys: ["inputgain", "makeup", "mix"], title: "Gain" },
      {
        keys: ["lookahead", "autoattack", "autorelease", "automakeup"],
        title: "Auto",
      },
    ],
  },
  crusher: {
    labels: { bitDepth: "Bits", boost: "Boost" },
    rows: [{ keys: ["crush", "bitDepth", "boost", "autoGain"] }],
  },
  delay: {
    bipolar: ["filter"],
    labels: {
      cross: "Cross",
      delayMillis: "Time",
      delayMusical: "Sync",
      dry: "Dry",
      lfoDepth: "Depth",
      lfoSpeed: "Rate",
      preMillisTimeLeft: "L ms",
      preMillisTimeRight: "R ms",
      preSyncTimeLeft: "L sync",
      preSyncTimeRight: "R sync",
      wet: "Wet",
    },
    rows: [
      { keys: ["delayMusical", "delayMillis"], title: "Time" },
      { keys: ["feedback", "cross", "filter"] },
      { keys: ["lfoSpeed", "lfoDepth"], title: "Modulation" },
      {
        collapsible: true,
        keys: [
          "preSyncTimeLeft",
          "preMillisTimeLeft",
          "preSyncTimeRight",
          "preMillisTimeRight",
        ],
        title: "Pre-delay",
      },
      { collapsible: true, keys: ["dry", "wet"], title: "Levels" },
    ],
  },
  distortion: {
    rows: [{ keys: ["amount", "oversample"] }],
  },
  fold: {
    bipolar: ["amount", "volume"],
    labels: { volume: "Volume" },
    rows: [{ keys: ["amount", "volume", "oversample", "autoGain"] }],
  },
  gate: {
    labels: { return: "Return" },
    rows: [
      { keys: ["threshold", "return", "floor"] },
      { keys: ["attack", "hold", "release"], title: "Envelope" },
      { keys: ["inverse"] },
    ],
  },
  limiter: {
    rows: [{ keys: ["threshold"] }],
  },
  maximizer: {
    labels: { lookaheadEnabled: "Lookahead" },
    rows: [{ keys: ["threshold", "lookaheadEnabled"] }],
  },
  neuralAmp: {
    labels: { input: "Input", mix: "Blend", output: "Output" },
    rows: [{ keys: ["input", "output", "mix", "mono"] }],
  },
  pitchShifter: {
    bipolar: ["pitchFactor"],
    labels: { pitchFactor: "Pitch" },
    rows: [{ keys: ["pitchFactor"] }],
  },
  plateReverb: {
    labels: {
      bandwidth: "Bandwidth",
      decayDiffusion1: "Decay 1",
      decayDiffusion2: "Decay 2",
      dry: "Dry",
      excursionDepth: "Depth",
      excursionRate: "Rate",
      inputDiffusion1: "In 1",
      inputDiffusion2: "In 2",
      preDelayMillis: "Pre-delay",
      wet: "Wet",
    },
    rows: [
      { keys: ["decay", "preDelayMillis", "damping", "bandwidth"] },
      {
        collapsible: true,
        keys: [
          "inputDiffusion1",
          "inputDiffusion2",
          "decayDiffusion1",
          "decayDiffusion2",
        ],
        title: "Diffusion",
      },
      {
        collapsible: true,
        keys: ["excursionRate", "excursionDepth"],
        title: "Modulation",
      },
      { collapsible: true, keys: ["dry", "wet"], title: "Levels" },
    ],
  },
  /**
   * EffectParams draws the 7-Band EQ with RevampParams, so only a Node
   * body reads this row: four of its band gains.
   */
  revamp: {
    bipolar: ["lowShelfGain", "lowBellGain", "midBellGain", "highBellGain"],
    labels: {
      highBellGain: "High",
      lowBellGain: "Low",
      lowShelfGain: "Low shelf",
      midBellGain: "Mid",
    },
    rows: [
      { keys: ["lowShelfGain", "lowBellGain", "midBellGain", "highBellGain"] },
    ],
  },
  stereoTool: {
    bipolar: ["volume", "stereo", "panning"],
    labels: {
      invertL: "Invert L",
      invertR: "Invert R",
      panLaw: "Pan law",
      panning: "Pan",
      stereo: "Width",
      swap: "Swap L/R",
      volume: "Volume",
    },
    rows: [
      { keys: ["volume", "stereo", "panning", "panLaw"] },
      { keys: ["invertL", "invertR", "swap"], title: "Channels" },
    ],
  },
  tidal: {
    bipolar: ["slope", "offset", "channelOffset"],
    labels: { channelOffset: "L/R offset", rateDivision: "Rate" },
    rows: [
      { keys: ["rateDivision", "depth", "slope", "symmetry"] },
      { keys: ["offset", "channelOffset"], title: "Phase" },
    ],
  },
  vocoder: {
    labels: {
      carrierMaxFreq: "Max",
      carrierMinFreq: "Min",
      envAttack: "Attack",
      envRelease: "Release",
      gain: "Output",
      mix: "Blend",
      modulatorMaxFreq: "Max",
      modulatorMinFreq: "Min",
      modulatorSource: "Modulator",
      qEnd: "Q end",
      qStart: "Q start",
    },
    rows: [
      { keys: ["bandCount", "modulatorSource"] },
      { keys: ["carrierMinFreq", "carrierMaxFreq"], title: "Carrier" },
      { keys: ["modulatorMinFreq", "modulatorMaxFreq"], title: "Modulator" },
      { keys: ["envAttack", "envRelease"], title: "Envelope" },
      { keys: ["gain", "mix"] },
      { collapsible: true, keys: ["qStart", "qEnd"], title: "Filter bank" },
    ],
  },
  waveshaper: {
    bipolar: ["deviceOutputGain"],
    labels: {
      deviceInputGain: "Drive",
      deviceOutputGain: "Output",
      equation: "Curve",
      mix: "Blend",
    },
    rows: [
      { keys: ["equation", "deviceInputGain", "deviceOutputGain", "mix"] },
    ],
  },
};

const DEVICE_PREFIX = /^Device /;

/** "Device Dry" and friends are engine wording; the knob just says "Dry". */
export function shortLabel(label: string): string {
  return label.replace(DEVICE_PREFIX, "");
}
