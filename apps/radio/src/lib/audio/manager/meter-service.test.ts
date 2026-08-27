import { describe, expect, mock, test } from "bun:test";
import {
  type FallbackMeterFactory,
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
    expect(service.getDiagnostics()).toEqual({
      activeFallbackMeters: 0,
      activeOpenDawMeters: 1,
      listenerCount: 1,
    });

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

  test("reactivates after the source changes during async meter setup", async () => {
    const firstSource = new FakeAudioNode();
    const secondSource = new FakeAudioNode();
    const meters = [new FakeMeterNode(), new FakeMeterNode()];
    let resolveFirst: ((meter: OpenDawMeterNode) => void) | undefined;
    let factoryCalls = 0;
    const factory = mock(() =>
      ++factoryCalls === 1
        ? new Promise<OpenDawMeterNode>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(meters[1] as unknown as OpenDawMeterNode)
    ) as MeterNodeFactory;
    const service = new MeterService(factory);
    service.subscribeMeter("deck-a", () => undefined);

    const first = service.setSoundSource(
      "deck-a",
      firstSource as unknown as AudioNode
    );
    const second = service.setSoundSource(
      "deck-a",
      secondSource as unknown as AudioNode
    );
    resolveFirst?.(meters[0] as unknown as OpenDawMeterNode);
    await Promise.all([first, second]);
    await Promise.resolve();

    expect(factory).toHaveBeenCalledTimes(2);
    expect(meters[0].terminated).toBe(true);
    expect(firstSource.connections.size).toBe(0);
    expect(secondSource.connections.has(meters[1])).toBe(true);
  });

  test("falls back to a native meter when openDAW meter setup fails", async () => {
    const source = new FakeAudioNode();
    const fallbackInput = new FakeAudioNode();
    const terminate = mock(() => undefined);
    const observers: ((level: { left: number; right: number }) => void)[] = [];
    const fallbackFactory = mock((_context, observer) => {
      observers.push(observer);
      return {
        input: fallbackInput as unknown as AudioNode,
        terminate,
      };
    }) as FallbackMeterFactory;
    const service = new MeterService(
      () => Promise.reject(new Error("meter assets unavailable")),
      fallbackFactory
    );
    const levels: Array<{ left: number; right: number }> = [];
    const originalWarn = console.warn;
    console.warn = mock(() => undefined);

    try {
      const unsubscribe = service.subscribeMeter("deck-a", (level) =>
        levels.push(level)
      );
      await service.setSoundSource("deck-a", source as unknown as AudioNode);
      observers[0]?.({ left: 0.3, right: 0.6 });

      expect(fallbackFactory).toHaveBeenCalledTimes(1);
      expect(source.connections.has(fallbackInput)).toBe(true);
      expect(levels).toEqual([{ left: 0.3, right: 0.6 }]);

      unsubscribe();
      expect(terminate).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = originalWarn;
      service.clear();
    }
  });

  test("shares one fallback across subscribers and releases it once", async () => {
    const source = new FakeAudioNode();
    const fallbackInput = new FakeAudioNode();
    const terminate = mock(() => undefined);
    let observer:
      | ((level: { left: number; right: number }) => void)
      | undefined;
    const fallbackFactory = mock((_context, nextObserver) => {
      observer = nextObserver;
      return {
        input: fallbackInput as unknown as AudioNode,
        terminate,
      };
    }) as FallbackMeterFactory;
    const service = new MeterService(
      () => Promise.reject(new Error("meter assets unavailable")),
      fallbackFactory
    );
    const first: Array<{ left: number; right: number }> = [];
    const second: Array<{ left: number; right: number }> = [];
    const originalWarn = console.warn;
    console.warn = mock(() => undefined);

    try {
      const unsubscribeFirst = service.subscribeMeter("deck-a", (level) =>
        first.push(level)
      );
      await service.setSoundSource("deck-a", source as unknown as AudioNode);
      const unsubscribeSecond = service.subscribeMeter("deck-a", (level) =>
        second.push(level)
      );
      await Promise.resolve();
      observer?.({ left: 0.2, right: 0.4 });

      expect(fallbackFactory).toHaveBeenCalledTimes(1);
      expect(source.connections.size).toBe(1);
      expect(first).toEqual([{ left: 0.2, right: 0.4 }]);
      expect(second).toEqual([{ left: 0.2, right: 0.4 }]);

      unsubscribeFirst();
      expect(terminate).not.toHaveBeenCalled();
      unsubscribeSecond();
      expect(terminate).toHaveBeenCalledTimes(1);
      expect(source.connections.size).toBe(0);
    } finally {
      console.warn = originalWarn;
      service.clear();
    }
  });

  test("replaces a fallback source without overlap and can reactivate later", async () => {
    const firstSource = new FakeAudioNode();
    const secondSource = new FakeAudioNode();
    const fallbackInputs: FakeAudioNode[] = [];
    const terminations: ReturnType<typeof mock>[] = [];
    const fallbackFactory = mock(() => {
      const input = new FakeAudioNode();
      const terminate = mock(() => undefined);
      fallbackInputs.push(input);
      terminations.push(terminate);
      return {
        input: input as unknown as AudioNode,
        terminate,
      };
    }) as FallbackMeterFactory;
    const service = new MeterService(
      () => Promise.reject(new Error("meter assets unavailable")),
      fallbackFactory
    );
    const originalWarn = console.warn;
    console.warn = mock(() => undefined);

    try {
      const unsubscribe = service.subscribeMeter("deck-a", () => undefined);
      await service.setSoundSource(
        "deck-a",
        firstSource as unknown as AudioNode
      );
      await service.setSoundSource(
        "deck-a",
        secondSource as unknown as AudioNode
      );

      expect(fallbackFactory).toHaveBeenCalledTimes(2);
      expect(terminations[0]).toHaveBeenCalledTimes(1);
      expect(firstSource.connections.size).toBe(0);
      expect(secondSource.connections.has(fallbackInputs[1])).toBe(true);

      unsubscribe();
      expect(terminations[1]).toHaveBeenCalledTimes(1);
      const resubscribe = service.subscribeMeter("deck-a", () => undefined);
      await Promise.resolve();
      await Promise.resolve();
      expect(fallbackFactory).toHaveBeenCalledTimes(3);
      resubscribe();
      expect(terminations[2]).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = originalWarn;
      service.clear();
    }
  });
});
