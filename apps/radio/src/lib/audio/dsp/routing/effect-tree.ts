import { clampEffectTempo, DEFAULT_EFFECT_TEMPO } from "../effects/tempo.js";
import type { EffectChainConfig, EffectConfig } from "../effects/types.js";

export { DEFAULT_EFFECT_TEMPO } from "../effects/tempo.js";
export const MAX_EFFECT_TREE_DEPTH = 8;

export function isEffectContainer(
  effect: EffectConfig
): effect is Extract<EffectConfig, { chains: EffectChainConfig[] }> {
  return (
    effect.type === "fxComposite" ||
    effect.type === "stereoSplit" ||
    effect.type === "frequencySplit"
  );
}

export function isValidFrequencySplitShape(
  chains: readonly EffectChainConfig[],
  crossoverFrequencies: readonly number[]
): boolean {
  return (
    chains.length >= 2 &&
    chains.length <= 4 &&
    crossoverFrequencies.length === chains.length - 1 &&
    crossoverFrequencies.every(
      (frequency, index, values) =>
        frequency > 0 && (index === 0 || frequency > (values[index - 1] ?? 0))
    )
  );
}

function orderEffects(effects: readonly EffectConfig[]): EffectConfig[] {
  return [...effects]
    .sort((left, right) => left.order - right.order)
    .map((effect, order) => ({ ...effect, order }) as EffectConfig);
}

function normalizeChains(
  chains: readonly EffectChainConfig[],
  depth: number
): EffectChainConfig[] {
  return [...chains]
    .sort((left, right) => left.order - right.order)
    .map((chain, order) => ({
      ...chain,
      order,
      effects: normalizeEffectTree(chain.effects, depth + 1),
    }));
}

export function normalizeEffectTree(
  effects: readonly EffectConfig[],
  depth = 0
): EffectConfig[] {
  if (depth > MAX_EFFECT_TREE_DEPTH) {
    throw new Error(
      `Effect tree exceeds the maximum depth of ${MAX_EFFECT_TREE_DEPTH}`
    );
  }

  return orderEffects(effects).map((effect) =>
    isEffectContainer(effect)
      ? ({ ...effect, chains: normalizeChains(effect.chains, depth) } as
          | Extract<EffectConfig, { type: "fxComposite" }>
          | Extract<EffectConfig, { type: "stereoSplit" }>
          | Extract<EffectConfig, { type: "frequencySplit" }>)
      : effect
  );
}

export function visitEffectTree(
  effects: readonly EffectConfig[],
  visitor: (
    effect: EffectConfig,
    parentChain: EffectChainConfig | null
  ) => void,
  parentChain: EffectChainConfig | null = null
): void {
  for (const effect of effects) {
    visitor(effect, parentChain);
    if (isEffectContainer(effect)) {
      for (const chain of effect.chains) {
        visitEffectTree(chain.effects, visitor, chain);
      }
    }
  }
}

export function findEffectInTree(
  effects: readonly EffectConfig[],
  effectId: string
): EffectConfig | undefined {
  let result: EffectConfig | undefined;
  visitEffectTree(effects, (effect) => {
    if (!result && effect.id === effectId) {
      result = effect;
    }
  });
  return result;
}

export function findEffectChain(
  effects: readonly EffectConfig[],
  chainId: string
): EffectChainConfig | undefined {
  for (const effect of effects) {
    if (!isEffectContainer(effect)) {
      continue;
    }
    for (const chain of effect.chains) {
      if (chain.id === chainId) {
        return chain;
      }
      const nested = findEffectChain(chain.effects, chainId);
      if (nested) {
        return nested;
      }
    }
  }
  return;
}

export function findRootEffectContainer(
  effects: readonly EffectConfig[],
  effectId: string
): EffectConfig | null {
  return (
    effects.find(
      (effect) =>
        isEffectContainer(effect) &&
        effect.id !== effectId &&
        findEffectInTree([effect], effectId)
    ) ?? null
  );
}

export function findRootEffectContainerForChain(
  effects: readonly EffectConfig[],
  chainId: string
): EffectConfig | null {
  return (
    effects.find(
      (effect) =>
        isEffectContainer(effect) && findEffectChain([effect], chainId)
    ) ?? null
  );
}

export function updateEffectInTree(
  effects: readonly EffectConfig[],
  effectId: string,
  update: Partial<EffectConfig>
): EffectConfig[] {
  return effects.map((effect) => {
    if (effect.id === effectId) {
      return { ...effect, ...update } as EffectConfig;
    }
    if (!isEffectContainer(effect)) {
      return effect;
    }
    return {
      ...effect,
      chains: effect.chains.map((chain) => ({
        ...chain,
        effects: updateEffectInTree(chain.effects, effectId, update),
      })),
    } as EffectConfig;
  });
}

export function removeEffectFromTree(
  effects: readonly EffectConfig[],
  effectId: string
): EffectConfig[] {
  return normalizeEffectTree(
    effects
      .filter((effect) => effect.id !== effectId)
      .map((effect) =>
        isEffectContainer(effect)
          ? ({
              ...effect,
              chains: effect.chains.map((chain) => ({
                ...chain,
                effects: removeEffectFromTree(chain.effects, effectId),
              })),
            } as EffectConfig)
          : effect
      )
  );
}

export function appendEffectToTree(
  effects: readonly EffectConfig[],
  effect: EffectConfig,
  chainId: string | null = null
): EffectConfig[] {
  if (chainId === null) {
    return normalizeEffectTree([
      ...effects,
      { ...effect, order: effects.length },
    ]);
  }

  let found = false;
  const append = (current: readonly EffectConfig[]): EffectConfig[] =>
    current.map((entry) => {
      if (!isEffectContainer(entry)) {
        return entry;
      }
      return {
        ...entry,
        chains: entry.chains.map((chain) => {
          if (chain.id === chainId) {
            found = true;
            return {
              ...chain,
              effects: normalizeEffectTree([
                ...chain.effects,
                { ...effect, order: chain.effects.length } as EffectConfig,
              ]),
            };
          }
          return { ...chain, effects: append(chain.effects) };
        }),
      } as EffectConfig;
    });

  const result = append(effects);
  if (!found) {
    throw new Error(`Effect chain not found: ${chainId}`);
  }
  return normalizeEffectTree(result);
}

export function reorderEffectTreeChain(
  effects: readonly EffectConfig[],
  effectIds: readonly string[],
  chainId: string | null = null
): EffectConfig[] {
  const reorder = (current: readonly EffectConfig[]): EffectConfig[] => {
    const byId = new Map(current.map((effect) => [effect.id, effect]));
    const selected = new Set<string>();
    const result: EffectConfig[] = [];
    for (const id of effectIds) {
      const effect = byId.get(id);
      if (effect && !selected.has(id)) {
        selected.add(id);
        result.push(effect);
      }
    }
    result.push(...current.filter((effect) => !selected.has(effect.id)));
    return result.map(
      (effect, order) => ({ ...effect, order }) as EffectConfig
    );
  };

  if (chainId === null) {
    return reorder(normalizeEffectTree(effects));
  }

  let found = false;
  const visit = (current: readonly EffectConfig[]): EffectConfig[] =>
    current.map((effect) => {
      if (!isEffectContainer(effect)) {
        return effect;
      }
      return {
        ...effect,
        chains: effect.chains.map((chain) => {
          if (chain.id === chainId) {
            found = true;
            return { ...chain, effects: reorder(chain.effects) };
          }
          return { ...chain, effects: visit(chain.effects) };
        }),
      } as EffectConfig;
    });

  const result = visit(normalizeEffectTree(effects));
  if (!found) {
    throw new Error(`Effect chain not found: ${chainId}`);
  }
  return result;
}

export function validateEffectTree(
  effects: readonly EffectConfig[],
  channelIds: ReadonlySet<string>
): string[] {
  const errors: string[] = [];
  const effectIds = new Set<string>();
  const chainIds = new Set<string>();

  const visit = (current: readonly EffectConfig[], depth: number): void => {
    if (depth > MAX_EFFECT_TREE_DEPTH) {
      errors.push(`Effect tree exceeds depth ${MAX_EFFECT_TREE_DEPTH}`);
      return;
    }
    for (const effect of current) {
      if (effectIds.has(effect.id)) {
        errors.push(`Duplicate effect id: ${effect.id}`);
      }
      effectIds.add(effect.id);
      if (effect.sidechain && !channelIds.has(effect.sidechain.channelId)) {
        errors.push(`Unknown sidechain channel: ${effect.sidechain.channelId}`);
      }
      if (!isEffectContainer(effect)) {
        continue;
      }
      if (effect.type === "stereoSplit" && effect.chains.length !== 2) {
        errors.push("Stereo Split must contain exactly two chains");
      }
      if (
        effect.type === "frequencySplit" &&
        !isValidFrequencySplitShape(effect.chains, effect.crossoverFrequencies)
      ) {
        errors.push(
          "Frequency Split requires 2–4 bands with ascending crossovers"
        );
      }
      for (const chain of effect.chains) {
        if (chainIds.has(chain.id)) {
          errors.push(`Duplicate effect chain id: ${chain.id}`);
        }
        chainIds.add(chain.id);
        visit(chain.effects, depth + 1);
      }
    }
  };

  visit(effects, 0);
  return errors;
}

export function normalizeTempoBpm(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? clampEffectTempo(value)
    : DEFAULT_EFFECT_TEMPO;
}
