import type { AudioManager, EffectConfig, FilterConfig } from "@/lib/audio";

function applyStoredEffectsAndFilters(
  audioManager: AudioManager,
  soundId: string,
  _effects: EffectConfig[],
  filter: FilterConfig
): Promise<void> {
  try {
    if (filter.enabled) {
      audioManager.updateFilter(soundId, filter);
    }
  } catch (error) {
    console.warn("[dj-actions] Failed to apply stored filter:", error);
  }
  return Promise.resolve();
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
