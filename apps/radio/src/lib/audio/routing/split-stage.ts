/**
 * Split Stage
 *
 * A Split, Stereo Split or Band Split whose branches go to different
 * places, in Web Audio: one output per cabled port, the signal its branch
 * starts from. The ports partition the signal:
 *
 * - Stereo Split: port k carries channel k only, on its own side.
 * - Band Split: port k carries band k, in openDAW's crossover layout: each
 *   band is the Linkwitz-Riley lowpass of what the bands below it left,
 *   which is then subtracted, so the bands sum back to the input. The
 *   coefficients are @opendaw/lib-dsp's (BiquadCoeff), run by
 *   IIRFilterNodes; a crossover at or past Nyquist passes everything, as
 *   BiquadCoeff gives it.
 * - Split: every port takes the whole signal.
 *
 * The signal trim precedes every port while the Split is enabled.
 * What openDAW's container does to a branch after this, its input trim,
 * FX, gain, balance, mute and solo, its dry/wet mix and output trim, is in
 * the cables the compiler plans from each port.
 *
 * Its input and its ports' outputs stay the same nodes across updates, so
 * what connects to them stays connected; a new crossover or port set
 * rebuilds only what lies between them.
 */

import { BiquadCoeff } from "@opendaw/lib-dsp";
import type {
  FrequencySplitConfig,
  FxCompositeConfig,
  StereoSplitConfig,
} from "../dsp/effects/types.js";
import { safeDisconnect } from "../utils.js";
import { settleGain } from "./sends.js";

export type SplitEffect =
  | FxCompositeConfig
  | StereoSplitConfig
  | FrequencySplitConfig;

export type SplitStageConfig = {
  effect: SplitEffect;
  /** The cabled ports, by position in the split's chain order. */
  cabled: readonly number[];
};

export type SplitStage = {
  readonly input: AudioNode;
  /** The output of the port at `position`, while it is cabled. */
  port: (position: number) => AudioNode | null;
  update: (config: SplitStageConfig) => void;
  dispose: () => void;
};

/** A Linkwitz-Riley lowpass: two Butterworth biquads in series. */
const BUTTERWORTH_Q = Math.SQRT1_2;

/** What a rebuild depends on. */
function shapeOf({ effect, cabled }: SplitStageConfig): string {
  return JSON.stringify([
    effect.type,
    [...cabled].sort((left, right) => left - right),
    effect.type === "frequencySplit" ? effect.crossoverFrequencies : null,
  ]);
}

/** The lowpass at `frequency` as an IIRFilterNode, lib-dsp's coefficients. */
function lowpass(context: BaseAudioContext, frequency: number): IIRFilterNode {
  const coefficients = new BiquadCoeff().setLowpassParams(
    frequency / context.sampleRate,
    BUTTERWORTH_Q
  );
  return context.createIIRFilter(
    [coefficients.b0, coefficients.b1, coefficients.b2],
    [1, coefficients.a1, coefficients.a2]
  );
}

export function createSplitStage(
  context: BaseAudioContext,
  initial: SplitStageConfig
): SplitStage {
  const input = context.createGain();
  const ports = new Map<number, GainNode>();
  /** Nodes between the input and the ports, rebuilt with the shape. */
  let between: AudioNode[] = [];
  let shape = "";

  const portFor = (position: number): GainNode => {
    const known = ports.get(position) ?? context.createGain();
    ports.set(position, known);
    return known;
  };

  /** The input's own outputs are all inside the stage. */
  const unwire = () => {
    safeDisconnect(input, "SplitStage.rebuild");
    for (const node of between) {
      safeDisconnect(node, "SplitStage.rebuild");
    }
    between = [];
  };

  const wireStereo = (cabled: readonly number[]) => {
    const splitter = context.createChannelSplitter(2);
    input.connect(splitter);
    between.push(splitter);
    for (const position of cabled) {
      // Channel k stays on side k, so the ports sum back to the input.
      const side = context.createChannelMerger(2);
      splitter.connect(side, position, position);
      side.connect(portFor(position));
      between.push(side);
    }
  };

  const wireBands = (
    effect: FrequencySplitConfig,
    cabled: readonly number[]
  ) => {
    let remainder: AudioNode = input;
    const bandCount = effect.crossoverFrequencies.length + 1;
    for (let band = 0; band < bandCount; band += 1) {
      const frequency = effect.crossoverFrequencies[band];
      let signal: AudioNode = remainder;
      if (frequency !== undefined) {
        const first = lowpass(context, frequency);
        const second = lowpass(context, frequency);
        const subtract = context.createGain();
        const rest = context.createGain();
        subtract.gain.value = -1;
        remainder.connect(first);
        first.connect(second);
        second.connect(subtract);
        remainder.connect(rest);
        subtract.connect(rest);
        between.push(first, second, subtract, rest);
        signal = second;
        remainder = rest;
      }
      if (cabled.includes(band)) {
        signal.connect(portFor(band));
      }
    }
  };

  const update = ({ effect, cabled }: SplitStageConfig) => {
    // The official wrapper's signal trim precedes both dry and wet paths.
    settleGain(input, effect.enabled ? (effect.signalGain ?? 1) : 1);
    const next = shapeOf({ cabled, effect });
    if (next === shape) {
      return;
    }
    shape = next;
    unwire();
    for (const [position, port] of ports) {
      if (!cabled.includes(position)) {
        safeDisconnect(port, "SplitStage.rewire");
        ports.delete(position);
      }
    }
    if (effect.type === "stereoSplit") {
      wireStereo(cabled);
    } else if (effect.type === "frequencySplit") {
      wireBands(effect, cabled);
    } else {
      for (const position of cabled) {
        input.connect(portFor(position));
      }
    }
  };

  update(initial);

  return {
    dispose() {
      unwire();
      for (const port of ports.values()) {
        safeDisconnect(port, "SplitStage.dispose");
      }
      ports.clear();
    },
    input,
    port: (position) => ports.get(position) ?? null,
    update,
  };
}
