import { Adsr, RMS, Smooth, TidalComputer } from "@opendaw/lib-dsp";
import { curveAt } from "./modulation-curve";
import type { ModulationData, ModulationSpec } from "./modulation-schema";

export type ControlLink = { source: string; target: string; depth: number };
export type ModulationProgram = {
  nodes: ModulationSpec[];
  links: ControlLink[];
  followers: string[];
  audioSources?: Record<string, string>;
  nativeIds?: string[];
};
export type ModulationMessage =
  | { type: "configure"; program: ModulationProgram }
  | { type: "gate"; id: string; on: boolean }
  | { type: "midi"; bytes: number[] }
  | { type: "native-values"; values: Record<string, number> }
  | { type: "stop" };

type Voice = {
  spec: ModulationSpec;
  age: number;
  phase: number;
  gate: boolean;
  manualGate: boolean;
  active: boolean;
  position: number;
  value: number;
  midiValue: number;
  notes: Map<number, number>;
  adsr: Adsr;
  envelopeBuffer: Float32Array;
  rms: RMS;
  smooth: Smooth;
  tidal: TidalComputer;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
function fraction(value: number): number {
  return value - Math.floor(value);
}

/** A repeatable sequence, indexed by step so seeks and loops stay deterministic. */
function randomAt(index: number, seed: number): number {
  return fraction(
    Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43_758.5453
  );
}

export function modulationFrequency(data: {
  rate: number;
  sync: string;
  tempo: number;
}): number {
  if (data.sync === "Off") {
    return data.rate;
  }
  const [numerator = 1, denominator = 1] = data.sync.split("/").map(Number);
  return data.rate + ((data.tempo / 60) * denominator) / (4 * numerator);
}

function stepIndex(
  index: number,
  count: number,
  direction: string,
  seed: number
): number {
  switch (direction) {
    case "backward":
      return count - 1 - (index % count);
    case "pingPong": {
      const cycle = Math.max(1, count * 2 - 2);
      const position = index % cycle;
      return position < count ? position : cycle - position;
    }
    case "alternate":
      return Math.floor(index / count) % 2 === 0
        ? index % count
        : count - 1 - (index % count);
    case "random":
      return Math.floor(randomAt(index, seed) * count);
    default:
      return index % count;
  }
}

function waveform(shape: string, phase: number): number {
  const position = fraction(phase);
  switch (shape) {
    case "sine":
      return 0.5 - Math.cos(position * Math.PI * 2) * 0.5;
    case "triangle":
      return 1 - Math.abs(position * 2 - 1);
    case "sawUp":
      return position;
    case "sawDown":
      return 1 - position;
    default:
      return position < 0.5 ? 1 : 0;
  }
}

/** Sample-clocked sources using openDAW's exported envelope, RMS, slew and Tidal DSP. */
export class ModulationDsp {
  private voices = new Map<string, Voice>();
  private ordered: Voice[] = [];
  private readonly inputs = new Map<string, ControlLink[]>();
  private followers: string[] = [];
  private nativeIds = new Set<string>();
  private nativeValues: Record<string, number> = {};
  readonly values: Record<string, number> = {};

  private readonly sampleRate: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  configure(program: ModulationProgram): void {
    this.nativeIds = new Set(program.nativeIds);
    this.nativeValues = Object.fromEntries(
      Object.entries(this.nativeValues).filter(([id]) => this.nativeIds.has(id))
    );
    const next = new Map(
      program.nodes.map((spec) => [spec.id, this.configureVoice(spec)])
    );
    this.voices = next;
    this.inputs.clear();
    for (const link of program.links) {
      if (next.has(link.source) && next.has(link.target)) {
        this.inputs.set(link.target, [
          ...(this.inputs.get(link.target) ?? []),
          link,
        ]);
      }
    }
    this.followers = program.followers;
    // DFS makes a Slew or gated source observe its upstream value in the same sample.
    this.ordered = [];
    const seen = new Set<string>();
    const visit = (id: string) => {
      if (seen.has(id)) {
        return;
      }
      seen.add(id);
      for (const link of this.inputs.get(id) ?? []) {
        visit(link.source);
      }
      const voice = next.get(id);
      if (voice) {
        this.ordered.push(voice);
      }
    };
    for (const id of next.keys()) {
      visit(id);
    }
    for (const id of Object.keys(this.values)) {
      if (!next.has(id)) {
        delete this.values[id];
      }
    }
  }

  private configureVoice(spec: ModulationSpec): Voice {
    const previous = this.voices.get(spec.id);
    const voice: Voice =
      previous?.spec.type === spec.type
        ? previous
        : {
            active: false,
            adsr: new Adsr(this.sampleRate),
            age: 0,
            envelopeBuffer: new Float32Array(1),
            gate: false,
            manualGate: false,
            midiValue: 0,
            notes: new Map(),
            phase: 0,
            position: 0,
            rms: new RMS(Math.max(1, Math.round(this.sampleRate * 0.03))),
            smooth: new Smooth(0.25, this.sampleRate),
            spec,
            tidal: new TidalComputer(),
            value: 0,
          };
    if (
      spec.type === "slew" &&
      (previous?.spec.type !== "slew" ||
        previous.spec.data.time !== spec.data.time)
    ) {
      voice.smooth = new Smooth(spec.data.time, this.sampleRate);
      voice.smooth.value = voice.value;
    }
    if (midiMappingChanged(previous?.spec, spec)) {
      voice.notes.clear();
      voice.midiValue = 0;
    }
    voice.spec = spec;
    if (spec.type === "envelope") {
      voice.adsr.set(
        spec.data.attack,
        spec.data.decay,
        spec.data.sustain,
        spec.data.release
      );
    }
    if (spec.type === "shapedLfo") {
      voice.tidal.set(1, spec.data.slope, spec.data.symmetry);
    }
    return voice;
  }

  gate(id: string, on: boolean): void {
    const voice = this.voices.get(id);
    if (voice) {
      voice.manualGate = on;
    }
  }

  setNativeValues(values: Record<string, number>): void {
    this.nativeValues = values;
  }

  midi(bytes: readonly number[]): void {
    const [status = 0, key = 0, velocity = 0] = bytes;
    for (const voice of this.voices.values()) {
      if (voice.spec.type !== "midiIn") {
        continue;
      }
      if (status === 255) {
        voice.notes.clear();
        voice.midiValue = 0;
        continue;
      }
      if (status % 16 === voice.spec.data.channel) {
        updateMidiVoice(
          voice,
          voice.spec.data,
          Math.floor(status / 16),
          key,
          velocity
        );
      }
    }
  }

  process(
    audio: readonly Float32Array[][],
    frames: number
  ): Readonly<Record<string, number>> {
    for (let frame = 0; frame < frames; frame += 1) {
      for (const voice of this.ordered) {
        this.processVoice(voice, audio, frame);
      }
    }
    return this.values;
  }

  private processVoice(
    voice: Voice,
    audio: readonly Float32Array[][],
    frame: number
  ): void {
    const { spec } = voice;
    if (this.nativeIds.has(spec.id)) {
      this.values[spec.id] = spec.data.enabled
        ? (this.nativeValues[spec.id] ?? 0)
        : 0;
      return;
    }
    const dt = 1 / this.sampleRate;
    const input = (this.inputs.get(spec.id) ?? []).reduce(
      (sum, link) => sum + (this.values[link.source] ?? 0) * link.depth,
      0
    );
    const gate = spec.data.enabled && (voice.manualGate || input > 0.5);
    if (gate && !voice.gate) {
      voice.age = 0;
      voice.phase = 0;
      voice.position = 0;
      voice.active = true;
      voice.adsr.gateOn();
    } else if (!gate && voice.gate) {
      voice.adsr.gateOff();
    }
    voice.gate = gate;
    const raw = this.sample(voice, input, audio, frame, dt);
    const value = spec.data.bipolar ? raw * 2 - 1 : raw;
    this.values[spec.id] = spec.data.enabled
      ? value * spec.data.amount * fadeValue(voice)
      : 0;
    voice.age += dt;
  }

  private sample(
    voice: Voice,
    input: number,
    audio: readonly Float32Array[][],
    frame: number,
    dt: number
  ): number {
    const { spec } = voice;
    if ("rate" in spec.data) {
      voice.phase += modulationFrequency(spec.data) * dt;
    }
    switch (spec.type) {
      case "macro":
        return spec.data.value;
      case "midiIn":
        return voice.midiValue;
      case "clock":
        return fraction(voice.phase + spec.data.phase) < 0.5 ? 1 : 0;
      case "lfo":
        return (
          waveform(spec.data.shape, voice.phase + spec.data.phase) **
          (2 ** (spec.data.bend * 4))
        );
      case "shapedLfo":
        return voice.tidal.compute(fraction(voice.phase + spec.data.phase));
      case "steps":
        return stepsValue(spec.data, voice.phase);
      case "randomiser":
        return randomValue(spec.data, voice.phase);
      case "envelope":
        voice.adsr.process(voice.envelopeBuffer, 0, 1);
        return voice.envelopeBuffer[0] ?? 0;
      case "follower":
        return followerValue(
          voice,
          spec.data,
          audio[this.followers.indexOf(spec.id)],
          frame,
          dt
        );
      case "slew":
        voice.value = voice.smooth.process(
          spec.data.bipolar ? (input + 1) / 2 : input
        );
        return clamp(voice.value);
      case "curve":
        return curveValue(voice, spec.data);
      case "multiEnvelope":
        return multiEnvelopeValue(voice, spec.data, dt);
      default:
        return 0;
    }
  }
}

function fadeValue(voice: Voice): number {
  if (voice.spec.type !== "lfo") {
    return 1;
  }
  const { delay, fade } = voice.spec.data;
  if (voice.age < delay) {
    return 0;
  }
  return fade === 0 ? 1 : clamp((voice.age - delay) / fade);
}

function updateMidiVoice(
  voice: Voice,
  data: ModulationData["midiIn"],
  kind: number,
  key: number,
  velocity: number
): void {
  if (kind === 11 && data.mode === "cc" && key === data.control) {
    voice.midiValue = velocity / 127;
  }
  if (kind === 8 || (kind === 9 && velocity === 0)) {
    voice.notes.delete(key);
  } else if (kind === 9) {
    voice.notes.delete(key);
    voice.notes.set(key, velocity);
  }
  if (kind === 11 && (key === 120 || key === 123)) {
    voice.notes.clear();
  }
  if (data.mode === "cc") {
    return;
  }
  const last = [...voice.notes.entries()].at(-1);
  voice.midiValue = 0;
  if (!last) {
    return;
  }
  if (data.mode === "gate") {
    voice.midiValue = 1;
  } else if (data.mode === "velocity") {
    voice.midiValue = last[1] / 127;
  } else {
    voice.midiValue = last[0] / 127;
  }
}

function stepsValue(data: ModulationData["steps"], phase: number): number {
  const { values, direction, seed, smooth } = data;
  const position = phase + data.phase;
  const index = Math.floor(position);
  const current = values[stepIndex(index, values.length, direction, seed)] ?? 0;
  const previous =
    values[stepIndex(Math.max(0, index - 1), values.length, direction, seed)] ??
    current;
  return (
    previous +
    (current - previous) *
      (smooth === 0 ? 1 : clamp(fraction(position) / smooth))
  );
}

function randomValue(
  data: ModulationData["randomiser"],
  phase: number
): number {
  const { loop, levels, seed, smooth } = data;
  const position = phase + data.phase;
  const index = Math.floor(position);
  const at = (step: number) => {
    const value = randomAt(
      loop > 0 ? (step + loop) % loop : Math.max(0, step),
      seed
    );
    if (levels === 1) {
      return 0;
    }
    return levels > 1 ? Math.round(value * (levels - 1)) / (levels - 1) : value;
  };
  const previous = at(index - 1);
  return (
    previous +
    (at(index) - previous) *
      (smooth === 0 ? 1 : clamp(fraction(position) / smooth))
  );
}

function followerValue(
  voice: Voice,
  data: ModulationData["follower"],
  channels: readonly Float32Array[] | undefined,
  frame: number,
  dt: number
): number {
  const left = channels?.[0]?.[frame] ?? 0;
  const right = channels?.[1]?.[frame] ?? left;
  // Stereo energy, without cancellation when the channels oppose each other.
  const level = clamp(
    voice.rms.pushPop(Math.hypot(left, right) / Math.SQRT2) * data.sensitivity
  );
  const time = level > voice.value ? data.attack : data.release;
  voice.value += (level - voice.value) * (1 - Math.exp(-dt / time));
  return voice.value;
}

function curveValue(voice: Voice, data: ModulationData["curve"]): number {
  if (!(data.loop || voice.active)) {
    return 0;
  }
  const position = voice.age / data.duration;
  return curveAt(data.points, data.loop ? fraction(position) : clamp(position));
}

function multiEnvelopeValue(
  voice: Voice,
  data: ModulationData["multiEnvelope"],
  dt: number
): number {
  if (!voice.active) {
    return data.points[0]?.value ?? 0;
  }
  const sustain = data.points[data.sustainPoint]?.time;
  const limit = voice.gate && sustain !== undefined ? sustain : 1;
  voice.position = Math.min(limit, voice.position + dt / data.duration);
  return curveAt(data.points, voice.position);
}

function midiMappingChanged(
  previous: ModulationSpec | undefined,
  next: ModulationSpec
): boolean {
  if (previous?.type !== "midiIn" || next.type !== "midiIn") {
    return false;
  }
  return (
    previous.data.mode !== next.data.mode ||
    previous.data.channel !== next.data.channel ||
    previous.data.control !== next.data.control
  );
}
