import type { EffectConfig, OpenDawEffectType } from "./types.js";

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
 * Radio-only effects cannot be silently discarded during an official-engine
 * migration. Containers are traversed so nested legacy effects keep the whole
 * sound on the compatibility path until a hybrid graph is explicitly added.
 */
function areOfficialOpenDawEffects(effects: readonly EffectConfig[]): boolean {
  return effects.every(
    (effect) =>
      !effect.enabled ||
      (isOfficialOpenDawEffect(effect) &&
        (!effect.sidechain ||
          effect.type === "compressor" ||
          effect.type === "gate" ||
          effect.type === "vocoder") &&
        (!("chains" in effect) ||
          effect.chains.every((chain) =>
            areOfficialOpenDawEffects(chain.effects)
          )))
  );
}

export function hasEnabledEffects(effects: readonly EffectConfig[]): boolean {
  return effects.some((effect) => effect.enabled);
}

/**
 * Disabled radio-only records remain in the persisted controller state, but
 * must not be handed to the official adapter while an official-only active
 * chain is selected.
 */
export function selectEnabledEffects(
  effects: readonly EffectConfig[]
): EffectConfig[] {
  return effects.flatMap((effect) => {
    if (!effect.enabled) {
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
          effects: selectEnabledEffects(chain.effects),
        })),
      } as EffectConfig,
    ];
  });
}

export function canUseOfficialOpenDawRuntime(
  effects: readonly EffectConfig[]
): boolean {
  return hasEnabledEffects(effects) && areOfficialOpenDawEffects(effects);
}
