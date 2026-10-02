/**
 * Effect Config Schema
 *
 * Zod schema for a stored EffectConfig tree. It upgrades legacy param keys,
 * checks container shapes and nesting depth, and fills missing params from
 * the effect defaults. Shared by playback sessions and the node graph, which
 * read it at different strictness (`Strictness`).
 */

import { z } from "zod";
import {
  DEFAULT_EFFECT_TEMPO,
  isEffectContainer,
  isValidFrequencySplitShape,
  MAX_EFFECT_TREE_DEPTH,
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

/** Whether a select holds one of its declared options. */
function isSelectOption(
  param: Extract<EffectParamDef, { type: "select" }>,
  value: unknown
): boolean {
  return param.options.some((option) =>
    param.valueType === "number"
      ? Number(option.value) === value
      : option.value === value
  );
}

/** Whether a well-typed value lies outside what its control can set. */
function isOutOfRange(param: EffectParamDef, value: unknown): boolean {
  if (param.type === "slider") {
    return (value as number) < param.min || (value as number) > param.max;
  }
  return param.type === "select" && !isSelectOption(param, value);
}

/**
 * The loudest a container branch may be: the Branch gain slider's top,
 * which a node cable's gain matches.
 */
export const MAX_CHAIN_GAIN = 4;

/**
 * How strictly a config is read.
 *
 * - `stored`: a playback channel, as Single, DJ and the node compiler write
 *   it. A param outside its control's range is clamped (a slider) or reset
 *   to its default (a select), so an old session keeps loading, and Post-FX
 *   Trim has no ceiling, since a node lane folds its cable trims into it.
 * - `node`: an FX node's own config, which only its controls write, so
 *   anything they can't set is refused: a value outside its range, a
 *   checkbox that isn't true or false, a branch gain past the slider, or an
 *   effect or chain id used twice in the tree.
 */
type Strictness = "stored" | "node";

/** Flags universal params outside their range and mistyped effect params. */
function checkEffectParams(
  value: Record<string, unknown> & { type: EffectType },
  context: z.RefinementCtx,
  strictness: Strictness
): void {
  for (const { key, label, max, min } of UNIVERSAL_EFFECT_PARAM_DEFS) {
    const current = value[key];
    const ceiling =
      strictness === "stored" && key === "outputGain"
        ? Number.POSITIVE_INFINITY
        : max;
    if (typeof current === "number" && (current < min || current > ceiling)) {
      context.addIssue({
        code: "custom",
        message:
          ceiling === max
            ? `${label} must be between ${min} and ${max}`
            : `${label} must be at least ${min}`,
        path: [key],
      });
    }
  }
  for (const param of getEffectParamDefs(value.type)) {
    const paramValue = value[param.key];
    if (paramValue === undefined) {
      continue;
    }
    if (
      !isParamValue(param, paramValue) ||
      // A stored checkbox may hold a number the engine reads as on or off;
      // an FX node's switch only ever writes true or false.
      (strictness === "node" &&
        param.type === "checkbox" &&
        typeof paramValue !== "boolean")
    ) {
      context.addIssue({
        code: "custom",
        message: `${param.label} has the wrong type`,
        path: [param.key],
      });
    } else if (strictness === "node" && isOutOfRange(param, paramValue)) {
      context.addIssue({
        code: "custom",
        message:
          param.type === "slider"
            ? `${param.label} must be between ${param.min} and ${param.max}`
            : `${param.label} must be one of its options`,
        path: [param.key],
      });
    }
  }
}

/** Brings a stored param back inside what its control can set. */
function clampEffectParams(
  config: Record<string, unknown> & { type: EffectType },
  defaults: Record<string, unknown>
): void {
  for (const param of getEffectParamDefs(config.type)) {
    const current = config[param.key];
    if (current === undefined || !isOutOfRange(param, current)) {
      continue;
    }
    config[param.key] =
      param.type === "slider"
        ? Math.min(param.max, Math.max(param.min, current as number))
        : defaults[param.key];
  }
}

function checkContainerShape(
  value: {
    chains?: readonly EffectChainConfig[];
    crossoverFrequencies?: readonly number[];
    type: EffectType;
  },
  context: z.RefinementCtx
): void {
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
      message: "Frequency Split requires 2–4 bands with ascending crossovers",
      path: ["chains"],
    });
  }
}

/**
 * How deep containers nest in a raw config, read without recursion, so a
 * hostile document can't overflow the stack before the limit is checked.
 * A top-level effect sits at depth 0, the effects in its chains at 1.
 */
function rawEffectTreeDepth(value: unknown): number {
  let deepest = 0;
  const pending: [unknown, number][] = [[value, 0]];
  for (let entry = pending.pop(); entry; entry = pending.pop()) {
    const [effect, depth] = entry;
    const chains = (effect as { chains?: unknown } | null)?.chains;
    if (!Array.isArray(chains)) {
      continue;
    }
    for (const chain of chains) {
      const effects = (chain as { effects?: unknown } | null)?.effects;
      if (Array.isArray(effects)) {
        deepest = Math.max(deepest, depth + 1);
        if (deepest > MAX_EFFECT_TREE_DEPTH) {
          return deepest;
        }
        for (const child of effects) {
          pending.push([child, depth + 1]);
        }
      }
    }
  }
  return deepest;
}

/** Ids `validateEffectTree` refuses: an effect or chain id used twice. */
function checkUniqueIds(effect: EffectConfig, context: z.RefinementCtx): void {
  const effectIds = new Set<string>();
  const chainIds = new Set<string>();
  const visit = (current: EffectConfig) => {
    if (effectIds.has(current.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate effect id "${current.id}"`,
      });
    }
    effectIds.add(current.id);
    for (const chain of isEffectContainer(current) ? current.chains : []) {
      if (chainIds.has(chain.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate effect chain id "${chain.id}"`,
        });
      }
      chainIds.add(chain.id);
      for (const child of chain.effects) {
        visit(child);
      }
    }
  };
  visit(effect);
}

function createEffectConfigSchema(
  strictness: Strictness
): z.ZodType<EffectConfig> {
  const chainLimits =
    strictness === "node"
      ? {
          gain: z.number().min(0).max(MAX_CHAIN_GAIN),
          pan: z.number().min(-1).max(1),
        }
      : { gain: z.number(), pan: z.number() };
  const chainSchema: z.ZodType<EffectChainConfig> = z.lazy(() =>
    z.object({
      ...chainLimits,
      effects: z.array(treeSchema),
      id: z.string(),
      muted: z.boolean(),
      name: z.string(),
      order: z.number(),
      solo: z.boolean(),
    })
  );
  const treeSchema: z.ZodType<EffectConfig> = z.lazy(() =>
    z.preprocess(
      migrateLegacyEffectConfig,
      z
        .object({
          chains: z.array(chainSchema).optional(),
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
          checkEffectParams(value, context, strictness);
          checkContainerShape(value, context);
        })
        .transform((value) => {
          const defaults = createDefaultEffectConfig(
            value.type,
            value.id,
            value.order
          );
          const config = { ...defaults, ...value };
          clampEffectParams(config, defaults);
          return config as EffectConfig;
        })
    )
  );
  const root = z
    .unknown()
    .superRefine((value, context) => {
      if (rawEffectTreeDepth(value) > MAX_EFFECT_TREE_DEPTH) {
        context.addIssue({
          code: "custom",
          message: `Effects nest at most ${MAX_EFFECT_TREE_DEPTH} deep`,
          path: ["chains"],
        });
      }
    })
    .pipe(treeSchema);
  return strictness === "node"
    ? root.superRefine(checkUniqueIds)
    : (root as z.ZodType<EffectConfig>);
}

/**
 * A stored effect, as a playback channel holds it (Single, DJ and the
 * compiled lanes of Node): see `Strictness`.
 */
export const effectConfigSchema = createEffectConfigSchema("stored");

/** An FX node's config in a patch: see `Strictness`. */
export const nodeEffectConfigSchema = createEffectConfigSchema("node");
