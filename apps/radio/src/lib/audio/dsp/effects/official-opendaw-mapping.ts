import type { EffectConfig, OpenDawEffectType } from "./types.js";

export const OPENDAW_FACTORY_KEYS = {
  plateReverb: "DattorroReverb",
  crusher: "Crusher",
  fold: "Fold",
  revamp: "Revamp",
  delay: "Delay",
  compressor: "Compressor",
  stereoTool: "StereoTool",
  tidal: "Tidal",
  cheapReverb: "Reverb",
  gate: "Gate",
  waveshaper: "Waveshaper",
  maximizer: "Maximizer",
  vocoder: "Vocoder",
  neuralAmp: "NeuralAmp",
  werkstatt: "Werkstatt",
  autotune: "Autotune",
  fxComposite: "AudioEffectComposite",
  stereoSplit: "StereoComposite",
  frequencySplit: "FrequencySplit",
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
      isOfficialOpenDawEffect(effect) &&
      (!effect.sidechain ||
        effect.type === "compressor" ||
        effect.type === "gate" ||
        effect.type === "vocoder") &&
      (!("chains" in effect) ||
        effect.chains.every((chain) =>
          areOfficialOpenDawEffects(chain.effects)
        ))
  );
}

export function canUseOfficialOpenDawRuntime(
  effects: readonly EffectConfig[]
): boolean {
  return (
    effects.some((effect) => effect.enabled) &&
    areOfficialOpenDawEffects(effects)
  );
}
