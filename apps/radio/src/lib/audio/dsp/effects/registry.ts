/**
 * Effect Registry
 *
 * Compatibility registry derived from the deep effect definitions.
 */

import { isOfficialOpenDawEffectType } from "./official-opendaw-mapping.js";
import {
  EFFECT_DEFINITIONS,
  type EffectDefinition,
  getEffectDefinition,
} from "./schema.js";
import {
  EFFECT_TYPES,
  type EffectConfig,
  type EffectType,
  OPENDAW_EFFECT_TYPES,
  RADIO_EFFECT_TYPES,
} from "./types.js";

export type EffectMetadata = Readonly<
  Pick<EffectDefinition, "type" | "name" | "description" | "defaultConfig">
> & {
  readonly icon?: string;
  readonly family: "openDAW" | "radio";
};

function effectMetadata(type: EffectType): EffectMetadata {
  const definition = EFFECT_DEFINITIONS[type];
  return {
    defaultConfig: definition.defaultConfig,
    description: definition.description,
    family: isOfficialOpenDawEffectType(type) ? "openDAW" : "radio",
    name: definition.name,
    type: definition.type,
  };
}

/**
 * Available effects with their default configurations.
 * Derived from EFFECT_DEFINITIONS so defaults and parameter metadata stay
 * coupled at the effect definition boundary.
 */
export const OPENDAW_AVAILABLE_EFFECTS: readonly EffectMetadata[] =
  OPENDAW_EFFECT_TYPES.map(effectMetadata);

export const RADIO_AVAILABLE_EFFECTS: readonly EffectMetadata[] =
  RADIO_EFFECT_TYPES.map(effectMetadata);

export const AVAILABLE_EFFECTS: readonly EffectMetadata[] =
  EFFECT_TYPES.map(effectMetadata);

function scopeNestedIds(effect: EffectConfig): EffectConfig {
  if (
    effect.type !== "fxComposite" &&
    effect.type !== "stereoSplit" &&
    effect.type !== "frequencySplit"
  ) {
    return effect;
  }
  return {
    ...effect,
    chains: effect.chains.map((chain) => ({
      ...chain,
      effects: chain.effects.map((child, index) =>
        scopeNestedIds({
          ...child,
          id: `${effect.id}:${chain.id}:effect:${index}:${child.id}`,
        } as EffectConfig)
      ),
      id: `${effect.id}:${chain.id}`,
    })),
  };
}

export function getEffectMetadata(
  type: EffectType
): EffectMetadata | undefined {
  const definition = getEffectDefinition(type);
  if (!definition) {
    return;
  }

  return {
    defaultConfig: definition.defaultConfig,
    description: definition.description,
    family: isOfficialOpenDawEffectType(type) ? "openDAW" : "radio",
    name: definition.name,
    type: definition.type,
  };
}

export function createDefaultEffectConfig<TType extends EffectType>(
  type: TType,
  id: string,
  order: number
): Extract<EffectConfig, { type: TType }> {
  const metadata = getEffectMetadata(type);
  if (!metadata) {
    throw new Error(`Unknown effect type: ${type}`);
  }

  return scopeNestedIds({
    ...structuredClone(metadata.defaultConfig),
    id,
    order,
  } as EffectConfig) as Extract<EffectConfig, { type: TType }>;
}
