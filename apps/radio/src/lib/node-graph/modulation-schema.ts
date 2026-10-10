import { z } from "zod";

export const MODULATION_NODE_TYPES = [
  "macro",
  "lfo",
  "steps",
  "randomiser",
  "follower",
  "envelope",
  "curve",
  "slew",
  "multiEnvelope",
  "shapedLfo",
  "clock",
  "midiIn",
] as const;
export type ModulationNodeType = (typeof MODULATION_NODE_TYPES)[number];

export const MODULATION_SYNC = [
  "Off",
  "8/1",
  "4/1",
  "2/1",
  "1/1",
  "1/2",
  "1/4",
  "1/6",
  "1/8",
  "1/12",
  "1/16",
  "1/24",
  "1/32",
] as const;
const unit = z.number().min(0).max(1);
const common = {
  amount: unit.default(1),
  bipolar: z.boolean().default(false),
  enabled: z.boolean().default(true),
};
const timed = {
  ...common,
  phase: unit.default(0),
  rate: z.number().min(0).max(10).default(1),
  sync: z.enum(MODULATION_SYNC).default("Off"),
  tempo: z.number().min(30).max(300).default(120),
};
const point = z.object({
  bend: z.number().min(-1).max(1).default(0),
  time: unit,
  value: unit,
});
export type ModulationPoint = z.infer<typeof point>;
const points = z
  .array(point)
  .min(2)
  .refine(
    (values) =>
      values[0]?.time === 0 &&
      values.at(-1)?.time === 1 &&
      values.every(
        (value, index) =>
          index === 0 || value.time > (values[index - 1]?.time ?? 0)
      ),
    "Points must start at 0, end at 1 and have increasing times"
  );
const lfo = z.object({
  ...timed,
  bend: z.number().min(-1).max(1).default(0),
  bipolar: z.boolean().default(true),
  delay: z.number().min(0).max(30).default(0),
  fade: z.number().min(0).max(30).default(0),
  shape: z
    .enum(["sine", "triangle", "sawUp", "sawDown", "square"])
    .default("sine"),
});
export const MODULATION_DATA_SCHEMAS = {
  clock: z.object({ ...timed, rate: z.number().min(0).max(10).default(2) }),
  curve: z.object({
    ...common,
    duration: z.number().min(0.05).max(120).default(4),
    loop: z.boolean().default(true),
    points: points.default([
      { bend: 0, time: 0, value: 0 },
      { bend: 0, time: 0.25, value: 1 },
      { bend: 0, time: 1, value: 0 },
    ]),
  }),
  envelope: z.object({
    ...common,
    attack: z.number().min(0.001).max(30).default(0.1),
    decay: z.number().min(0.001).max(30).default(0.3),
    release: z.number().min(0.001).max(30).default(0.5),
    sustain: unit.default(0.5),
  }),
  follower: z.object({
    ...common,
    attack: z.number().min(0.001).max(5).default(0.02),
    release: z.number().min(0.001).max(5).default(0.3),
    sensitivity: z.number().min(0.1).max(20).default(4),
  }),
  lfo,
  macro: z.object({ ...common, value: unit.default(0.5) }),
  midiIn: z.object({
    ...common,
    channel: z.number().int().min(0).max(15).default(0),
    control: z.number().int().min(0).max(127).default(1),
    mode: z.enum(["cc", "gate", "velocity", "key"]).default("cc"),
  }),
  multiEnvelope: z
    .object({
      ...common,
      duration: z.number().min(0.05).max(120).default(4),
      points: points.default(
        [0, 1, 0.3, 0.8, 0.2, 0.6, 0.4, 0].map((value, index) => ({
          bend: 0,
          time: index / 7,
          value,
        }))
      ),
      sustainPoint: z.number().int().min(-1).default(3),
    })
    .refine((data) => data.sustainPoint <= data.points.length - 2, {
      message: "Hold point must precede the final envelope point",
      path: ["sustainPoint"],
    }),
  randomiser: z.object({
    ...timed,
    levels: z.number().int().min(0).max(32).default(0),
    loop: z.number().int().min(0).max(64).default(0),
    seed: z.number().int().min(0).max(999_999).default(1),
    smooth: unit.default(0.5),
  }),
  shapedLfo: z.object({
    ...timed,
    slope: z.number().min(-1).max(1).default(-0.25),
    symmetry: unit.default(0.5),
  }),
  slew: z.object({
    ...common,
    time: z.number().min(0.001).max(30).default(0.25),
  }),
  steps: z.object({
    ...timed,
    direction: z
      .enum(["forward", "backward", "pingPong", "alternate", "random"])
      .default("forward"),
    smooth: unit.default(0),
    // openDAW StepsModulatorBox stores exactly 64 native step fields.
    values: z
      .array(unit)
      .min(1)
      .max(64)
      .default([0, 1, 0.25, 0.75, 0, 1, 0.25, 0.75]),
  }),
} as const;

export type ModulationData = {
  [T in ModulationNodeType]: z.infer<(typeof MODULATION_DATA_SCHEMAS)[T]>;
};

export function isModulationType(type: string): type is ModulationNodeType {
  return (MODULATION_NODE_TYPES as readonly string[]).includes(type);
}

export type ModulationSpec = {
  [T in ModulationNodeType]: { id: string; type: T; data: ModulationData[T] };
}[ModulationNodeType];

/** Old control nodes accepted arbitrary data; storage normalizes before strict edits. */
export function normalizeModulationData(
  type: ModulationNodeType,
  data: unknown
) {
  const stored = data && typeof data === "object" ? data : {};
  const normalized = Object.fromEntries(
    Object.entries(MODULATION_DATA_SCHEMAS[type].shape).map(([key, schema]) => {
      let value = Reflect.get(stored, key);
      const field = schema.unwrap();
      if (
        field instanceof z.ZodNumber &&
        typeof value === "number" &&
        Number.isFinite(value)
      ) {
        value = Math.max(
          field.minValue ?? Number.NEGATIVE_INFINITY,
          Math.min(
            field.maxValue ?? Number.POSITIVE_INFINITY,
            field.isInt ? Math.round(value) : value
          )
        );
      }
      const parsed = schema.safeParse(value);
      return [key, parsed.success ? parsed.data : schema.parse(undefined)];
    })
  );
  if (type === "multiEnvelope") {
    normalized.sustainPoint = Math.min(
      normalized.sustainPoint,
      normalized.points.length - 2
    );
  }
  return normalized;
}
