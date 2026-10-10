import { describe, expect, test } from "bun:test";
import { Adsr, Smooth } from "@opendaw/lib-dsp";
import { Curve } from "@opendaw/lib-std";
import { curveAt } from "./modulation-curve";
import { ModulationDsp } from "./modulation-dsp";
import {
  MODULATION_DATA_SCHEMAS,
  type ModulationNodeType,
  type ModulationSpec,
} from "./modulation-schema";

function source(
  type: ModulationNodeType,
  data: Record<string, unknown> = {},
  id = type
): ModulationSpec {
  return {
    data: MODULATION_DATA_SCHEMAS[type].parse(data),
    id,
    type,
  } as ModulationSpec;
}

function dsp(...nodes: ModulationSpec[]) {
  const engine = new ModulationDsp(1000);
  engine.configure({
    followers: nodes
      .filter((node) => node.type === "follower")
      .map((node) => node.id),
    links: [],
    nodes,
  });
  return engine;
}

describe("sample-clocked modulation sources", () => {
  test.each(["curve", "multiEnvelope"] as const)(
    "%s returns to idle after a nonzero one-shot endpoint",
    (type) => {
      const points = MODULATION_DATA_SCHEMAS[type]
        .parse({})
        .points.map((point, index, values) =>
          index === values.length - 1 ? { ...point, value: 0.8 } : point
        );
      const engine = dsp(
        source(type, { duration: 0.1, loop: false, points, sustainPoint: -1 })
      );
      expect(engine.process([], 1)[type]).toBe(0);
      engine.gate(type, true);
      expect(engine.process([], 50)[type]).toBeGreaterThan(0);
      engine.gate(type, false);
      expect(engine.process([], 200)[type]).toBe(0);
    }
  );
  test("native telemetry is already folded and feeds downstream control without a second range transform", () => {
    const engine = new ModulationDsp(1000);
    engine.configure({
      followers: [],
      links: [{ depth: 1, source: "macro", target: "slew" }],
      nodes: [
        source("macro", { amount: 0.2, bipolar: true, value: 0.8 }),
        source("slew", { time: 0.1 }),
      ],
    });
    engine.setNativeValues({ macro: 0.7 });
    expect(engine.process([], 100).macro).toBe(0.7);
    expect(engine.values.slew).toBeCloseTo(0.7 * (1 - Math.exp(-1)), 3);
    engine.configure({
      followers: [],
      links: [],
      nodes: [source("macro", { enabled: false })],
    });
    expect(engine.process([], 1).macro).toBe(0);
    engine.configure({
      followers: [],
      links: [],
      nodes: [source("macro", { value: 0.8 })],
    });
    expect(engine.process([], 1).macro).toBe(0.7);
    engine.setNativeValues({ macro: 0.8 });
    expect(engine.process([], 1).macro).toBe(0.8);
  });

  test("ADSR attacks, sustains and releases; multi-stage holds and completes", () => {
    const envelope = dsp(
      source("envelope", {
        attack: 0.05,
        decay: 0.05,
        release: 0.05,
        sustain: 0.4,
      })
    );
    expect(envelope.process([], 50).envelope).toBe(0);
    envelope.gate("envelope", true);
    expect(envelope.process([], 300).envelope).toBeCloseTo(0.4, 2);
    envelope.gate("envelope", false);
    expect(envelope.process([], 300).envelope).toBeCloseTo(0, 3);
    const multi = dsp(source("multiEnvelope", { duration: 1 }));
    multi.gate("multiEnvelope", true);
    expect(multi.process([], 700).multiEnvelope).toBeCloseTo(0.8, 3);
    multi.gate("multiEnvelope", false);
    expect(multi.process([], 700).multiEnvelope).toBe(0);
  });

  test("curves loop or trigger once, and bends alter interpolation", () => {
    const curve = source("curve", { duration: 1, loop: false });
    const engine = dsp(curve);
    expect(engine.process([], 500).curve).toBe(0);
    engine.gate("curve", true);
    expect(engine.process([], 250).curve).toBeGreaterThan(0.99);
    engine.gate("curve", false);
    expect(engine.process([], 1000).curve).toBe(0);
    expect(
      curveAt(
        [
          { bend: 0, time: 0, value: 0 },
          { bend: 0, time: 1, value: 1 },
        ],
        0.5
      )
    ).toBe(0.5);
    expect(
      curveAt(
        [
          { bend: 1, time: 0, value: 0 },
          { bend: 0, time: 1, value: 1 },
        ],
        0.5
      )
    ).toBeLessThan(0.01);
  });

  test("multi-stage envelopes hold at a stage beyond the original eight", () => {
    const points = Array.from({ length: 10 }, (_, index) => ({
      bend: 0,
      time: index / 9,
      value: index === 9 ? 0 : index / 9,
    }));
    const engine = dsp(
      source("multiEnvelope", { duration: 1, points, sustainPoint: 8 })
    );
    engine.gate("multiEnvelope", true);
    expect(engine.process([], 1500).multiEnvelope).toBeCloseTo(8 / 9, 3);
    engine.gate("multiEnvelope", false);
    expect(engine.process([], 200).multiEnvelope).toBe(0);
  });

  test.each([2, 8, 10, 33])(
    "a %i-point envelope only holds before its final point",
    (count) => {
      const points = Array.from({ length: count }, (_, index) => ({
        bend: 0,
        time: index / (count - 1),
        value: 0,
      }));
      const schema = MODULATION_DATA_SCHEMAS.multiEnvelope;
      expect(
        schema.safeParse({ points, sustainPoint: count - 2 }).success
      ).toBe(true);
      expect(
        schema.safeParse({ points, sustainPoint: count - 1 }).success
      ).toBe(false);
      expect(schema.safeParse({ points, sustainPoint: -1 }).success).toBe(true);
    }
  );

  test("slew follows upstream control smoothly in the same render block", () => {
    const engine = new ModulationDsp(1000);
    engine.configure({
      followers: [],
      links: [{ depth: 1, source: "macro", target: "slew" }],
      nodes: [source("slew", { time: 0.1 }), source("macro", { value: 1 })],
    });
    engine.setNativeValues({ macro: 1 });
    expect(engine.process([], 100).slew).toBeCloseTo(1 - Math.exp(-1), 3);
    expect(engine.process([], 500).slew).toBeGreaterThan(0.99);
  });

  test("follower detects stereo energy and releases when its input disappears", () => {
    const engine = dsp(
      source("follower", { attack: 0.01, release: 0.1, sensitivity: 2 })
    );
    const left = new Float32Array(1000).fill(0.25);
    const right = new Float32Array(1000).fill(-0.25);
    expect(engine.process([[left, right]], 1000).follower).toBeCloseTo(0.5, 2);
    expect(engine.process([], 1000).follower).toBeLessThan(0.001);
  });

  test("clock gates an envelope; MIDI respects channel and releases overlapping notes", () => {
    const engine = new ModulationDsp(1000);
    engine.configure({
      followers: [],
      links: [{ depth: 1, source: "clock", target: "envelope" }],
      nodes: [source("envelope"), source("clock", { rate: 2 })],
    });
    expect(engine.process([], 150).envelope).toBeGreaterThan(0);
    const midi = dsp(source("midiIn", { channel: 1, mode: "gate" }));
    midi.midi([0x90, 60, 100]);
    expect(midi.process([], 1).midiIn).toBe(0);
    midi.midi([0x91, 60, 100]);
    midi.midi([0x91, 64, 100]);
    expect(midi.process([], 1).midiIn).toBe(1);
    midi.midi([0x81, 64, 0]);
    expect(midi.process([], 1).midiIn).toBe(1);
    midi.midi([0x91, 60, 0]);
    expect(midi.process([], 1).midiIn).toBe(0);
    midi.midi([0x91, 60, 100]);
    midi.midi([255]);
    expect(midi.process([], 1).midiIn).toBe(0);
  });
});

test("ADSR and Slew output sequences use the installed library", () => {
  const engine = dsp(
    source("envelope", { attack: 0.1, decay: 0.2, release: 0.3, sustain: 0.4 })
  );
  const oracle = new Adsr(1000);
  oracle.set(0.1, 0.2, 0.4, 0.3);
  const buffer = new Float32Array(1);
  engine.gate("envelope", true);
  oracle.gateOn();
  for (let sample = 0; sample < 600; sample += 1) {
    oracle.process(buffer, 0, 1);
    expect(engine.process([], 1).envelope).toBe(buffer[0]);
  }
  engine.gate("envelope", false);
  oracle.gateOff();
  for (let sample = 0; sample < 400; sample += 1) {
    oracle.process(buffer, 0, 1);
    expect(engine.process([], 1).envelope).toBe(buffer[0]);
  }
  const glide = new ModulationDsp(1000);
  glide.configure({
    followers: [],
    links: [{ depth: 1, source: "macro", target: "slew" }],
    nodes: [source("macro"), source("slew", { time: 0.1 })],
  });
  glide.setNativeValues({ macro: 0.75 });
  const smoother = new Smooth(0.1, 1000);
  for (let sample = 0; sample < 100; sample += 1) {
    expect(glide.process([], 1).slew).toBe(smoother.process(0.75));
  }
});

test("Curve bending calls the same library calculation as playback", () => {
  for (const bend of [-1, 0, 1]) {
    for (const position of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(
        curveAt(
          [
            { bend, time: 0, value: 0.2 },
            { bend: 0, time: 1, value: 0.8 },
          ],
          position
        )
      ).toBe(
        Curve.valueAt(
          { slope: (1 - bend) / 2, steps: 1, y0: 0.2, y1: 0.8 },
          position
        )
      );
    }
  }
});

test("native resets and delayed amount are latched without synthesizing native waves", () => {
  const engine = dsp(source("lfo", { amount: 0.5, delay: 0.1, fade: 0.2 }));
  engine.setNativeValues({ lfo: -0.25 });
  expect(engine.process([], 101).lfo).toBe(-0.25);
  expect(engine.amounts.lfo).toBeCloseTo(0);
  engine.process([], 100);
  expect(engine.amounts.lfo).toBeCloseTo(0.25, 2);
  engine.gate("lfo", true);
  engine.gate("lfo", false);
  engine.process([], 128);
  expect([...engine.resets]).toEqual(["lfo"]);
  engine.process([], 128);
  expect([...engine.resets]).toEqual(["lfo"]);
});

test("only delay/fade LFOs publish amount overrides and ordinary rate edits take effect", () => {
  const engine = dsp(source("lfo"));
  engine.process([], 100);
  expect(engine.amounts).toEqual({});
  engine.configure({
    followers: [],
    links: [],
    nodes: [source("lfo", { delay: 0.1, fade: 0.2 })],
  });
  engine.process([], 100);
  expect(engine.amounts.lfo).toBeCloseTo(0.495);
  engine.configure({ followers: [], links: [], nodes: [source("lfo")] });
  engine.process([], 1);
  expect(engine.amounts).toEqual({});
  const clock = dsp(source("clock", { rate: 1 }));
  clock.process([], 200);
  clock.configure({
    followers: [],
    links: [],
    nodes: [source("clock", { rate: 4 })],
  });
  const values = Array.from({ length: 250 }, () => clock.process([], 1).clock);
  expect(values).toContain(0);
  expect(values).toContain(1);
});

test.each(["curve", "multiEnvelope"] as const)(
  "%s keeps more than sixteen points",
  (type) => {
    const points = Array.from({ length: 33 }, (_, index) => ({
      bend: 0,
      time: index / 32,
      value: index / 32,
    }));
    const spec = source(type, {
      duration: 1,
      loop: false,
      points,
      sustainPoint: -1,
    });
    const engine = dsp(spec);
    engine.gate(type, true);
    expect(engine.process([], 500)[type]).toBeCloseTo(0.5, 2);
  }
);
