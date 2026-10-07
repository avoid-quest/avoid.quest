import { describe, expect, mock, test } from "bun:test";
import { FakeAudioContext, type FakeGainNode } from "./fake-audio-nodes";
import { RENDER_QUANTUM_FRAMES, type SendPlan, Sends } from "./sends";

function createHarness() {
  const context = new FakeAudioContext();
  const from = context.createGain() as unknown as FakeGainNode;
  /** What each destination takes. */
  const into = new Map<string, Set<unknown>>();
  const released = mock((_to: string) => undefined);
  const waits: (() => void)[] = [];
  const sends = new Sends(
    from as unknown as AudioNode,
    (to, node) => {
      const set = into.get(to) ?? new Set<unknown>();
      into.set(to, set);
      set.add(node);
      return () => {
        released(to);
        set.delete(node);
      };
    },
    () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      waits.push(() => resolve());
      return promise;
    }
  );
  const settle = (plans: Record<string, SendPlan>) =>
    sends.settle(new Map(Object.entries(plans)));
  const endFades = async () => {
    for (const end of waits.splice(0)) {
      end();
    }
    await Promise.resolve();
    await Promise.resolve();
  };
  return { context, endFades, from, into, released, sends, settle };
}

describe("Sends", () => {
  test("a cable that waits for a slower path plays through a DelayNode of whole render quanta", () => {
    const h = createHarness();
    h.settle({
      late: { delay: 2, level: 0.5, reenters: false, to: "sum:mix" },
    });

    const [delayNode] = h.context.delays;
    const seconds = (2 * RENDER_QUANTUM_FRAMES) / h.context.sampleRate;
    expect(delayNode?.delayTime.value).toBeCloseTo(seconds, 12);
    // gain → delay → destination, and only the delay reaches it.
    const [gain] = [...h.from.connections] as FakeGainNode[];
    expect(gain?.connections.has(delayNode)).toBe(true);
    expect(h.into.get("sum:mix")?.has(delayNode)).toBe(true);
    expect(gain?.gain.events.at(-1)).toMatchObject({ value: 0.5 });
  });

  test("a cable back into openDAW passes a DelayNode that adds no delay", () => {
    const h = createHarness();
    h.settle({ back: { delay: 0, level: 1, reenters: true, to: "unit:comp" } });

    const [delayNode] = h.context.delays;
    expect(delayNode?.delayTime.value).toBe(0);
    expect(h.into.get("unit:comp")?.has(delayNode)).toBe(true);
  });

  test("a cable with no wait connects its gain straight in", () => {
    const h = createHarness();
    h.settle({ now: { delay: 0, level: 1, reenters: false, to: "sink:out" } });

    expect(h.context.delays).toHaveLength(0);
    const [gain] = [...h.from.connections];
    expect(h.into.get("sink:out")?.has(gain)).toBe(true);
  });

  test("a new wait crossfades to a new cable, and the old one counts as an edge until it is gone", async () => {
    const h = createHarness();
    h.settle({ cable: { delay: 0, level: 1, reenters: false, to: "sum:mix" } });
    const [before] = [...h.from.connections] as FakeGainNode[];

    h.settle({ cable: { delay: 1, level: 1, reenters: false, to: "sum:mix" } });

    expect(before?.gain.events.at(-1)).toMatchObject({ value: 0 });
    expect(h.sends.edges()).toEqual([
      { gone: null, to: "sum:mix" },
      { gone: expect.any(Promise), to: "sum:mix" },
    ]);
    await h.endFades();
    expect(h.sends.edges()).toEqual([{ gone: null, to: "sum:mix" }]);
    expect(h.from.connections.has(before)).toBe(false);
    expect(h.into.get("sum:mix")?.size).toBe(1);
  });

  test("drop lets go of every cable once, a fading one included", async () => {
    const h = createHarness();
    h.settle({
      a: { delay: 0, level: 1, reenters: false, to: "sink:out" },
      b: { delay: 0, level: 1, reenters: false, to: "sum:mix" },
    });
    h.settle({ a: { delay: 0, level: 1, reenters: false, to: "sink:out" } });

    h.sends.drop();
    await h.endFades();

    expect(h.released.mock.calls.map(([to]) => to).sort()).toEqual([
      "sink:out",
      "sum:mix",
    ]);
    expect(h.from.connections.size).toBe(0);
  });
});
