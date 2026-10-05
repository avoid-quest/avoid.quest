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
  private readonly dryL: Float32Array;
  private readonly dryR: Float32Array;

  constructor(config: EffectChainConfig) {
    this.sampleRate = config.sampleRate;
    const blockSize = config.blockSize ?? 128;
    this.tempL = new Float32Array(blockSize);
    this.tempR = new Float32Array(blockSize);
    this.dryL = new Float32Array(blockSize);
    this.dryR = new Float32Array(blockSize);
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
      config,
      enabled: config.enabled,
      id,
      processor,
      type,
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
    // Filter to only valid IDs instead of throwing
    const validIds = newOrder.filter((id) => this.effects.has(id));

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
      .filter((effect): effect is EffectInstance => !!effect?.enabled);

    if (enabledEffects.length === 0) {
      // No effects enabled - pass through
      for (let i = fromIndex; i < toIndex; i += 1) {
        outputL[i] = inputL[i] ?? 0;
        outputR[i] = inputR[i] ?? 0;
      }
      return;
    }

    // Process through chain using stereo channel pairs
    let current: [Float32Array, Float32Array] = [inputL, inputR];
    const temp: [Float32Array, Float32Array] = [this.tempL, this.tempR];
    const output: [Float32Array, Float32Array] = [outputL, outputR];

    for (
      let effectIndex = 0;
      effectIndex < enabledEffects.length;
      effectIndex += 1
    ) {
      const effect = enabledEffects[effectIndex];
      if (!effect) {
        continue;
      }

      const isLast = effectIndex === enabledEffects.length - 1;
      const target = isLast ? output : temp;
      const [currentL, currentR] = current;
      const [targetL, targetR] = target;
      const { dryWet, outputGain } = effect.config;
      const inputGain =
        effect.config.inputGain * (effect.config.signalGain ?? 1);

      // Apply input gain
      if (inputGain !== 1.0) {
        for (let i = fromIndex; i < toIndex; i += 1) {
          targetL[i] = (currentL[i] ?? 0) * inputGain;
          targetR[i] = (currentR[i] ?? 0) * inputGain;
        }
        current = target;
      }

      // Store dry signal before effect processing for dry/wet mix
      const needsDryMix = dryWet < 1.0;
      if (needsDryMix) {
        for (let i = fromIndex; i < toIndex; i += 1) {
          this.dryL[i] = current[0][i] ?? 0;
          this.dryR[i] = current[1][i] ?? 0;
        }
      }

      // Process effect with stereo channels
      effect.processor.process(current, target, fromIndex, toIndex);

      // Apply dry/wet mix using saved dry signal
      if (needsDryMix) {
        const dryAmount = 1.0 - dryWet;
        for (let i = fromIndex; i < toIndex; i += 1) {
          targetL[i] = this.dryL[i] * dryAmount + (targetL[i] ?? 0) * dryWet;
          targetR[i] = this.dryR[i] * dryAmount + (targetR[i] ?? 0) * dryWet;
        }
      }

      // Apply output gain
      if (outputGain !== 1.0) {
        for (let i = fromIndex; i < toIndex; i += 1) {
          targetL[i] = (targetL[i] ?? 0) * outputGain;
          targetR[i] = (targetR[i] ?? 0) * outputGain;
        }
      }

      // Set up for next iteration
      if (!isLast) {
        current = target;
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

    for (let i = 0; i < this.effectOrder.length; i += 1) {
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
