import type { EffectConfig } from "../dsp/effects/types.js";
import {
  type AudioState,
  getAudioContext,
  WorkletManager,
} from "../playback/index.js";
import {
  convertEffectConfig,
  convertPartialEffectConfig,
  type EngineEffectConfig,
} from "./audio-manager-effects.js";
import {
  attachWorkletManagerListeners,
  type MeterListener,
} from "./audio-manager-graph.js";
import type { SoundInstance } from "./audio-manager-types.js";

type EffectsControllerOptions = {
  workletProcessorUrl: () => string;
  sounds: Map<string, SoundInstance>;
  meterListeners: Map<string, Set<MeterListener>>;
  notifyListeners: (soundId: string, state: AudioState) => void;
};

class EffectsController {
  private readonly workletManagers = new Map<string, WorkletManager>();
  private readonly workletProcessorUrl: () => string;
  private readonly sounds: Map<string, SoundInstance>;
  private readonly meterListeners: Map<string, Set<MeterListener>>;
  private readonly notifyListeners: (
    soundId: string,
    state: AudioState
  ) => void;

  constructor({
    workletProcessorUrl,
    sounds,
    meterListeners,
    notifyListeners,
  }: EffectsControllerOptions) {
    this.workletProcessorUrl = workletProcessorUrl;
    this.sounds = sounds;
    this.meterListeners = meterListeners;
    this.notifyListeners = notifyListeners;
  }

  add(soundId: string, config: EffectConfig): boolean {
    const wm = this.workletManagers.get(soundId);
    if (!wm) {
      return false;
    }

    const engineConfig: EngineEffectConfig = convertEffectConfig(config);
    wm.addEffect(soundId, config.id, config.type, engineConfig, config.order);
    return true;
  }

  remove(soundId: string, effectId: string): void {
    this.workletManagers.get(soundId)?.removeEffect(soundId, effectId);
  }

  update(
    soundId: string,
    effectId: string,
    config: Partial<EffectConfig>
  ): boolean {
    const wm = this.workletManagers.get(soundId);
    if (!wm) {
      return false;
    }

    const engineConfig: EngineEffectConfig = convertPartialEffectConfig(config);
    wm.updateEffect(soundId, effectId, engineConfig);
    return true;
  }

  reorder(soundId: string, effectIds: string[]): void {
    this.workletManagers.get(soundId)?.reorderEffects(soundId, effectIds);
  }

  setDryWet(soundId: string, value: number): void {
    const clampedValue = Math.max(0, Math.min(1, value));
    this.workletManagers.get(soundId)?.setEffectsDryWet(soundId, clampedValue);
  }

  getWorkletManager(soundId: string): WorkletManager | null {
    return this.workletManagers.get(soundId) ?? null;
  }

  async getOrCreateWorkletManager(soundId: string): Promise<WorkletManager> {
    let wm = this.workletManagers.get(soundId);
    if (wm) {
      return wm;
    }

    const context = getAudioContext();
    if (!context) {
      throw new Error("Audio context not available");
    }

    wm = new WorkletManager(context, this.workletProcessorUrl());
    await wm.init();
    this.workletManagers.set(soundId, wm);

    attachWorkletManagerListeners({
      wm,
      soundId,
      sounds: this.sounds,
      meterListeners: this.meterListeners,
      notifyListeners: this.notifyListeners,
    });

    return wm;
  }

  pauseSource(soundId: string): void {
    this.workletManagers.get(soundId)?.pauseSource(soundId);
  }

  resumeSource(soundId: string): void {
    this.workletManagers.get(soundId)?.resumeSource(soundId);
  }

  stopSource(soundId: string): void {
    this.workletManagers.get(soundId)?.stopSource(soundId);
  }

  cleanupSound(soundId: string): void {
    const wm = this.workletManagers.get(soundId);
    if (wm) {
      wm.cleanup();
      this.workletManagers.delete(soundId);
    }
  }

  cleanup(): void {
    for (const wm of this.workletManagers.values()) {
      wm.cleanup();
    }
    this.workletManagers.clear();
  }
}

export { EffectsController };
export type { EffectsControllerOptions };
