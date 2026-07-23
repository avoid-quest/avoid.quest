import type { AudioManager, EffectConfig, FilterConfig } from "@/lib/audio";
import { visitEffectTree } from "@/lib/audio/dsp/routing/effect-tree";
import { getPlaybackSession } from "@/lib/collections/playback-sessions";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";
import { orderEffectsForPlayback } from "./effect-order.js";

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

    audioManager.setEffectsTempo?.(
      soundId,
      getPlaybackSession("dj")?.tempo ?? 120
    );
    for (const effect of orderEffectsForPlayback(effects)) {
      audioManager.addEffect(soundId, effect);
    }
    let sidechainChannelId: string | null = null;
    visitEffectTree(effects, (effect) => {
      sidechainChannelId ??= effect.sidechain?.channelId ?? null;
    });
    if (sidechainChannelId) {
      audioManager.setEffectsSidechain(
        soundId,
        getPlaybackChannelRuntime(sidechainChannelId).soundId
      );
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
