/**
 * Offline Graph
 *
 * A tiny offline Web Audio for tests, where Bun has none: enough of
 * AudioContext to build a graph of gains, IIR filters, channel splitters
 * and mergers and delays, then render a stereo buffer through it, sample
 * exact. Params hold their last scheduled value, so it renders the steady
 * state a graph ramps to. Channel counts follow Web Audio's speaker rules
 * where these nodes meet: a mono input to a stereo node plays on both
 * sides, a merger input takes the mono down-mix.
 */

type Signal = Float32Array[];

class OfflineParam {
  value: number;

  constructor(value: number) {
    this.value = value;
  }

  setTargetAtTime(value: number): void {
    this.value = value;
  }

  setValueAtTime(value: number): void {
    this.value = value;
  }

  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }

  cancelScheduledValues(): void {
    // Steady state only: nothing scheduled to cancel.
  }

  cancelAndHoldAtTime(): void {
    // Steady state only: nothing scheduled to hold.
  }
}

type Link = { to: OfflineNode; output: number; input: number };

export class OfflineNode {
  readonly context: OfflineGraph;
  readonly links: Link[] = [];
  readonly gain = new OfflineParam(1);
  readonly delayTime = new OfflineParam(0);
  readonly process: (inputs: Signal[], node: OfflineNode) => Signal[];

  constructor(
    context: OfflineGraph,
    process: (inputs: Signal[], node: OfflineNode) => Signal[]
  ) {
    this.context = context;
    this.process = process;
    context.nodes.push(this);
  }

  connect(to: OfflineNode, output = 0, input = 0): OfflineNode {
    this.links.push({ input, output, to });
    return to;
  }

  disconnect(to?: OfflineNode): void {
    for (let index = this.links.length - 1; index >= 0; index -= 1) {
      if (to === undefined || this.links[index]?.to === to) {
        this.links.splice(index, 1);
      }
    }
  }
}

function zeros(frames: number): Float32Array {
  return new Float32Array(frames);
}

/** Sums signals into one, a mono one up-mixed to both sides of a stereo. */
function sum(signals: Signal[], frames: number): Signal {
  const channels = Math.max(1, ...signals.map((signal) => signal.length));
  const out = Array.from({ length: channels }, () => zeros(frames));
  for (const signal of signals) {
    for (let channel = 0; channel < channels; channel += 1) {
      const from = signal.length === 1 ? signal[0] : signal[channel];
      const into = out[channel];
      if (!(from && into)) {
        continue;
      }
      for (let frame = 0; frame < frames; frame += 1) {
        into[frame] = (into[frame] ?? 0) + (from[frame] ?? 0);
      }
    }
  }
  return out;
}

function mono(signal: Signal, frames: number): Float32Array {
  if (signal.length === 1) {
    return signal[0] ?? zeros(frames);
  }
  const out = zeros(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    out[frame] = ((signal[0]?.[frame] ?? 0) + (signal[1]?.[frame] ?? 0)) / 2;
  }
  return out;
}

export class OfflineGraph {
  readonly sampleRate: number;
  readonly currentTime = 0;
  readonly nodes: OfflineNode[] = [];

  constructor(sampleRate = 48_000) {
    this.sampleRate = sampleRate;
  }

  createGain(): OfflineNode {
    return new OfflineNode(this, ([input = []], node) =>
      [sum([input], this.frames)].map((signal) =>
        signal.map((channel) => channel.map((x) => x * node.gain.value))
      )
    );
  }

  createIIRFilter(feedforward: number[], feedback: number[]): OfflineNode {
    const [a0 = 1, a1 = 0, a2 = 0] = feedback;
    const [b0 = 0, b1 = 0, b2 = 0] = feedforward;
    return new OfflineNode(this, ([input = []]) => [
      sum([input], this.frames).map((channel) => {
        const out = zeros(channel.length);
        let [x1, x2, y1, y2] = [0, 0, 0, 0];
        for (let frame = 0; frame < channel.length; frame += 1) {
          const x = channel[frame] ?? 0;
          const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
          [x2, x1, y2, y1] = [x1, x, y1, y];
          out[frame] = y;
        }
        return out;
      }),
    ]);
  }

  createChannelSplitter(outputs = 6): OfflineNode {
    return new OfflineNode(this, ([input = []]) => {
      const signal = sum([input], this.frames);
      return Array.from({ length: outputs }, (_, index) => [
        signal.length === 1 && index > 0
          ? zeros(this.frames)
          : (signal[index] ?? zeros(this.frames)),
      ]);
    });
  }

  createChannelMerger(inputs = 6): OfflineNode {
    return new OfflineNode(this, (signals) => [
      Array.from({ length: inputs }, (_, index) =>
        mono(sum([signals[index] ?? []], this.frames), this.frames)
      ),
    ]);
  }

  createDelay(): OfflineNode {
    return new OfflineNode(this, ([input = []], node) => {
      const samples = Math.round(node.delayTime.value * this.sampleRate);
      return [
        sum([input], this.frames).map((channel) => {
          const out = zeros(channel.length);
          // A delay as long as the render leaves it silent.
          if (samples < channel.length) {
            out.set(channel.subarray(0, channel.length - samples), samples);
          }
          return out;
        }),
      ];
    });
  }

  /** A stereo source playing `left` and `right`. */
  createSource(left: Float32Array, right: Float32Array): OfflineNode {
    return new OfflineNode(this, () => [[left, right]]);
  }

  private frames = 0;

  /** Renders what reaches `node`'s output `output`, `frames` long. */
  render(node: OfflineNode, frames: number, output = 0): Signal {
    this.frames = frames;
    const done = new Map<OfflineNode, Signal[]>();
    const outputs = (current: OfflineNode): Signal[] => {
      const known = done.get(current);
      if (known) {
        return known;
      }
      const inputs: Signal[][] = [];
      for (const from of this.nodes) {
        for (const link of from.links) {
          if (link.to === current) {
            const signals = inputs[link.input] ?? [];
            signals.push(outputs(from)[link.output] ?? []);
            inputs[link.input] = signals;
          }
        }
      }
      const result = current.process(
        inputs.map((signals) => sum(signals ?? [], frames)),
        current
      );
      done.set(current, result);
      return result;
    };
    return sum([outputs(node)[output] ?? []], frames);
  }
}

/** The RMS of `signal` minus `reference`, in dBFS, over the last `tail` frames. */
export function residualDb(
  signal: Signal,
  reference: Signal,
  tail: number
): number {
  let energy = 0;
  let count = 0;
  for (let channel = 0; channel < reference.length; channel += 1) {
    const got = signal.length === 1 ? signal[0] : signal[channel];
    const want = reference[channel];
    for (
      let frame = (want?.length ?? 0) - tail;
      frame < (want?.length ?? 0);
      frame += 1
    ) {
      const difference = (got?.[frame] ?? 0) - (want?.[frame] ?? 0);
      energy += difference * difference;
      count += 1;
    }
  }
  return 10 * Math.log10(energy / Math.max(1, count) + 1e-30);
}

function tone(frequency: number, amplitude: number, frames: number) {
  return Float32Array.from(
    { length: frames },
    (_, frame) =>
      amplitude * Math.sin((2 * Math.PI * frequency * frame) / 48_000)
  );
}

/** A broadband stereo test signal: tones across the bands, unlike per side. */
export function testProgram(frames: number): [Float32Array, Float32Array] {
  const left = tone(110, 0.25, frames);
  const right = tone(330, 0.2, frames);
  for (const [frequency, amplitude] of [
    [880, 0.1],
    [2500, 0.08],
    [7000, 0.05],
  ] as const) {
    const extra = tone(frequency, amplitude, frames);
    for (let frame = 0; frame < frames; frame += 1) {
      left[frame] = (left[frame] ?? 0) + (extra[frame] ?? 0);
      right[frame] = (right[frame] ?? 0) - (extra[frame] ?? 0);
    }
  }
  return [left, right];
}
