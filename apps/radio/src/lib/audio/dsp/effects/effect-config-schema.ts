/**
 * Effect Config Schema
 *
 * Zod schema for a stored EffectConfig tree. It upgrades legacy param keys,
 * checks container shapes, and fills missing params from the effect defaults.
 * Shared by playback sessions and the node graph.
 */

import { z } from "zod";
import {
  DEFAULT_EFFECT_TEMPO,
  isValidFrequencySplitShape,
} from "../routing/effect-tree.js";
import { getEffectParamDefs } from "./param-traversal.js";
import type { EffectParamDef } from "./param-types.js";
import { createDefaultEffectConfig } from "./registry.js";
import {
  EFFECT_TYPES,
  type EffectChainConfig,
  type EffectConfig,
  type EffectType,
  OPENDAW_TIDAL_FRACTIONS,
} from "./types.js";
import { UNIVERSAL_EFFECT_PARAM_DEFS } from "./universal-params.js";

const effectSidechainSchema = z.object({
  channelId: z.string().min(1),
});

function closestTidalDivision(rate: number): string {
  const period = 1 / Math.max(0.001, rate);
  const secondsPerBeat = 60 / DEFAULT_EFFECT_TEMPO;
  return OPENDAW_TIDAL_FRACTIONS.reduce(
    (best, division) => {
      const [numerator = 1, denominator = 4] = division.split("/").map(Number);
      const [bestNumerator = 1, bestDenominator = 4] = best
        .split("/")
        .map(Number);
      const duration = secondsPerBeat * 4 * (numerator / denominator);
      const bestDuration =
        secondsPerBeat * 4 * (bestNumerator / bestDenominator);
      return Math.abs(duration - period) < Math.abs(bestDuration - period)
        ? division
        : best;
    },
    "1/4" as (typeof OPENDAW_TIDAL_FRACTIONS)[number]
  );
}

function migrateLegacyDelay(config: Record<string, unknown>): void {
  if (config.delayMusical === undefined) {
    config.delayMusical =
      config.tempoSync === true && typeof config.tempoDivision === "string"
        ? config.tempoDivision
        : "Off";
  }
  if (config.delayMillis === undefined) {
    config.delayMillis =
      config.tempoSync === true
        ? 0
        : Math.max(0, Number(config.delayTime ?? 0.3)) * 1000;
  }
  if (config.cross === undefined) {
    config.cross =
      typeof config.crossFeedback === "number" ? config.crossFeedback : 0;
  }
}

function migrateLegacyCompressor(config: Record<string, unknown>): void {
  for (const [native, legacy] of [
    ["automakeup", "autoMakeup"],
    ["autoattack", "autoAttack"],
    ["autorelease", "autoRelease"],
  ] as const) {
    if (config[native] === undefined && config[legacy] !== undefined) {
      config[native] = config[legacy];
    }
  }
}

function migrateLegacyPlateReverb(
  config: Record<string, unknown>
): Record<string, unknown> {
  const { preDelay, ...migrated } = config;
  if (migrated.preDelayMillis === undefined && typeof preDelay === "number") {
    migrated.preDelayMillis = preDelay / 48;
  }
  return migrated;
}

function migrateLegacyEffectConfig(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const migrated = { ...value } as Record<string, unknown>;
  if (migrated.type === "delay") {
    migrateLegacyDelay(migrated);
  } else if (migrated.type === "plateReverb") {
    return migrateLegacyPlateReverb(migrated);
  } else if (
    migrated.type === "tidal" &&
    migrated.rateDivision === undefined &&
    typeof migrated.rate === "number"
  ) {
    migrated.rateDivision = closestTidalDivision(migrated.rate);
  } else if (migrated.type === "compressor") {
    migrateLegacyCompressor(migrated);
  }
  return migrated;
}

/** Whether `value` has the type the engine reads for `param`. */
function isParamValue(param: EffectParamDef, value: unknown): boolean {
  switch (param.type) {
    case "checkbox":
      return typeof value === "boolean" || Number.isFinite(value);
    case "slider":
      return Number.isFinite(value);
    case "select":
      return param.valueType === "number"
        ? Number.isFinite(value)
        : typeof value === "string";
    case "text":
      return typeof value === "string";
    default:
      return false;
  }
}

/** Flags universal params outside their range and mistyped effect params. */
function checkEffectParams(
  value: Record<string, unknown> & { type: EffectType },
  context: z.RefinementCtx
): void {
  for (const { key, label, max, min } of UNIVERSAL_EFFECT_PARAM_DEFS) {
    const current = value[key];
    if (typeof current === "number" && (current < min || current > max)) {
      context.addIssue({
        code: "custom",
        message: `${label} must be between ${min} and ${max}`,
        path: [key],
      });
    }
  }
  for (const param of getEffectParamDefs(value.type)) {
    const paramValue = value[param.key];
    if (paramValue !== undefined && !isParamValue(param, paramValue)) {
      context.addIssue({
        code: "custom",
        message: `${param.label} has the wrong type`,
        path: [param.key],
      });
    }
  }
}

const effectChainConfigSchema: z.ZodType<EffectChainConfig> = z.lazy(() =>
  z.object({
    effects: z.array(effectConfigSchema),
    gain: z.number(),
    id: z.string(),
    muted: z.boolean(),
    name: z.string(),
    order: z.number(),
    pan: z.number(),
    solo: z.boolean(),
  })
);

export const effectConfigSchema: z.ZodType<EffectConfig> = z.lazy(() =>
  z.preprocess(
    migrateLegacyEffectConfig,
    z
      .object({
        chains: z.array(effectChainConfigSchema).optional(),
        crossoverFrequencies: z.array(z.number()).optional(),
        dryWet: z.number(),
        enabled: z.boolean(),
        id: z.string(),
        inputGain: z.number(),
        order: z.number(),
        outputGain: z.number(),
        sidechain: effectSidechainSchema.optional(),
        type: z.enum(EFFECT_TYPES),
      })
      .passthrough()
      .superRefine((value, context) => {
        checkEffectParams(value, context);
        if (
          (value.type === "fxComposite" ||
            value.type === "stereoSplit" ||
            value.type === "frequencySplit") &&
          !value.chains
        ) {
          context.addIssue({
            code: "custom",
            message: `${value.type} requires child chains`,
            path: ["chains"],
          });
        }
        if (value.type === "stereoSplit" && value.chains?.length !== 2) {
          context.addIssue({
            code: "custom",
            message: "Stereo Split requires left and right chains",
            path: ["chains"],
          });
        }
        if (
          value.type === "frequencySplit" &&
          !isValidFrequencySplitShape(
            value.chains ?? [],
            value.crossoverFrequencies ?? []
          )
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Frequency Split requires 2–4 bands with ascending crossovers",
            path: ["chains"],
          });
        }
      })
      .transform(
        (value) =>
          ({
            ...createDefaultEffectConfig(value.type, value.id, value.order),
            ...value,
          }) as EffectConfig
      )
  )
);
