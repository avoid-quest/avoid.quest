import {
  MODULATION_SYNC,
  type ModulationNodeType,
} from "@/lib/node-graph/modulation-schema";

type Knob = {
  kind: "number";
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  scale?: "log";
};
type Choice = {
  kind: "select";
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
};
type Toggle = { kind: "toggle"; key: string; label: string };
export type ModulationField = Knob | Choice | Toggle;

const number = (
  key: string,
  label: string,
  min: number,
  max: number,
  step = 0.01,
  scale?: "log"
): Knob => ({ key, kind: "number", label, max, min, scale, step });
const choice = (
  key: string,
  label: string,
  values: readonly string[]
): Choice => ({
  key,
  kind: "select",
  label,
  options: values.map((value) => ({ label: value, value })),
});
const time = (key: string, label: string, max = 30) =>
  number(key, label, 0.001, max, 0.001, "log");
const timed: ModulationField[] = [
  number("rate", "Free Hz", 0, 10),
  choice("sync", "Sync", MODULATION_SYNC),
  number("tempo", "BPM", 30, 300, 1),
  number("phase", "Phase", 0, 1),
];

export const MODULATION_FIELDS: Record<ModulationNodeType, ModulationField[]> =
  {
    clock: timed,
    curve: [
      number("duration", "Duration s", 0.05, 120, 0.01, "log"),
      { key: "loop", kind: "toggle", label: "Loop" },
    ],
    envelope: [
      time("attack", "Attack s"),
      time("decay", "Decay s"),
      number("sustain", "Sustain", 0, 1),
      time("release", "Release s"),
    ],
    follower: [
      number("sensitivity", "Sensitivity", 0.1, 20, 0.01, "log"),
      time("attack", "Attack s", 5),
      time("release", "Release s", 5),
    ],
    lfo: [
      ...timed,
      choice("shape", "Shape", [
        "sine",
        "triangle",
        "sawUp",
        "sawDown",
        "square",
      ]),
      number("bend", "Bend", -1, 1),
      number("delay", "Delay s", 0, 30, 0.01),
      number("fade", "Fade s", 0, 30, 0.01),
    ],
    macro: [number("value", "Value", 0, 1)],
    midiIn: [
      choice("mode", "Mode", ["cc", "gate", "velocity", "key"]),
      number("channel", "Channel", 0, 15, 1),
      number("control", "CC", 0, 127, 1),
    ],
    multiEnvelope: [
      number("duration", "Duration s", 0.05, 120, 0.01, "log"),
      number("sustainPoint", "Hold point", -1, 6, 1),
    ],
    randomiser: [
      ...timed,
      number("smooth", "Smooth", 0, 1),
      number("seed", "Seed", 0, 999_999, 1),
      number("loop", "Loop steps", 0, 64, 1),
      number("levels", "Levels", 0, 32, 1),
    ],
    shapedLfo: [
      ...timed,
      number("slope", "Slope", -1, 1),
      number("symmetry", "Symmetry", 0, 1),
    ],
    slew: [time("time", "Glide s")],
    steps: [
      ...timed,
      choice("direction", "Direction", [
        "forward",
        "backward",
        "pingPong",
        "alternate",
        "random",
      ]),
      number("smooth", "Smooth", 0, 1),
    ],
  };

export const MODULATION_COMMON_FIELDS: ModulationField[] = [
  number("amount", "Amount", 0, 1),
  { key: "bipolar", kind: "toggle", label: "Bipolar" },
];
