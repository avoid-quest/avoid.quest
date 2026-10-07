/**
 * Split Stage
 *
 * A Split, Stereo Split or Band Split whose branches go to different
 * places, in Web Audio: one output per cabled port. The ports partition
 * the signal: together they carry what the same container outputs when its
 * branches rejoin at a unity Merge.
 *
 * - Stereo Split: port k carries channel k only, on its own side.
 * - Band Split: port k carries band k, in openDAW's crossover layout: each
 *   band is the Linkwitz-Riley lowpass of what the bands below it left,
 *   which is then subtracted, so the bands sum back to the input. The
 *   coefficients are @opendaw/lib-dsp's (BiquadCoeff), run by
 *   IIRFilterNodes.
 * - Split: every port takes the whole signal.
 *
 * Each port is Out · [(1 − w) · dry + w · In · gate · gain · pan(signal)]
 * while the split is on, as openDAW's wrapper runs a container: the input
 * trim on the wet path, the output trim after the mix. While it is off the
 * port is its dry signal alone, untrimmed. Here w is the mix, gate is 0 for
 * a muted or unsoloed chain, dry is the port's own band or channel, or for a
 * Split the whole signal shared by the cabled ports, and pan is openDAW's
 * linear balance (`StereoMatrix.panningToGains`), with no crossfeed.
 *
 * Its input and its ports' outputs stay the same nodes across updates, so
 * what connects to them stays connected; a new crossover or port set
 * rebuilds only what lies between them.
 */

import { BiquadCoeff, Mixing, StereoMatrix } from "@opendaw/lib-dsp";
import type {
  EffectChainConfig,
  FrequencySplitConfig,
  FxCompositeConfig,
  StereoSplitConfig,
} from "../dsp/effects/types.js";
import { safeDisconnect } from "../utils.js";
import { settleParam } from "./sends.js";

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

type Port = {
  dry: GainNode;
  wet: GainNode;
  /** The wet path's balance: each side through its own gain. */
  left: GainNode;
  right: GainNode;
  out: GainNode;
  /** The wet path's nodes between `wet` and `out`. */
  balance: AudioNode[];
};

/** A Linkwitz-Riley lowpass: two Butterworth biquads in series. */
const BUTTERWORTH_Q = Math.SQRT1_2;

function chainsInOrder(effect: SplitEffect): EffectChainConfig[] {
  return [...effect.chains].sort((left, right) => left.order - right.order);
}

/** What a rebuild depends on; parameters ramp in place. */
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
  const ports = new Map<number, Port>();
  /** Nodes between the input and the ports, rebuilt with the shape. */
  let between: AudioNode[] = [];
  let shape = "";
  let config = initial;

  const portFor = (position: number): Port => {
    const known = ports.get(position);
    if (known) {
      return known;
    }
    const sides = context.createChannelSplitter(2);
    const merger = context.createChannelMerger(2);
    const port: Port = {
      balance: [sides, merger],
      dry: context.createGain(),
      left: context.createGain(),
      out: context.createGain(),
      right: context.createGain(),
      wet: context.createGain(),
    };
    port.dry.gain.value = 0;
    port.wet.gain.value = 0;
    port.wet.connect(sides);
    sides.connect(port.left, 0);
    sides.connect(port.right, 1);
    port.left.connect(merger, 0, 0);
    port.right.connect(merger, 0, 1);
    merger.connect(port.out);
    port.dry.connect(port.out);
    ports.set(position, port);
    return port;
  };

  /** Feeds `signal` into the port's dry and wet paths. */
  const feed = (signal: AudioNode, port: Port, output = 0) => {
    signal.connect(port.dry, output);
    signal.connect(port.wet, output);
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
      feed(side, portFor(position));
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
        feed(signal, portFor(band));
      }
    }
  };

  const rewire = () => {
    unwire();
    const { effect, cabled } = config;
    for (const [position, port] of ports) {
      if (!cabled.includes(position)) {
        safeDisconnect(port.out, "SplitStage.rewire");
        ports.delete(position);
      }
    }
    if (effect.type === "stereoSplit") {
      wireStereo(cabled);
    } else if (effect.type === "frequencySplit") {
      wireBands(effect, cabled);
    } else {
      for (const position of cabled) {
        feed(input, portFor(position));
      }
    }
  };

  const settle = () => {
    const { effect, cabled } = config;
    const chains = chainsInOrder(effect);
    const mix = effect.enabled ? effect.dryWet : 0;
    const anySolo = chains.some((chain) => chain.solo);
    // A Split's dry signal is shared out among the ports it reaches.
    const dryShare = effect.type === "fxComposite" ? 1 / cabled.length : 1;
    const trim = effect.enabled ? effect.outputGain : 1;
    for (const [position, port] of ports) {
      const chain = chains[position];
      const open = chain && !(chain.muted || (anySolo && !chain.solo));
      const [left, right] = StereoMatrix.panningToGains(
        chain?.pan ?? 0,
        Mixing.Linear
      );
      settleParam(port.dry.gain, context, (1 - mix) * dryShare);
      settleParam(
        port.wet.gain,
        context,
        open ? mix * effect.inputGain * chain.gain : 0
      );
      settleParam(port.left.gain, context, left);
      settleParam(port.right.gain, context, right);
      settleParam(port.out.gain, context, trim);
    }
  };

  const update = (next: SplitStageConfig) => {
    config = next;
    const nextShape = shapeOf(next);
    if (nextShape !== shape) {
      shape = nextShape;
      rewire();
    }
    settle();
  };

  update(initial);

  return {
    dispose() {
      unwire();
      for (const port of ports.values()) {
        for (const node of [
          port.dry,
          port.wet,
          port.left,
          port.right,
          port.out,
          ...port.balance,
        ]) {
          safeDisconnect(node, "SplitStage.dispose");
        }
      }
      ports.clear();
      safeDisconnect(input, "SplitStage.dispose");
    },
    input,
    port: (position) => ports.get(position)?.out ?? null,
    update,
  };
}
