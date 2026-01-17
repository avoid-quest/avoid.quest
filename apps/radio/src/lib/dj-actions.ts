/**
 * DJ Audio Actions Module
 *
 * This module provides audio-related actions for the DJ player.
 * It uses TanStack DB collections for persisted state and
 * TanStack Store for runtime state.
 */

import type { EffectConfig, EffectType, FilterConfig } from "@/lib/audio";
import {
  AudioManager,
  createDefaultEffectConfig,
  type Radio,
} from "@/lib/audio";
import {
  getDeckA,
  getDeckB,
  getMixer,
  resetDeck as resetDeckDb,
  updateDeckA,
  updateDeckB,
  updateMixer,
} from "@/lib/collections";
import {
  getDeckARuntime,
  getDeckASubscriptionCleanup,
  getDeckBRuntime,
  getDeckBSubscriptionCleanup,
  resetDeckARuntime,
  resetDeckBRuntime,
  setDeckARuntimeState,
  setDeckASoundId,
  setDeckASubscriptionCleanup,
  setDeckBRuntimeState,
  setDeckBSoundId,
  setDeckBSubscriptionCleanup,
  setDjError,
} from "@/lib/stores/dj-runtime-store";

export type DeckSide = "left" | "right";

// Lazy initialization of AudioManager to avoid SSR issues
let audioManager: AudioManager | null = null;

const getAudioManager = (): AudioManager => {
  if (typeof window === "undefined") {
    throw new Error("AudioManager can only be used in browser environment");
  }
  if (!audioManager) {
    audioManager = AudioManager.getInstance();
  }
  return audioManager;
};

const getSoundId = (radio: Radio, side: DeckSide): string =>
  `${side}_${radio.id}`;

// Helper to find next track in a platform playlist/album
export const findNextTrack = (
  radio: Radio | null
): { streamUrl: string } | null => {
  if (!radio?.platformMetadata?.tracks) {
    return null;
  }

  const { platformMetadata } = radio;
  const { tracks, platform, itemType } = platformMetadata;

  // Only handle collections (albums/playlists)
  const isCollection =
    (platform === "bandcamp" && itemType === "album") ||
    (platform === "soundcloud" && itemType === "playlist");

  if (!(isCollection && tracks) || tracks.length === 0) {
    return null;
  }

  // Find current track index
  const currentIndex = tracks.findIndex((t) => t.streamUrl === radio.streamUrl);

  if (currentIndex === -1) {
    // Current track not found, return first track
    return tracks[0];
  }

  // Return next track if available
  const nextIndex = currentIndex + 1;
  if (nextIndex < tracks.length) {
    return tracks[nextIndex];
  }

  // No more tracks
  return null;
};

// Apply stored effects and filters to a newly loaded sound
function applyStoredEffectsAndFilters(
  soundId: string,
  effects: EffectConfig[],
  filter: FilterConfig
) {
  try {
    // Apply stored filter if enabled
    if (filter.enabled) {
      getAudioManager().updateFilter(soundId, filter);
    }

    // Apply stored effects
    for (const effect of effects) {
      const success = getAudioManager().addEffect(soundId, effect);
      if (!success) {
        console.warn(
          `[DjActions] Failed to apply effect ${effect.type} to ${soundId}`
        );
      }
    }
  } catch (err) {
    console.error("[DjActions] Error applying stored effects:", err);
  }
}

// Apply stored channel strip settings to a newly loaded sound
function applyStoredChannelStrip(
  soundId: string,
  muted: boolean,
  pan: number,
  speed: number,
  channelFilter: number,
  effectsDryWet: number
) {
  try {
    const manager = getAudioManager();

    // Apply mute state
    if (muted) {
      manager.muteSound(soundId);
    }

    // Apply pan (default is 0 = center)
    if (pan !== 0) {
      manager.setPan(soundId, pan);
    }

    // Apply speed/playback rate (default is 1)
    if (speed !== 1) {
      manager.setPlaybackRate(soundId, speed);
    }

    // Apply channel filter (default is 0 = neutral)
    if (channelFilter !== 0) {
      manager.setChannelFilter(soundId, channelFilter);
    }

    // Apply effects dry/wet (default is 1 = full wet)
    if (effectsDryWet !== 1) {
      manager.setEffectsDryWet(soundId, effectsDryWet);
    }
  } catch (err) {
    console.error("[DjActions] Error applying channel strip:", err);
  }
}

// Apply crossfade based on current mixer position
export function applyCrossfade() {
  if (typeof window === "undefined") {
    return;
  }

  const deckA = getDeckA();
  const deckB = getDeckB();
  const mixer = getMixer();
  const runtimeA = getDeckARuntime();
  const runtimeB = getDeckBRuntime();

  if (!(deckA && deckB && mixer)) {
    return;
  }

  const { crossfadePosition } = mixer;

  const leftFinalVol = (1 - crossfadePosition) * deckA.volume;
  const rightFinalVol = crossfadePosition * deckB.volume;

  const manager = getAudioManager();
  if (runtimeA.soundId) {
    manager.setVolume(runtimeA.soundId, leftFinalVol);
  }
  if (runtimeB.soundId) {
    manager.setVolume(runtimeB.soundId, rightFinalVol);
  }
}

// Set Deck A radio
export async function setDeckARadio(radio: Radio | null) {
  const deckA = getDeckA();
  const runtimeA = getDeckARuntime();

  if (!deckA) {
    return;
  }

  // Preserve the playing state before cleanup
  const wasPlaying = runtimeA.isPlaying;

  // Unsubscribe from previous subscription
  const prevCleanup = getDeckASubscriptionCleanup();
  if (prevCleanup) {
    prevCleanup();
    setDeckASubscriptionCleanup(null);
  }

  // Cleanup existing sound
  if (runtimeA.soundId) {
    await getAudioManager().cleanupSound(runtimeA.soundId);
  }

  if (!radio) {
    // Reset both DB state and runtime state
    resetDeckDb("deck-a");
    resetDeckARuntime();
    return;
  }

  const soundId = getSoundId(radio, "left");

  try {
    setDjError(null);

    // Create the sound
    getAudioManager().createSound(radio, soundId);

    // Update DB with radio
    updateDeckA((draft) => {
      draft.radio = radio;
    });

    // Update runtime with soundId
    setDeckASoundId(soundId);

    // Track whether we've applied channel strip settings
    let hasAppliedChannelStrip = false;

    // Subscribe to sound events
    const cleanup = getAudioManager().subscribe(soundId, (audioState) => {
      const currentDeckA = getDeckA();
      const currentRuntime = getDeckARuntime();

      // Apply stored settings on first play
      if (
        audioState.isPlaying &&
        !audioState.isLoading &&
        !hasAppliedChannelStrip &&
        currentDeckA
      ) {
        hasAppliedChannelStrip = true;
        applyStoredEffectsAndFilters(
          soundId,
          currentDeckA.effects as unknown as EffectConfig[],
          currentDeckA.filter as FilterConfig
        );
        applyStoredChannelStrip(
          soundId,
          currentDeckA.muted,
          currentDeckA.pan,
          currentDeckA.speed,
          currentDeckA.channelFilter,
          currentDeckA.effectsDryWet
        );
      }

      // Detect track end
      const trackEnded = audioState.hasEnded;

      // Update runtime state if changed
      if (
        currentRuntime.isPlaying !== audioState.isPlaying ||
        currentRuntime.isLoading !== audioState.isLoading ||
        currentRuntime.isBuffering !== audioState.isBuffering
      ) {
        setDeckARuntimeState(() => ({
          isPlaying: audioState.isPlaying,
          isLoading: audioState.isLoading,
          isBuffering: audioState.isBuffering,
        }));
      }

      // Set error if present
      if (audioState.error?.message) {
        setDjError(audioState.error.message);
      }

      // Handle track end - auto-advance to next track
      if (trackEnded && currentDeckA?.radio) {
        const nextTrack = findNextTrack(currentDeckA.radio as Radio);
        if (nextTrack) {
          loadTrack(
            "left",
            {
              ...(currentDeckA.radio as Radio),
              streamUrl: nextTrack.streamUrl,
            },
            true // auto-play
          );
        }
      }
    });

    setDeckASubscriptionCleanup(cleanup);

    // If the previous radio was playing, auto-play the new one
    if (wasPlaying) {
      await getAudioManager().playSound(soundId, deckA.volume);
      applyCrossfade();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load Deck A";
    setDjError(msg);
  }
}

// Set Deck B radio
export async function setDeckBRadio(radio: Radio | null) {
  const deckB = getDeckB();
  const runtimeB = getDeckBRuntime();

  if (!deckB) {
    return;
  }

  // Preserve the playing state before cleanup
  const wasPlaying = runtimeB.isPlaying;

  // Unsubscribe from previous subscription
  const prevCleanup = getDeckBSubscriptionCleanup();
  if (prevCleanup) {
    prevCleanup();
    setDeckBSubscriptionCleanup(null);
  }

  // Cleanup existing sound
  if (runtimeB.soundId) {
    await getAudioManager().cleanupSound(runtimeB.soundId);
  }

  if (!radio) {
    // Reset both DB state and runtime state
    resetDeckDb("deck-b");
    resetDeckBRuntime();
    return;
  }

  const soundId = getSoundId(radio, "right");

  try {
    setDjError(null);

    // Create the sound
    getAudioManager().createSound(radio, soundId);

    // Update DB with radio
    updateDeckB((draft) => {
      draft.radio = radio;
    });

    // Update runtime with soundId
    setDeckBSoundId(soundId);

    // Track whether we've applied channel strip settings
    let hasAppliedChannelStrip = false;

    // Subscribe to sound events
    const cleanup = getAudioManager().subscribe(soundId, (audioState) => {
      const currentDeckB = getDeckB();
      const currentRuntime = getDeckBRuntime();

      // Apply stored settings on first play
      if (
        audioState.isPlaying &&
        !audioState.isLoading &&
        !hasAppliedChannelStrip &&
        currentDeckB
      ) {
        hasAppliedChannelStrip = true;
        applyStoredEffectsAndFilters(
          soundId,
          currentDeckB.effects as unknown as EffectConfig[],
          currentDeckB.filter as FilterConfig
        );
        applyStoredChannelStrip(
          soundId,
          currentDeckB.muted,
          currentDeckB.pan,
          currentDeckB.speed,
          currentDeckB.channelFilter,
          currentDeckB.effectsDryWet
        );
      }

      // Detect track end
      const trackEnded = audioState.hasEnded;

      // Update runtime state if changed
      if (
        currentRuntime.isPlaying !== audioState.isPlaying ||
        currentRuntime.isLoading !== audioState.isLoading ||
        currentRuntime.isBuffering !== audioState.isBuffering
      ) {
        setDeckBRuntimeState(() => ({
          isPlaying: audioState.isPlaying,
          isLoading: audioState.isLoading,
          isBuffering: audioState.isBuffering,
        }));
      }

      // Set error if present
      if (audioState.error?.message) {
        setDjError(audioState.error.message);
      }

      // Handle track end - auto-advance to next track
      if (trackEnded && currentDeckB?.radio) {
        const nextTrack = findNextTrack(currentDeckB.radio as Radio);
        if (nextTrack) {
          loadTrack(
            "right",
            {
              ...(currentDeckB.radio as Radio),
              streamUrl: nextTrack.streamUrl,
            },
            true // auto-play
          );
        }
      }
    });

    setDeckBSubscriptionCleanup(cleanup);

    // If the previous radio was playing, auto-play the new one
    if (wasPlaying) {
      await getAudioManager().playSound(soundId, deckB.volume);
      applyCrossfade();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load Deck B";
    setDjError(msg);
  }
}

// Play Deck A
export async function playDeckA() {
  const deckA = getDeckA();
  const runtimeA = getDeckARuntime();

  if (runtimeA.soundId && deckA?.radio && !runtimeA.isPlaying) {
    try {
      await getAudioManager().playSound(runtimeA.soundId, deckA.volume);
      applyCrossfade();
    } catch (err) {
      setDjError(err instanceof Error ? err.message : "Failed to play Deck A");
    }
  }
}

// Play Deck B
export async function playDeckB() {
  const deckB = getDeckB();
  const runtimeB = getDeckBRuntime();

  if (runtimeB.soundId && deckB?.radio && !runtimeB.isPlaying) {
    try {
      await getAudioManager().playSound(runtimeB.soundId, deckB.volume);
      applyCrossfade();
    } catch (err) {
      setDjError(err instanceof Error ? err.message : "Failed to play Deck B");
    }
  }
}

// Pause Deck A
export function pauseDeckA() {
  const runtimeA = getDeckARuntime();
  if (runtimeA.soundId) {
    getAudioManager().pauseSound(runtimeA.soundId);
  }
}

// Pause Deck B
export function pauseDeckB() {
  const runtimeB = getDeckBRuntime();
  if (runtimeB.soundId) {
    getAudioManager().pauseSound(runtimeB.soundId);
  }
}

// Reset Deck A
export async function resetDeckA() {
  const deckA = getDeckA();
  if (deckA?.radio) {
    // Reset channel strip to defaults
    updateDeckA((draft) => {
      draft.volume = 1;
      draft.muted = false;
      draft.pan = 0;
      draft.speed = 1.0;
      draft.channelFilter = 0;
      draft.effectsDryWet = 1.0;
      draft.effects = [];
      draft.filter = {
        type: "lowpass",
        frequency: 1000,
        Q: 1,
        gain: 0,
        enabled: false,
      };
    });
    await setDeckARadio(deckA.radio as Radio);
  }
}

// Reset Deck B
export async function resetDeckB() {
  const deckB = getDeckB();
  if (deckB?.radio) {
    // Reset channel strip to defaults
    updateDeckB((draft) => {
      draft.volume = 1;
      draft.muted = false;
      draft.pan = 0;
      draft.speed = 1.0;
      draft.channelFilter = 0;
      draft.effectsDryWet = 1.0;
      draft.effects = [];
      draft.filter = {
        type: "lowpass",
        frequency: 1000,
        Q: 1,
        gain: 0,
        enabled: false,
      };
    });
    await setDeckBRadio(deckB.radio as Radio);
  }
}

// Cleanup all decks
export async function cleanupAll() {
  await Promise.all([setDeckARadio(null), setDeckBRadio(null)]);
}

// Cleanup audio only (keep radio state)
export async function cleanupAudioOnly() {
  const runtimeA = getDeckARuntime();
  const runtimeB = getDeckBRuntime();

  // Cleanup subscriptions
  const cleanupA = getDeckASubscriptionCleanup();
  const cleanupB = getDeckBSubscriptionCleanup();
  if (cleanupA) {
    cleanupA();
  }
  if (cleanupB) {
    cleanupB();
  }

  // Cleanup sounds
  if (runtimeA.soundId) {
    await getAudioManager().cleanupSound(runtimeA.soundId);
  }
  if (runtimeB.soundId) {
    await getAudioManager().cleanupSound(runtimeB.soundId);
  }

  // Reset runtime state only
  resetDeckARuntime();
  resetDeckBRuntime();
  setDjError(null);
}

// Unified track loading
export async function loadTrack(
  deckSide: DeckSide,
  radio: Radio | null,
  autoPlay = false
) {
  const isLeft = deckSide === "left";
  const runtime = isLeft ? getDeckARuntime() : getDeckBRuntime();
  const setRadio = isLeft ? setDeckARadio : setDeckBRadio;
  const pause = isLeft ? pauseDeckA : pauseDeckB;
  const play = isLeft ? playDeckA : playDeckB;

  // Handle clearing the deck
  if (!radio) {
    await setRadio(null);
    return;
  }

  // Prevent re-entry if already loading
  if (runtime.isLoading) {
    return;
  }

  // Pause current track if playing
  if (runtime.isPlaying) {
    pause();
  }

  // Load new track
  await setRadio(radio);

  // Auto-play if requested
  if (autoPlay) {
    await play();
  }
}

// Mixer actions
export function setCrossfadePosition(position: number) {
  updateMixer((draft) => {
    draft.crossfadePosition = position;
  });
  applyCrossfade();
}

export function setMasterVolume(volume: number) {
  updateMixer((draft) => {
    draft.masterVolume = volume;
  });
  getAudioManager().setGlobalVolume(volume);
}

// Volume actions with audio manager sync
export function setDeckAVolume(volume: number) {
  updateDeckA((draft) => {
    draft.volume = volume;
  });
  applyCrossfade();
}

export function setDeckBVolume(volume: number) {
  updateDeckB((draft) => {
    draft.volume = volume;
  });
  applyCrossfade();
}

// Mute actions with audio manager sync
export function setDeckAMute(muted: boolean) {
  const runtimeA = getDeckARuntime();
  updateDeckA((draft) => {
    draft.muted = muted;
  });
  if (runtimeA.soundId) {
    if (muted) {
      getAudioManager().muteSound(runtimeA.soundId);
    } else {
      getAudioManager().unmuteSound(runtimeA.soundId);
    }
  }
}

export function setDeckBMute(muted: boolean) {
  const runtimeB = getDeckBRuntime();
  updateDeckB((draft) => {
    draft.muted = muted;
  });
  if (runtimeB.soundId) {
    if (muted) {
      getAudioManager().muteSound(runtimeB.soundId);
    } else {
      getAudioManager().unmuteSound(runtimeB.soundId);
    }
  }
}

// Channel strip actions with audio manager sync
export function setDeckAPan(pan: number) {
  const runtimeA = getDeckARuntime();
  updateDeckA((draft) => {
    draft.pan = pan;
  });
  if (runtimeA.soundId) {
    getAudioManager().setPan(runtimeA.soundId, pan);
  }
}

export function setDeckBPan(pan: number) {
  const runtimeB = getDeckBRuntime();
  updateDeckB((draft) => {
    draft.pan = pan;
  });
  if (runtimeB.soundId) {
    getAudioManager().setPan(runtimeB.soundId, pan);
  }
}

export function setDeckASpeed(speed: number) {
  const runtimeA = getDeckARuntime();
  updateDeckA((draft) => {
    draft.speed = speed;
  });
  if (runtimeA.soundId) {
    getAudioManager().setPlaybackRate(runtimeA.soundId, speed);
  }
}

export function setDeckBSpeed(speed: number) {
  const runtimeB = getDeckBRuntime();
  updateDeckB((draft) => {
    draft.speed = speed;
  });
  if (runtimeB.soundId) {
    getAudioManager().setPlaybackRate(runtimeB.soundId, speed);
  }
}

export function setDeckAChannelFilter(value: number) {
  const runtimeA = getDeckARuntime();
  updateDeckA((draft) => {
    draft.channelFilter = value;
  });
  if (runtimeA.soundId) {
    getAudioManager().setChannelFilter(runtimeA.soundId, value);
  }
}

export function setDeckBChannelFilter(value: number) {
  const runtimeB = getDeckBRuntime();
  updateDeckB((draft) => {
    draft.channelFilter = value;
  });
  if (runtimeB.soundId) {
    getAudioManager().setChannelFilter(runtimeB.soundId, value);
  }
}

export function setDeckAEffectsDryWet(value: number) {
  const runtimeA = getDeckARuntime();
  updateDeckA((draft) => {
    draft.effectsDryWet = value;
  });
  if (runtimeA.soundId) {
    getAudioManager().setEffectsDryWet(runtimeA.soundId, value);
  }
}

export function setDeckBEffectsDryWet(value: number) {
  const runtimeB = getDeckBRuntime();
  updateDeckB((draft) => {
    draft.effectsDryWet = value;
  });
  if (runtimeB.soundId) {
    getAudioManager().setEffectsDryWet(runtimeB.soundId, value);
  }
}

// Filter actions with audio manager sync
export function updateDeckAFilter(filter: FilterConfig) {
  const runtimeA = getDeckARuntime();
  updateDeckA((draft) => {
    draft.filter = filter;
  });
  if (runtimeA.soundId) {
    getAudioManager().updateFilter(runtimeA.soundId, filter);
  }
}

export function updateDeckBFilter(filter: FilterConfig) {
  const runtimeB = getDeckBRuntime();
  updateDeckB((draft) => {
    draft.filter = filter;
  });
  if (runtimeB.soundId) {
    getAudioManager().updateFilter(runtimeB.soundId, filter);
  }
}

// Effect actions with audio manager sync
export function addDeckAEffect(type: EffectType) {
  const runtimeA = getDeckARuntime();
  const deckA = getDeckA();
  const effects = (deckA?.effects ?? []) as unknown as EffectConfig[];
  const effect = createDefaultEffectConfig(
    type,
    crypto.randomUUID(),
    effects.length
  );
  updateDeckA((draft) => {
    (draft.effects as unknown as EffectConfig[]).push(effect);
  });
  if (runtimeA.soundId) {
    getAudioManager().addEffect(runtimeA.soundId, effect);
  }
}

export function addDeckBEffect(type: EffectType) {
  const runtimeB = getDeckBRuntime();
  const deckB = getDeckB();
  const effects = (deckB?.effects ?? []) as unknown as EffectConfig[];
  const effect = createDefaultEffectConfig(
    type,
    crypto.randomUUID(),
    effects.length
  );
  updateDeckB((draft) => {
    (draft.effects as unknown as EffectConfig[]).push(effect);
  });
  if (runtimeB.soundId) {
    getAudioManager().addEffect(runtimeB.soundId, effect);
  }
}

export function updateDeckAEffect(
  effectId: string,
  config: Partial<EffectConfig>
) {
  const runtimeA = getDeckARuntime();
  updateDeckA((draft) => {
    const effects = draft.effects as unknown as EffectConfig[];
    const idx = effects.findIndex((e) => e.id === effectId);
    if (idx !== -1) {
      const effect = effects[idx];
      if (effect) {
        effects[idx] = { ...effect, ...config } as EffectConfig;
      }
    }
  });
  if (runtimeA.soundId) {
    getAudioManager().updateEffect(runtimeA.soundId, effectId, config);
  }
}

export function updateDeckBEffect(
  effectId: string,
  config: Partial<EffectConfig>
) {
  const runtimeB = getDeckBRuntime();
  updateDeckB((draft) => {
    const effects = draft.effects as unknown as EffectConfig[];
    const idx = effects.findIndex((e) => e.id === effectId);
    if (idx !== -1) {
      const effect = effects[idx];
      if (effect) {
        effects[idx] = { ...effect, ...config } as EffectConfig;
      }
    }
  });
  if (runtimeB.soundId) {
    getAudioManager().updateEffect(runtimeB.soundId, effectId, config);
  }
}

export function removeDeckAEffect(effectId: string) {
  const runtimeA = getDeckARuntime();
  updateDeckA((draft) => {
    const effects = draft.effects as unknown as EffectConfig[];
    draft.effects = effects.filter(
      (e) => e.id !== effectId
    ) as unknown as typeof draft.effects;
  });
  if (runtimeA.soundId) {
    getAudioManager().removeEffect(runtimeA.soundId, effectId);
  }
}

export function removeDeckBEffect(effectId: string) {
  const runtimeB = getDeckBRuntime();
  updateDeckB((draft) => {
    const effects = draft.effects as unknown as EffectConfig[];
    draft.effects = effects.filter(
      (e) => e.id !== effectId
    ) as unknown as typeof draft.effects;
  });
  if (runtimeB.soundId) {
    getAudioManager().removeEffect(runtimeB.soundId, effectId);
  }
}

export function reorderDeckAEffects(effectIds: string[]) {
  const runtimeA = getDeckARuntime();
  const deckA = getDeckA();
  if (!deckA) {
    return;
  }
  const effects = deckA.effects as unknown as EffectConfig[];
  const reorderedEffects = effectIds
    .map((id) => effects.find((e) => e.id === id))
    .filter((e): e is EffectConfig => e !== undefined);
  updateDeckA((draft) => {
    draft.effects = reorderedEffects as unknown as typeof draft.effects;
  });
  if (runtimeA.soundId) {
    getAudioManager().reorderEffects(runtimeA.soundId, effectIds);
  }
}

export function reorderDeckBEffects(effectIds: string[]) {
  const runtimeB = getDeckBRuntime();
  const deckB = getDeckB();
  if (!deckB) {
    return;
  }
  const effects = deckB.effects as unknown as EffectConfig[];
  const reorderedEffects = effectIds
    .map((id) => effects.find((e) => e.id === id))
    .filter((e): e is EffectConfig => e !== undefined);
  updateDeckB((draft) => {
    draft.effects = reorderedEffects as unknown as typeof draft.effects;
  });
  if (runtimeB.soundId) {
    getAudioManager().reorderEffects(runtimeB.soundId, effectIds);
  }
}
