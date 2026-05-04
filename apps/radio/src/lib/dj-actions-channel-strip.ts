import type { AudioManager, EffectConfig, FilterConfig } from "@/lib/audio";

async function applyStoredEffectsAndFilters(
  audioManager: AudioManager,
  soundId: string,
  effects: EffectConfig[],
  filter: FilterConfig
): Promise<void> {
  try {
    const workletManager = audioManager.getWorkletManager(soundId);
    if (!workletManager?.isReady) {
      const ready = await audioManager.ensureEffectsReady(soundId);
      if (!ready) {
        return;
      }
    }

    if (filter.enabled) {
      audioManager.updateFilter(soundId, filter);
    }

    for (const effect of effects) {
      audioManager.addEffect(soundId, effect);
    }
  } catch (error) {
    console.warn("[dj-actions] Failed to apply stored effects:", error);
  }
}

function applyStoredChannelStrip(
  audioManager: AudioManager,
  soundId: string,
  muted: boolean,
  pan: number,
  speed: number,
  channelFilter: number,
  effectsDryWet: number
): void {
  try {
    if (muted) {
      audioManager.muteSound(soundId);
    }
    if (pan !== 0) {
      audioManager.setPan(soundId, pan);
    }
    if (speed !== 1) {
      audioManager.setPlaybackRate(soundId, speed);
    }
    if (channelFilter !== 0) {
      audioManager.setChannelFilter(soundId, channelFilter);
    }
    if (effectsDryWet !== 1) {
      audioManager.setEffectsDryWet(soundId, effectsDryWet);
    }
  } catch (error) {
    console.warn("[dj-actions] Failed to apply stored channel strip:", error);
  }
}

export { applyStoredChannelStrip, applyStoredEffectsAndFilters };
