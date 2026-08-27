import { describe, expect, test } from "bun:test";
import { createBrowserOutputAdapter } from "./browser-output-adapter";

class FakeAudioNode {
  readonly connections = new Set<AudioNode>();
  readonly context: AudioContext;

  constructor(context: AudioContext) {
    this.context = context;
  }

  connect(destination: AudioNode): AudioNode {
    this.connections.add(destination);
    return destination;
  }

  disconnect(destination?: AudioNode): void {
    if (destination) {
      this.connections.delete(destination);
      return;
    }
    this.connections.clear();
  }
}

class FakeDelayNode extends FakeAudioNode {
  readonly delayTime = {
    setTargetAtTime: () => undefined,
  };
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = {
    setTargetAtTime: () => undefined,
  };
}

class FakeAudioContext {
  readonly currentTime = 0;
  readonly delays: FakeDelayNode[] = [];
  readonly destination: AudioDestinationNode;
  readonly gains: FakeGainNode[] = [];

  constructor() {
    this.destination = new FakeAudioNode(
      this as unknown as AudioContext
    ) as unknown as AudioDestinationNode;
  }

  createDelay(): DelayNode {
    const delay = new FakeDelayNode(this as unknown as AudioContext);
    this.delays.push(delay);
    return delay as unknown as DelayNode;
  }

  createGain(): GainNode {
    const gain = new FakeGainNode(this as unknown as AudioContext);
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }
}

const createSource = (context: AudioContext): FakeAudioNode =>
  new FakeAudioNode(context);

describe("BrowserOutputAdapter", () => {
  test("feeds delayed and realtime routes into one silent master meter tap", () => {
    const context = new FakeAudioContext();
    const graph = createBrowserOutputAdapter().createGraph(
      context as unknown as AudioContext
    );
    const delayedSource = createSource(graph.context);
    const realtimeSource = createSource(graph.context);
    const meter = createSource(graph.context);
    const mainDelay = context.delays[0] as unknown as AudioNode;

    graph.mainOutput.connect(meter as unknown as AudioNode);
    graph.connectMain(delayedSource as unknown as AudioNode);
    graph.connectMain(realtimeSource as unknown as AudioNode, true);

    expect(delayedSource.connections).toEqual(
      new Set([graph.mainOutput, mainDelay])
    );
    expect(realtimeSource.connections).toEqual(
      new Set([graph.mainOutput, context.destination])
    );
    expect((graph.mainOutput as unknown as FakeAudioNode).connections).toEqual(
      new Set([meter as unknown as AudioNode])
    );

    graph.disconnectMain(delayedSource as unknown as AudioNode);
    graph.disconnectMain(realtimeSource as unknown as AudioNode);
    expect(delayedSource.connections).toEqual(new Set());
    expect(realtimeSource.connections).toEqual(new Set());
  });
});
