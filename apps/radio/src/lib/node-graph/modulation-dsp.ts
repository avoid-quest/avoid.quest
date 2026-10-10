import {
  Adsr,
  ClassicWaveform,
  LFO,
  RMS,
  Smooth,
  TidalComputer,
} from "@opendaw/lib-dsp";
import { Curve, clampUnit, mod, ValueMapping } from "@opendaw/lib-std";
import { createCurve } from "./modulation-curve";
import { modulationFrequency, NATIVE_TYPES } from "./modulation-frequency";
import type { ModulationData, ModulationSpec } from "./modulation-schema";

export type ControlLink = { source: string; target: string; depth: number };
export type ModulationProgram = {
  nodes: ModulationSpec[];
  links: ControlLink[];
  followers: string[];
};
export type ModulationMessage =
  | { type: "configure"; program: ModulationProgram }
  | { type: "gate"; id: string; on: boolean }
  | { type: "midi"; bytes: number[] }
  | { type: "native-values"; values: Record<string, number> }
  | { type: "ack" }
  | { type: "run" }
  | { type: "stop" };

type Voice = {
  spec: ModulationSpec;
  hz: number;
  native: boolean;
  inputs: ControlLink[];
  curve: ReturnType<typeof createCurve>;
  fade: Parameters<typeof Curve.valueAt>[0];
  age: number;
  phase: number;
  gate: boolean;
  manualGate: boolean;
  triggered: boolean;
  active: boolean;
  position: number;
  value: number;
  midiValue: number;
  midiGateTriggered: boolean;
  notes: Map<number, number>;
  adsr: Adsr;
  envelopeBuffer: Float32Array;
  rms: RMS;
  smooth: Smooth;
  tidal: TidalComputer;
  attack: Smooth;
  release: Smooth;
  clock: LFO;
  followerInput: number;
};

/** Sample-clocked sources using openDAW's exported envelope, RMS, slew and Tidal DSP. */
export class ModulationDsp {
  private voices = new Map<string, Voice>();
  private ordered: Voice[] = [];
  private readonly inputs = new Map<string, ControlLink[]>();
  private followers: string[] = [];
  private nativeValues: Record<string, number> = {};
  readonly resets = new Set<string>();
  readonly amounts: Record<string, number> = {};
  readonly values: Record<string, number> = {};

  private readonly sampleRate: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  configure(program: ModulationProgram): void {
    const nativeIds = new Set(
      program.nodes
        .filter((spec) => NATIVE_TYPES.has(spec.type))
        .map((spec) => spec.id)
    );
    this.nativeValues = Object.fromEntries(
      Object.entries(this.nativeValues).filter(([id]) => nativeIds.has(id))
    );
    const ids = new Set(program.nodes.map((spec) => spec.id));
    this.followers = program.followers;
    this.inputs.clear();
    for (const link of program.links) {
      if (ids.has(link.source) && ids.has(link.target)) {
        this.inputs.set(link.target, [
          ...(this.inputs.get(link.target) ?? []),
          link,
        ]);
      }
    }
    const next = new Map(
      program.nodes.map((spec) => [spec.id, this.configureVoice(spec)])
    );
    for (const [id, voice] of this.voices) {
      if (!next.has(id)) {
        voice.adsr.forceStop();
        delete this.amounts[id];
        this.resets.delete(id);
      }
    }
    this.voices = next;
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
            attack: new Smooth(0.02, this.sampleRate),
            clock: new LFO(this.sampleRate),
            curve: createCurve([]),
            envelopeBuffer: new Float32Array(1),
            fade: { slope: 0.5, steps: 0, y0: 0, y1: 1 },
            followerInput: -1,
            gate: false,
            hz: 0,
            inputs: [],
            manualGate: false,
            midiGateTriggered: false,
            midiValue: 0,
            native: false,
            notes: new Map(),
            phase: 0,
            position: 0,
            release: new Smooth(0.3, this.sampleRate),
            rms: new RMS(Math.max(2, Math.round(this.sampleRate * 0.03) * 2)),
            smooth: new Smooth(0.25, this.sampleRate),
            spec,
            tidal: new TidalComputer(),
            triggered: false,
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
    if (spec.type === "follower") {
      if (
        previous?.spec.type !== "follower" ||
        previous.spec.data.attack !== spec.data.attack
      ) {
        voice.attack = new Smooth(spec.data.attack, this.sampleRate);
      }
      if (
        previous?.spec.type !== "follower" ||
        previous.spec.data.release !== spec.data.release
      ) {
        voice.release = new Smooth(spec.data.release, this.sampleRate);
      }
    }
    if (
      spec.type === "clock" &&
      (previous?.spec.type !== "clock" ||
        previous.spec.data.phase !== spec.data.phase)
    ) {
      voice.clock.reset();
      voice.clock.fill(
        voice.envelopeBuffer,
        ClassicWaveform.square,
        this.sampleRate * mod(voice.phase + spec.data.phase, 1),
        0,
        1
      );
    }
    if (midiMappingChanged(voice.spec, spec)) {
      voice.notes.clear();
      voice.midiValue = 0;
      voice.midiGateTriggered = false;
    }
    this.configureControls(voice, spec);
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

  private configureControls(voice: Voice, spec: ModulationSpec): void {
    voice.spec = spec;
    voice.inputs = this.inputs.get(spec.id) ?? [];
    voice.followerInput = this.followers.indexOf(spec.id);
    this.values[spec.id] ??= 0;
    voice.hz = "rate" in spec.data ? modulationFrequency(spec.data) : 0;
    voice.native = NATIVE_TYPES.has(spec.type);
    if ("points" in spec.data) {
      voice.curve = createCurve(spec.data.points);
    }
    if (spec.type === "lfo") {
      voice.fade.steps = spec.data.fade;
    }
    if (spec.type === "lfo" && (spec.data.delay > 0 || spec.data.fade > 0)) {
      this.amounts[spec.id] = spec.data.amount * fadeValue(voice);
    } else {
      delete this.amounts[spec.id];
    }
  }

  gate(id: string, on: boolean): void {
    const voice = this.voices.get(id);
    if (voice) {
      voice.triggered ||= on && !voice.manualGate;
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
        voice.midiGateTriggered = false;
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
    for (const voice of this.ordered) {
      if (voice.native) {
        this.processNative(voice);
      }
    }
    for (let frame = 0; frame < frames; frame += 1) {
      // biome-ignore lint/style/useForOf: avoid iterator allocation in the audio sample loop.
      for (let index = 0; index < this.ordered.length; index += 1) {
        this.processVoice(this.ordered[index] as Voice, audio, frame);
      }
    }
    for (const voice of this.ordered) {
      if (
        voice.spec.type === "lfo" &&
        (voice.spec.data.delay > 0 || voice.spec.data.fade > 0)
      ) {
        this.amounts[voice.spec.id] =
          voice.spec.data.amount *
          fadeValue(voice, voice.age - 1 / this.sampleRate);
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
    const dt = 1 / this.sampleRate;
    let input = 0;
    // biome-ignore lint/style/useForOf: avoid iterator allocation in the audio sample loop.
    for (let index = 0; index < voice.inputs.length; index += 1) {
      const link = voice.inputs[index] as ControlLink;
      input += (this.values[link.source] ?? 0) * link.depth;
    }
    const { triggered } = voice;
    voice.triggered = false;
    const gate =
      spec.data.enabled && (triggered || voice.manualGate || input > 0.5);
    if (gate && (triggered || !voice.gate)) {
      voice.age = 0;
      voice.phase = 0;
      voice.position = 0;
      voice.active = true;
      if (voice.native && spec.type !== "macro") {
        this.resets.add(spec.id);
      }
      if (spec.type === "clock") {
        voice.clock.reset();
        voice.clock.fill(
          voice.envelopeBuffer,
          ClassicWaveform.square,
          this.sampleRate * spec.data.phase,
          0,
          1
        );
      }
      voice.adsr.gateOn();
    } else if (!gate && voice.gate) {
      voice.adsr.gateOff();
    }
    voice.gate = gate;
    if (voice.native) {
      voice.age += dt;
      return;
    }
    const raw = this.sample(voice, input, audio, frame, dt);
    const value = spec.data.bipolar ? ValueMapping.bipolar().y(raw) : raw;
    this.values[spec.id] = spec.data.enabled ? value * spec.data.amount : 0;
    voice.age += dt;
  }

  private processNative(voice: Voice): void {
    const { spec } = voice;
    this.values[spec.id] = spec.data.enabled
      ? (this.nativeValues[spec.id] ?? 0)
      : 0;
  }

  private sample(
    voice: Voice,
    input: number,
    audio: readonly Float32Array[][],
    frame: number,
    dt: number
  ): number {
    const { spec } = voice;
    voice.phase += voice.hz * dt;
    switch (spec.type) {
      case "midiIn": {
        const { midiGateTriggered } = voice;
        voice.midiGateTriggered = false;
        return midiGateTriggered ? 1 : voice.midiValue;
      }
      case "clock":
        voice.clock.fill(
          voice.envelopeBuffer,
          ClassicWaveform.square,
          voice.hz,
          0,
          1
        );
        return ValueMapping.bipolar().x(voice.envelopeBuffer[0] ?? 0);
      case "shapedLfo":
        return voice.tidal.compute(mod(voice.phase + spec.data.phase, 1));
      case "envelope":
        voice.adsr.process(voice.envelopeBuffer, 0, 1);
        return voice.envelopeBuffer[0] ?? 0;
      case "follower":
        return followerValue(
          voice,
          spec.data,
          audio[voice.followerInput],
          frame
        );
      case "slew":
        voice.value = voice.smooth.process(
          spec.data.bipolar ? ValueMapping.bipolar().x(input) : input
        );
        return clampUnit(voice.value);
      case "curve":
        return curveValue(voice, spec.data);
      case "multiEnvelope":
        return multiEnvelopeValue(voice, spec.data, dt);
      default:
        return 0;
    }
  }
}

function fadeValue(voice: Voice, age = voice.age): number {
  if (voice.spec.type !== "lfo") {
    return 1;
  }
  const { delay, fade } = voice.spec.data;
  if (age < delay) {
    return 0;
  }
  return fade === 0
    ? 1
    : Curve.valueAt(voice.fade, Math.min(fade, age - delay));
}

function updateMidiVoice(
  voice: Voice,
  data: ModulationData["midiIn"],
  kind: number,
  key: number,
  velocity: number
): void {
  if (kind === 11 && data.mode === "cc" && key === data.control) {
    voice.midiValue = ValueMapping.linear(0, 127).x(velocity);
  }
  if (kind === 8 || (kind === 9 && velocity === 0)) {
    voice.notes.delete(key);
  } else if (kind === 9) {
    voice.notes.delete(key);
    voice.notes.set(key, velocity);
    voice.midiGateTriggered ||= data.mode === "gate";
  }
  if (kind === 11 && (key === 120 || key === 123)) {
    voice.notes.clear();
    voice.midiGateTriggered = false;
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
    voice.midiValue = ValueMapping.linear(0, 127).x(last[1]);
  } else {
    voice.midiValue = ValueMapping.linear(0, 127).x(last[0]);
  }
}

function followerValue(
  voice: Voice,
  data: ModulationData["follower"],
  channels: readonly Float32Array[] | undefined,
  frame: number
): number {
  const left = channels?.[0]?.[frame] ?? 0;
  const right = channels?.[1]?.[frame] ?? left;
  // Stereo energy, without cancellation when the channels oppose each other.
  voice.rms.pushPop(left);
  const level = clampUnit(voice.rms.pushPop(right) * data.sensitivity);
  const smoother = level > voice.value ? voice.attack : voice.release;
  smoother.value = voice.value;
  voice.value = smoother.process(level);
  return voice.value;
}

function curveValue(voice: Voice, data: ModulationData["curve"]): number {
  const position = voice.age / data.duration;
  if (data.loop) {
    return voice.curve(mod(position, 1));
  }
  if (position >= 1) {
    voice.active = false;
  }
  return voice.active ? voice.curve(clampUnit(position)) : 0;
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
  if (voice.position >= 1) {
    voice.active = false;
    return data.points[0]?.value ?? 0;
  }
  return voice.curve(voice.position);
}

function midiMappingChanged(
  previous: ModulationSpec,
  next: ModulationSpec
): boolean {
  if (previous.type !== "midiIn" || next.type !== "midiIn") {
    return false;
  }
  return (
    previous.data.mode !== next.data.mode ||
    previous.data.channel !== next.data.channel ||
    previous.data.control !== next.data.control
  );
}
