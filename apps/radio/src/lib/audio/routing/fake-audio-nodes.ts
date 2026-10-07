/**
 * Recording Web Audio fakes for tests: enough of AudioContext, GainNode,
 * BiquadFilterNode, StereoPannerNode and AudioParam to follow connections
 * and every scheduled change.
 */

export type ParamEvent =
  | { type: "cancel"; time: number }
  | { type: "set"; time: number; value: number }
  | { type: "target"; time: number; timeConstant: number; value: number }
  | { type: "linear"; time: number; value: number };

export class FakeAudioParam {
  readonly events: ParamEvent[] = [];
  value: number;

  constructor(value: number) {
    this.value = value;
  }

  cancelScheduledValues(time: number): void {
    this.events.push({ time, type: "cancel" });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.events.push({ time, type: "linear", value });
  }

  setTargetAtTime(value: number, time: number, timeConstant: number): void {
    this.events.push({ time, timeConstant, type: "target", value });
  }

  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.events.push({ time, type: "set", value });
  }
}

export class FakeGainNode {
  readonly connections = new Set<unknown>();
  readonly context: FakeAudioContext;
  readonly gain: FakeAudioParam;

  constructor(context: FakeAudioContext, value = 1) {
    this.context = context;
    this.gain = new FakeAudioParam(value);
  }

  connect(destination: unknown): unknown {
    this.connections.add(destination);
    return destination;
  }

  disconnect(destination?: unknown): void {
    if (destination === undefined) {
      this.connections.clear();
      return;
    }
    this.connections.delete(destination);
  }
}

/** A MediaStreamDestination: a node with a stream whose tracks stop. */
export class FakeMediaStreamDestination extends FakeGainNode {
  readonly stopped: boolean[] = [];
  readonly stream = {
    getTracks: () => [{ stop: () => this.stopped.push(true) }],
  };
}

/** A BiquadFilterNode: its type, frequency and Q. */
export class FakeFilterNode extends FakeGainNode {
  type = "lowpass";
  readonly frequency = new FakeAudioParam(350);
  readonly Q = new FakeAudioParam(1);
}

/** A StereoPannerNode: its pan. */
export class FakePannerNode extends FakeGainNode {
  readonly pan = new FakeAudioParam(0);
}

/** A DelayNode: its delay time. */
export class FakeDelayNode extends FakeGainNode {
  readonly delayTime = new FakeAudioParam(0);
}

export class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = 48_000;
  readonly gains: FakeGainNode[] = [];
  readonly destinations: FakeMediaStreamDestination[] = [];
  readonly filters: FakeFilterNode[] = [];
  readonly panners: FakePannerNode[] = [];
  readonly delays: FakeDelayNode[] = [];

  createDelay(): DelayNode {
    const node = new FakeDelayNode(this);
    this.delays.push(node);
    return node as unknown as DelayNode;
  }

  createBiquadFilter(): BiquadFilterNode {
    const filter = new FakeFilterNode(this);
    this.filters.push(filter);
    return filter as unknown as BiquadFilterNode;
  }

  createStereoPanner(): StereoPannerNode {
    const panner = new FakePannerNode(this);
    this.panners.push(panner);
    return panner as unknown as StereoPannerNode;
  }

  createGain(): GainNode {
    const gain = new FakeGainNode(this);
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }

  createMediaStreamDestination(): MediaStreamAudioDestinationNode {
    const destination = new FakeMediaStreamDestination(this);
    this.destinations.push(destination);
    return destination as unknown as MediaStreamAudioDestinationNode;
  }
}

/** A sound's fader, as AudioManager would pass it to an output connector. */
export function createFakeFader(context: FakeAudioContext, value = 0.8) {
  const fader = new FakeGainNode(context, value);
  return { fader, node: fader as unknown as AudioNode };
}
