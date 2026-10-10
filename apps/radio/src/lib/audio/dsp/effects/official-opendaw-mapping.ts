import { getEffectDefinition } from "./param-traversal.js";
import type { EffectConfig, EffectType, OpenDawEffectType } from "./types.js";

// Mirrors the private constant in @opendaw/studio-core/dist/MonitoringRouter.js; the package exports do not expose it.
export const MAX_MONITORING_CHANNELS = 8;

export const OPENDAW_FACTORY_KEYS = {
  autotune: "Autotune",
  cheapReverb: "Reverb",
  compressor: "Compressor",
  crusher: "Crusher",
  delay: "Delay",
  fold: "Fold",
  frequencySplit: "FrequencySplit",
  fxComposite: "AudioEffectComposite",
  gate: "Gate",
  maximizer: "Maximizer",
  neuralAmp: "NeuralAmp",
  plateReverb: "DattorroReverb",
  revamp: "Revamp",
  stereoSplit: "StereoComposite",
  stereoTool: "StereoTool",
  tidal: "Tidal",
  vocoder: "Vocoder",
  waveshaper: "Waveshaper",
  werkstatt: "Werkstatt",
} as const satisfies Record<
  OpenDawEffectType,
  keyof typeof import("@opendaw/studio-core").EffectFactories.AudioNamed
>;

export type OfficialOpenDawEffectType = keyof typeof OPENDAW_FACTORY_KEYS;

export function isOfficialOpenDawEffectType(
  type: string
): type is OfficialOpenDawEffectType {
  return Object.hasOwn(OPENDAW_FACTORY_KEYS, type);
}

export function isOfficialOpenDawEffect(
  effect: EffectConfig
): effect is Extract<EffectConfig, { type: OfficialOpenDawEffectType }> {
  return isOfficialOpenDawEffectType(effect.type);
}

/**
 * Why effects run on the compatibility engine, not openDAW: its input
 * channels are taken, it couldn't start, the page isn't cross-origin
 * isolated, an effect only the compatibility engine runs, or an effect set
 * up in a way only it runs, by type.
 */
export type EffectsFallbackCause =
  | "capacity"
  | "not-isolated"
  | "startup-failed"
  | `radio-only:${EffectType}`
  | `unsupported-config:${EffectType}`;

/**
 * Why openDAW can't run these effects, from the first enabled one it can't,
 * containers' chains included; null if it runs them all. Radio-only effects
 * cannot be silently discarded during an official-engine migration, so one
 * keeps the whole sound on the compatibility path until a hybrid graph is
 * explicitly added.
 */
export function radioOnlyFallback(
  effects: readonly EffectConfig[]
): EffectsFallbackCause | null {
  for (const effect of effects) {
    if (!effect.enabled) {
      continue;
    }
    if (!isOfficialOpenDawEffect(effect)) {
      return `radio-only:${effect.type}`;
    }
    if (
      effect.sidechain &&
      effect.type !== "compressor" &&
      effect.type !== "gate" &&
      effect.type !== "vocoder"
    ) {
      return `unsupported-config:${effect.type}`;
    }
    const nested =
      "chains" in effect
        ? effect.chains
            .map((chain) => radioOnlyFallback(chain.effects))
            .find(Boolean)
        : null;
    if (nested) {
      return nested;
    }
  }
  return null;
}

/** `cause` in plain words, as a clause after "because". */
export function describeFallback(cause: EffectsFallbackCause): string {
  if (cause === "capacity") {
    return `openDAW's ${MAX_MONITORING_CHANNELS} monitoring input channels are in use: each stereo FX lane or unit takes two, and so does each distinct key input`;
  }
  if (cause === "not-isolated") {
    return "this browser can't run openDAW";
  }
  if (cause === "startup-failed") {
    return "openDAW couldn't start";
  }
  const [kind, type] = cause.split(":") as [string, EffectType];
  const name = getEffectDefinition(type)?.name ?? "an effect";
  return kind === "radio-only"
    ? `${name} only runs there`
    : `this ${name} configuration only runs there`;
}

export function hasEnabledEffects(effects: readonly EffectConfig[]): boolean {
  return effects.some((effect) => effect.enabled);
}

/**
 * Disabled official devices retain their boxes; radio-only records stay in the
 * controller state for the compatibility path and are omitted here.
 */
export function selectOfficialEffects(
  effects: readonly EffectConfig[]
): EffectConfig[] {
  return effects.flatMap((effect) => {
    if (!isOfficialOpenDawEffect(effect)) {
      return [];
    }
    if (!("chains" in effect)) {
      return [effect];
    }
    return [
      {
        ...effect,
        chains: effect.chains.map((chain) => ({
          ...chain,
          effects: selectOfficialEffects(chain.effects),
        })),
      } as EffectConfig,
    ];
  });
}

export function canUseOfficialOpenDawRuntime(
  effects: readonly EffectConfig[]
): boolean {
  return hasEnabledEffects(effects) && !radioOnlyFallback(effects);
}
