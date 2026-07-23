import { describe, expect, mock, test } from "bun:test";
import {
  type MeterNodeFactory,
  MeterService,
  type OpenDawMeterNode,
} from "./meter-service";

type MeterValues = {
  peak: Float32Array;
};

class FakeAudioNode {
  readonly connections = new Set<FakeAudioNode>();
  readonly context = {
    destination: {} as AudioDestinationNode,
  } as BaseAudioContext;

  connect(destination: FakeAudioNode): FakeAudioNode {
    this.connections.add(destination);
    return destination;
  }

  disconnect(destination?: FakeAudioNode): void {
    if (destination) {
      this.connections.delete(destination);
    } else {
      this.connections.clear();
    }
  }
}

class FakeMeterNode extends FakeAudioNode {
  observer: ((values: MeterValues) => void) | null = null;
  terminated = false;

  emit(left: number, right: number): void {
    this.observer?.({
      peak: new Float32Array([left, right]),
    });
  }

  subscribe(observer: (values: MeterValues) => void) {
    this.observer = observer;
    return {
      terminate: () => {
        this.observer = null;
      },
    };
  }

  terminate(): void {
    this.terminated = true;
    this.observer = null;
  }
}

function createHarness() {
  const meters: FakeMeterNode[] = [];
  const factory = mock(() => {
    const meter = new FakeMeterNode();
    meters.push(meter);
    return Promise.resolve(meter as unknown as OpenDawMeterNode);
  }) as MeterNodeFactory;
  return {
    factory,
    meters,
    service: new MeterService(factory),
  };
}

describe("MeterService", () => {
  test("uses one stereo openDAW meter as an engine-independent post-fader tap", async () => {
    const { factory, meters, service } = createHarness();
    const source = new FakeAudioNode();
    const levels: Array<{ left: number; right: number }> = [];

    service.subscribeMeter("deck-a", (level) => levels.push(level));
    await service.setSoundSource("deck-a", source as unknown as AudioNode);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(source.connections.has(meters[0])).toBe(true);

    meters[0].emit(0.25, 0.5);
    meters[0].emit(0.125, 0.75);

    expect(levels).toEqual([
      { left: 0.25, right: 0.5 },
      { left: 0.125, right: 0.75 },
    ]);
  });

  test("creates meters lazily and releases them with the last subscriber", async () => {
    const { factory, meters, service } = createHarness();
    const source = new FakeAudioNode();

    await service.setSoundSource("deck-a", source as unknown as AudioNode);
    expect(factory).not.toHaveBeenCalled();

    const unsubscribe = service.subscribeMeter("deck-a", () => undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(factory).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(meters[0].terminated).toBe(true);
    expect(source.connections.size).toBe(0);
  });

  test("clears a sound meter without dropping its live UI subscription", async () => {
    const { meters, service } = createHarness();
    const source = new FakeAudioNode();
    const levels: Array<{ left: number; right: number }> = [];
    service.subscribeMeter("deck-a", (level) => levels.push(level));

    await service.setSoundSource("deck-a", source as unknown as AudioNode);
    service.clearSoundSource("deck-a");

    expect(meters[0].terminated).toBe(true);
    expect(levels.at(-1)).toEqual({ left: 0, right: 0 });
  });

  test("starts the master meter when its subscriber mounts before the graph", async () => {
    const { factory, meters, service } = createHarness();
    const source = new FakeAudioNode();
    const levels: Array<{ left: number; right: number }> = [];

    service.subscribeMasterMeter((level) => levels.push(level));
    expect(factory).not.toHaveBeenCalled();

    await service.setMasterSource(source as unknown as AudioNode);
    meters[0].emit(0.5, 0.25);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(levels).toEqual([{ left: 0.5, right: 0.25 }]);
  });
});
