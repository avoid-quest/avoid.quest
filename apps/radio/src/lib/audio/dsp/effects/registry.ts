/**
 * Effect Registry
 *
 * Compatibility registry derived from the deep effect definitions.
 */

import {
  EFFECT_DEFINITIONS,
  type EffectDefinition,
  getEffectDefinition,
} from "./schema.js";
import { EFFECT_TYPES, type EffectConfig, type EffectType } from "./types.js";

export type EffectMetadata = Pick<
  EffectDefinition,
  "type" | "name" | "description" | "defaultConfig"
> & {
  readonly icon?: string;
};

/**
 * Available effects with their default configurations.
 * Derived from EFFECT_DEFINITIONS so defaults and parameter metadata stay
 * coupled at the effect definition boundary.
 */
export const AVAILABLE_EFFECTS = EFFECT_TYPES.map((type) => {
  const definition = EFFECT_DEFINITIONS[type];
  return {
    type: definition.type,
    name: definition.name,
    description: definition.description,
    defaultConfig: definition.defaultConfig,
  };
}) satisfies EffectMetadata[];

export function getEffectMetadata(
  type: EffectType
): EffectMetadata | undefined {
  const definition = getEffectDefinition(type);
  if (!definition) {
    return;
  }

  return {
    type: definition.type,
    name: definition.name,
    description: definition.description,
    defaultConfig: definition.defaultConfig,
  };
}

export function createDefaultEffectConfig(
  type: EffectType,
  id: string,
  order: number
): EffectConfig {
  const metadata = getEffectMetadata(type);
  if (!metadata) {
    throw new Error(`Unknown effect type: ${type}`);
  }

  return {
    ...metadata.defaultConfig,
    id,
    order,
  } as EffectConfig;
}
