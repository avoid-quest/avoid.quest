/**
 * Recording Web Audio fakes for tests: enough of AudioContext, GainNode and
 * AudioParam to follow connections and every scheduled gain change.
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

export class FakeAudioContext {
  currentTime = 0;
  readonly gains: FakeGainNode[] = [];

  createGain(): GainNode {
    const gain = new FakeGainNode(this);
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }
}

/** A sound's fader, as AudioManager would pass it to an output connector. */
export function createFakeFader(context: FakeAudioContext, value = 0.8) {
  const fader = new FakeGainNode(context, value);
  return { fader, node: fader as unknown as AudioNode };
}
