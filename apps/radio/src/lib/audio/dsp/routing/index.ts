/**
 * DSP Routing Module
 *
 * Effect chain management and audio routing utilities.
 */

export {
  EffectChain,
  type EffectChainConfig,
  type EffectInstance,
} from "./effect-chain.js";
export {
  appendEffectToTree,
  DEFAULT_EFFECT_TEMPO,
  findEffectChain,
  findEffectInTree,
  isEffectContainer,
  isValidFrequencySplitShape,
  MAX_EFFECT_TREE_DEPTH,
  normalizeEffectTree,
  normalizeTempoBpm,
  removeEffectFromTree,
  reorderEffectTreeChain,
  updateEffectInTree,
  validateEffectTree,
  visitEffectTree,
} from "./effect-tree.js";
