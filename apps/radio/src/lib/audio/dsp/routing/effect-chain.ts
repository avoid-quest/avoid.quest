/**
 * Effect Chain Manager
 *
 * Manages effect ordering and routing for audio processing chains.
 */

import type {
  EffectConfig,
  EffectProcessor,
  EffectType,
} from "../effects/types.js";

/**
 * Effect instance with its processor and configuration
 */
export type EffectInstance = {
  id: string;
  type: EffectType;
  processor: EffectProcessor;
  config: EffectConfig;
  enabled: boolean;
};

/**
 * Effect chain configuration
 */
export type EffectChainConfig = {
  sampleRate: number;
  blockSize?: number;
};

/**
 * Manages an ordered chain of audio effects
 */
export class EffectChain {
  private readonly effects = new Map<string, EffectInstance>();
  private effectOrder: string[] = [];
  private readonly sampleRate: number;

  // Processing buffers
  private readonly tempL: Float32Array;
  private readonly tempR: Float32Array;

  constructor(config: EffectChainConfig) {
    this.sampleRate = config.sampleRate;
    const blockSize = config.blockSize ?? 128;
    this.tempL = new Float32Array(blockSize);
    this.tempR = new Float32Array(blockSize);
  }

  /**
   * Add an effect to the chain
   */
  addEffect(
    id: string,
    type: EffectType,
    processor: EffectProcessor,
    config: EffectConfig
  ): void {
    const instance: EffectInstance = {
      id,
      type,
      processor,
      config,
      enabled: config.enabled,
    };

    this.effects.set(id, instance);

    // Insert at correct position based on order
    this.insertAtOrder(id, config.order);
  }

  /**
   * Remove an effect from the chain
   */
  removeEffect(id: string): boolean {
    if (!this.effects.has(id)) {
      return false;
    }

    this.effects.delete(id);
    this.effectOrder = this.effectOrder.filter((eid) => eid !== id);
    return true;
  }

  /**
   * Update effect configuration
   */
  updateEffect(id: string, config: Partial<EffectConfig>): boolean {
    const effect = this.effects.get(id);
    if (!effect) {
      return false;
    }

    effect.config = { ...effect.config, ...config } as EffectConfig;
    effect.enabled = effect.config.enabled;

    // Re-order if order changed
    if (config.order !== undefined) {
      this.effectOrder = this.effectOrder.filter((eid) => eid !== id);
      this.insertAtOrder(id, config.order);
    }

    return true;
  }

  /**
   * Enable or disable an effect
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const effect = this.effects.get(id);
    if (!effect) {
      return false;
    }

    effect.enabled = enabled;
    effect.config.enabled = enabled;
    return true;
  }

  /**
   * Reorder effects
   */
  reorderEffects(newOrder: string[]): void {
    // Validate all IDs exist
    const validIds = newOrder.filter((id) => this.effects.has(id));
    if (validIds.length !== newOrder.length) {
      throw new Error("Invalid effect IDs in reorder list");
    }

    this.effectOrder = validIds;

    // Update order numbers in configs
    for (const [index, id] of this.effectOrder.entries()) {
      const effect = this.effects.get(id);
      if (effect) {
        effect.config.order = index;
      }
    }
  }

  /**
   * Get effect by ID
   */
  getEffect(id: string): EffectInstance | undefined {
    return this.effects.get(id);
  }

  /**
   * Get all effects in order
   */
  getEffectsInOrder(): EffectInstance[] {
    const result: EffectInstance[] = [];
    for (const id of this.effectOrder) {
      const effect = this.effects.get(id);
      if (effect) {
        result.push(effect);
      }
    }
    return result;
  }

  /**
   * Get effect order
   */
  getOrder(): string[] {
    return [...this.effectOrder];
  }

  /**
   * Process audio through the effect chain
   */
  process(
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: number,
    toIndex: number
  ): void {
    const enabledEffects = this.effectOrder
      .map((id) => this.effects.get(id))
      .filter((e): e is EffectInstance => !!e?.enabled);

    if (enabledEffects.length === 0) {
      // No effects enabled - pass through
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = inputL[i] ?? 0;
        outputR[i] = inputR[i] ?? 0;
      }
      return;
    }

    // Process through chain
    let currentInputL = inputL;
    let currentInputR = inputR;

    for (let e = 0; e < enabledEffects.length; e++) {
      const effect = enabledEffects[e];
      if (!effect) {
        continue;
      }

      const isLast = e === enabledEffects.length - 1;
      const targetL = isLast ? outputL : this.tempL;
      const targetR = isLast ? outputR : this.tempR;

      // Apply input gain
      const inputGain = effect.config.inputGain;
      if (inputGain !== 1.0) {
        for (let i = fromIndex; i < toIndex; i++) {
          targetL[i] = (currentInputL[i] ?? 0) * inputGain;
          targetR[i] = (currentInputR[i] ?? 0) * inputGain;
        }
        currentInputL = targetL;
        currentInputR = targetR;
      }

      // Process effect
      effect.processor.process(
        currentInputL,
        currentInputR,
        targetL,
        targetR,
        fromIndex,
        toIndex
      );

      // Apply dry/wet mix
      const dryWet = effect.config.dryWet;
      if (dryWet < 1.0) {
        const dryAmount = 1.0 - dryWet;
        for (let i = fromIndex; i < toIndex; i++) {
          targetL[i] =
            (currentInputL[i] ?? 0) * dryAmount + (targetL[i] ?? 0) * dryWet;
          targetR[i] =
            (currentInputR[i] ?? 0) * dryAmount + (targetR[i] ?? 0) * dryWet;
        }
      }

      // Apply output gain
      const outputGain = effect.config.outputGain;
      if (outputGain !== 1.0) {
        for (let i = fromIndex; i < toIndex; i++) {
          targetL[i] = (targetL[i] ?? 0) * outputGain;
          targetR[i] = (targetR[i] ?? 0) * outputGain;
        }
      }

      // Set up for next iteration
      if (!isLast) {
        currentInputL = targetL;
        currentInputR = targetR;
      }
    }
  }

  /**
   * Reset all effects in the chain
   */
  reset(): void {
    for (const effect of this.effects.values()) {
      effect.processor.reset();
    }
  }

  /**
   * Clear all effects from the chain
   */
  clear(): void {
    this.effects.clear();
    this.effectOrder = [];
  }

  /**
   * Get sample rate
   */
  getSampleRate(): number {
    return this.sampleRate;
  }

  /**
   * Insert effect ID at the correct position based on order number
   */
  private insertAtOrder(id: string, order: number): void {
    let insertIndex = 0;

    for (let i = 0; i < this.effectOrder.length; i++) {
      const existingId = this.effectOrder[i];
      if (existingId) {
        const existingEffect = this.effects.get(existingId);
        if (existingEffect && existingEffect.config.order < order) {
          insertIndex = i + 1;
        }
      }
    }

    this.effectOrder.splice(insertIndex, 0, id);
  }
}
