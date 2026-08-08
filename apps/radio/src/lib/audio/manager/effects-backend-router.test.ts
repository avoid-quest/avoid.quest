import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import { EffectsBackendRouter } from "./effects-backend-router.js";

class TestAudioParam {
  value = 0;
  readonly ramps: Array<{ time: number; value: number }> = [];

  cancelScheduledValues(_time: number): void {
    // Scheduling history is asserted through the final ramps.
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.ramps.push({ time, value });
  }

  setValueAtTime(value: number, _time: number): void {
    this.value = value;
  }
}

class TestAudioNode {
  readonly connections = new Set<TestAudioNode>();
  readonly context: TestAudioContext;

  constructor(context: TestAudioContext) {
    this.context = context;
  }

  connect(destination: TestAudioNode): TestAudioNode {
    this.connections.add(destination);
    return destination;
  }

  disconnect(destination?: TestAudioNode): void {
    if (destination) {
      this.connections.delete(destination);
    } else {
      this.connections.clear();
    }
  }
}

class TestGainNode extends TestAudioNode {
  readonly gain = new TestAudioParam();
}

class TestAudioContext {
  currentTime = 2;

  createGain(): GainNode {
    return new TestGainNode(this) as unknown as GainNode;
  }
}

afterEach(() => {
  jest.useRealTimers();
});

describe("EffectsBackendRouter", () => {
  test("ramps backend swaps and releases only the latest settled route", () => {
    jest.useFakeTimers();
    const context = new TestAudioContext();
    const source = new TestAudioNode(context);
    const destination = new TestAudioNode(context);
    const router = new EffectsBackendRouter(
      source as unknown as AudioNode,
      destination as unknown as AudioNode,
      false
    );
    const firstRelease = mock(() => undefined);
    const secondRelease = mock(() => undefined);

    router.switchTo("official", firstRelease);
    router.switchTo("compatibility", secondRelease);

    const officialGain = router.officialGain as unknown as TestGainNode;
    const compatibilityGain =
      router.compatibilityGain as unknown as TestGainNode;
    expect(officialGain.gain.ramps.at(-1)).toEqual({ time: 2.03, value: 0 });
    expect(compatibilityGain.gain.ramps.at(-1)).toEqual({
      time: 2.03,
      value: 1,
    });
    jest.advanceTimersByTime(40);
    expect(firstRelease).not.toHaveBeenCalled();
    expect(secondRelease).toHaveBeenCalledTimes(1);
  });

  test("disconnect cancels delayed release and removes every native edge", () => {
    jest.useFakeTimers();
    const context = new TestAudioContext();
    const source = new TestAudioNode(context);
    const destination = new TestAudioNode(context);
    const router = new EffectsBackendRouter(
      source as unknown as AudioNode,
      destination as unknown as AudioNode,
      false
    );
    const release = mock(() => undefined);
    router.switchTo("official", release);

    router.disconnect();
    jest.advanceTimersByTime(40);

    expect(release).not.toHaveBeenCalled();
    expect(source.connections.size).toBe(0);
    expect(
      (router.bypassGain as unknown as TestAudioNode).connections.size
    ).toBe(0);
    expect(
      (router.compatibilityGain as unknown as TestAudioNode).connections.size
    ).toBe(0);
    expect(
      (router.officialGain as unknown as TestAudioNode).connections.size
    ).toBe(0);
  });
});
