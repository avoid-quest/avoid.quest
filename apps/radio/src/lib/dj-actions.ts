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
  type CueBus,
  createCueBus,
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
type DeckId = "deck-a" | "deck-b";

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

// Lazy initialization of CueBus for pre-fader monitoring
let cueBus: CueBus | null = null;

/**
 * Get or create the CueBus instance
 * Requires AudioContext to be available (user gesture)
 */
export const getCueBus = (audioContext: AudioContext): CueBus => {
  if (typeof window === "undefined") {
    throw new Error("CueBus can only be used in browser environment");
  }
  if (!cueBus) {
    // For now, use split cue mode (L=CUE, R=MIX)
    // Dual output mode requires OutputRouter integration
    cueBus = createCueBus(audioContext, null, {
      onCueBlendChange: (blend) => {
        updateMixer((draft) => {
          draft.cueBlend = blend;
        });
      },
      onDeckCueChange: (deckId, enabled) => {
        updateMixer((draft) => {
          if (deckId === "deck-a") {
            draft.deckACueEnabled = enabled;
          } else if (deckId === "deck-b") {
            draft.deckBCueEnabled = enabled;
          }
        });
      },
    });

    // Register both decks
    cueBus.registerDeck("deck-a");
    cueBus.registerDeck("deck-b");

    // Restore state from persisted mixer
    const mixer = getMixer();
    if (mixer) {
      cueBus.setCueMixBlend(mixer.cueBlend);
      if (mixer.deckACueEnabled) {
        cueBus.setCueEnabled("deck-a", true);
      }
      if (mixer.deckBCueEnabled) {
        cueBus.setCueEnabled("deck-b", true);
      }
    }
  }
  return cueBus;
};

/**
 * Check if CueBus is initialized
 */
export const isCueBusInitialized = (): boolean => cueBus !== null;

const getSoundId = (radio: Radio, side: DeckSide): string =>
  `${side}_${radio.id}`;

// Deck-specific function mappings
const deckConfig = {
  "deck-a": {
    side: "left" as DeckSide,
    getDeck: getDeckA,
    getRuntime: getDeckARuntime,
    getSubscriptionCleanup: getDeckASubscriptionCleanup,
    setSubscriptionCleanup: setDeckASubscriptionCleanup,
    setSoundId: setDeckASoundId,
    setRuntimeState: setDeckARuntimeState,
    resetRuntime: resetDeckARuntime,
    updateDeck: updateDeckA,
  },
  "deck-b": {
    side: "right" as DeckSide,
    getDeck: getDeckB,
    getRuntime: getDeckBRuntime,
    getSubscriptionCleanup: getDeckBSubscriptionCleanup,
    setSubscriptionCleanup: setDeckBSubscriptionCleanup,
    setSoundId: setDeckBSoundId,
    setRuntimeState: setDeckBRuntimeState,
    resetRuntime: resetDeckBRuntime,
    updateDeck: updateDeckB,
  },
} as const;

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

    if (muted) {
      manager.muteSound(soundId);
    }
    if (pan !== 0) {
      manager.setPan(soundId, pan);
    }
    if (speed !== 1) {
      manager.setPlaybackRate(soundId, speed);
    }
    if (channelFilter !== 0) {
      manager.setChannelFilter(soundId, channelFilter);
    }
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

// Generic set deck radio function
async function setDeckRadio(deckId: DeckId, radio: Radio | null) {
  const config = deckConfig[deckId];
  const deck = config.getDeck();
  const runtime = config.getRuntime();

  if (!deck) {
    return;
  }

  // Preserve the playing state before cleanup
  const wasPlaying = runtime.isPlaying;

  // Unsubscribe from previous subscription
  const prevCleanup = config.getSubscriptionCleanup();
  if (prevCleanup) {
    prevCleanup();
    config.setSubscriptionCleanup(null);
  }

  // Cleanup existing sound
  if (runtime.soundId) {
    await getAudioManager().cleanupSound(runtime.soundId);
  }

  if (!radio) {
    // Reset both DB state and runtime state
    resetDeckDb(deckId);
    config.resetRuntime();
    return;
  }

  const soundId = getSoundId(radio, config.side);

  try {
    setDjError(null);

    // Create the sound
    getAudioManager().createSound(radio, soundId);

    // Update DB with radio
    config.updateDeck((draft) => {
      draft.radio = radio;
    });

    // Update runtime with soundId
    config.setSoundId(soundId);

    // Track whether we've applied channel strip settings
    let hasAppliedChannelStrip = false;

    // Subscribe to sound events
    const cleanup = getAudioManager().subscribe(soundId, (audioState) => {
      const currentDeck = config.getDeck();
      const currentRuntime = config.getRuntime();

      // Apply stored settings on first play
      if (
        audioState.isPlaying &&
        !audioState.isLoading &&
        !hasAppliedChannelStrip &&
        currentDeck
      ) {
        hasAppliedChannelStrip = true;
        applyStoredEffectsAndFilters(
          soundId,
          currentDeck.effects as unknown as EffectConfig[],
          currentDeck.filter as FilterConfig
        );
        applyStoredChannelStrip(
          soundId,
          currentDeck.muted,
          currentDeck.pan,
          currentDeck.speed,
          currentDeck.channelFilter,
          currentDeck.effectsDryWet
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
        config.setRuntimeState(() => ({
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
      if (trackEnded && currentDeck?.radio) {
        const nextTrack = findNextTrack(currentDeck.radio as Radio);
        if (nextTrack) {
          loadTrack(
            config.side,
            {
              ...(currentDeck.radio as Radio),
              streamUrl: nextTrack.streamUrl,
            },
            true // auto-play
          );
        }
      }
    });

    config.setSubscriptionCleanup(cleanup);

    // If the previous radio was playing, auto-play the new one
    if (wasPlaying) {
      await getAudioManager().playSound(soundId, deck.volume);
      applyCrossfade();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : `Failed to load ${deckId}`;
    setDjError(msg);
  }
}

// Public deck radio functions
export async function setDeckARadio(radio: Radio | null) {
  return await setDeckRadio("deck-a", radio);
}

export async function setDeckBRadio(radio: Radio | null) {
  return await setDeckRadio("deck-b", radio);
}

// Generic play deck function
async function playDeck(deckId: DeckId) {
  const config = deckConfig[deckId];
  const deck = config.getDeck();
  const runtime = config.getRuntime();

  if (runtime.soundId && deck?.radio && !runtime.isPlaying) {
    try {
      await getAudioManager().playSound(runtime.soundId, deck.volume);
      applyCrossfade();
    } catch (err) {
      setDjError(
        err instanceof Error ? err.message : `Failed to play ${deckId}`
      );
    }
  }
}

export async function playDeckA() {
  return await playDeck("deck-a");
}

export async function playDeckB() {
  return await playDeck("deck-b");
}

// Generic pause deck function
function pauseDeck(deckId: DeckId) {
  const runtime = deckConfig[deckId].getRuntime();
  if (runtime.soundId) {
    getAudioManager().pauseSound(runtime.soundId);
  }
}

export function pauseDeckA() {
  pauseDeck("deck-a");
}

export function pauseDeckB() {
  pauseDeck("deck-b");
}

// Generic reset deck function
async function resetDeck(deckId: DeckId) {
  const config = deckConfig[deckId];
  const deck = config.getDeck();
  if (deck?.radio) {
    // Reset channel strip to defaults
    config.updateDeck((draft) => {
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
    await setDeckRadio(deckId, deck.radio as Radio);
  }
}

export async function resetDeckA() {
  return await resetDeck("deck-a");
}

export async function resetDeckB() {
  return await resetDeck("deck-b");
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
  const deckId = deckSide === "left" ? "deck-a" : "deck-b";
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  const setRadio = deckSide === "left" ? setDeckARadio : setDeckBRadio;
  const pause = deckSide === "left" ? pauseDeckA : pauseDeckB;
  const play = deckSide === "left" ? playDeckA : playDeckB;

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
function setDeckVolume(deckId: DeckId, volume: number) {
  deckConfig[deckId].updateDeck((draft) => {
    draft.volume = volume;
  });
  applyCrossfade();
}

export function setDeckAVolume(volume: number) {
  setDeckVolume("deck-a", volume);
}

export function setDeckBVolume(volume: number) {
  setDeckVolume("deck-b", volume);
}

// Mute actions with audio manager sync
function setDeckMute(deckId: DeckId, muted: boolean) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.muted = muted;
  });
  if (runtime.soundId) {
    if (muted) {
      getAudioManager().muteSound(runtime.soundId);
    } else {
      getAudioManager().unmuteSound(runtime.soundId);
    }
  }
}

export function setDeckAMute(muted: boolean) {
  setDeckMute("deck-a", muted);
}

export function setDeckBMute(muted: boolean) {
  setDeckMute("deck-b", muted);
}

// Channel strip actions with audio manager sync
function setDeckPan(deckId: DeckId, pan: number) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.pan = pan;
  });
  if (runtime.soundId) {
    getAudioManager().setPan(runtime.soundId, pan);
  }
}

export function setDeckAPan(pan: number) {
  setDeckPan("deck-a", pan);
}

export function setDeckBPan(pan: number) {
  setDeckPan("deck-b", pan);
}

function setDeckSpeed(deckId: DeckId, speed: number) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.speed = speed;
  });
  if (runtime.soundId) {
    getAudioManager().setPlaybackRate(runtime.soundId, speed);
  }
}

export function setDeckASpeed(speed: number) {
  setDeckSpeed("deck-a", speed);
}

export function setDeckBSpeed(speed: number) {
  setDeckSpeed("deck-b", speed);
}

function setDeckChannelFilter(deckId: DeckId, value: number) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.channelFilter = value;
  });
  if (runtime.soundId) {
    getAudioManager().setChannelFilter(runtime.soundId, value);
  }
}

export function setDeckAChannelFilter(value: number) {
  setDeckChannelFilter("deck-a", value);
}

export function setDeckBChannelFilter(value: number) {
  setDeckChannelFilter("deck-b", value);
}

function setDeckEffectsDryWet(deckId: DeckId, value: number) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.effectsDryWet = value;
  });
  if (runtime.soundId) {
    getAudioManager().setEffectsDryWet(runtime.soundId, value);
  }
}

export function setDeckAEffectsDryWet(value: number) {
  setDeckEffectsDryWet("deck-a", value);
}

export function setDeckBEffectsDryWet(value: number) {
  setDeckEffectsDryWet("deck-b", value);
}

// Filter actions with audio manager sync
function updateDeckFilter(deckId: DeckId, filter: FilterConfig) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.filter = filter;
  });
  if (runtime.soundId) {
    getAudioManager().updateFilter(runtime.soundId, filter);
  }
}

export function updateDeckAFilter(filter: FilterConfig) {
  updateDeckFilter("deck-a", filter);
}

export function updateDeckBFilter(filter: FilterConfig) {
  updateDeckFilter("deck-b", filter);
}

// Effect actions with audio manager sync
function addDeckEffect(deckId: DeckId, type: EffectType) {
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  const deck = config.getDeck();
  const effects = deck?.effects ?? [];
  const effect = createDefaultEffectConfig(
    type,
    crypto.randomUUID(),
    effects.length
  );
  config.updateDeck((draft) => {
    (draft.effects as unknown as EffectConfig[]).push(effect);
  });
  if (runtime.soundId) {
    getAudioManager().addEffect(runtime.soundId, effect);
  }
}

export function addDeckAEffect(type: EffectType) {
  addDeckEffect("deck-a", type);
}

export function addDeckBEffect(type: EffectType) {
  addDeckEffect("deck-b", type);
}

function updateDeckEffect(
  deckId: DeckId,
  effectId: string,
  effectConfig: Partial<EffectConfig>
) {
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  config.updateDeck((draft) => {
    const effects = draft.effects as unknown as EffectConfig[];
    const idx = effects.findIndex((e) => e.id === effectId);
    if (idx !== -1) {
      const effect = effects[idx];
      if (effect) {
        effects[idx] = { ...effect, ...effectConfig } as EffectConfig;
      }
    }
  });
  if (runtime.soundId) {
    getAudioManager().updateEffect(runtime.soundId, effectId, effectConfig);
  }
}

export function updateDeckAEffect(
  effectId: string,
  config: Partial<EffectConfig>
) {
  updateDeckEffect("deck-a", effectId, config);
}

export function updateDeckBEffect(
  effectId: string,
  config: Partial<EffectConfig>
) {
  updateDeckEffect("deck-b", effectId, config);
}

function removeDeckEffect(deckId: DeckId, effectId: string) {
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  config.updateDeck((draft) => {
    draft.effects = draft.effects.filter((e) => e.id !== effectId);
  });
  if (runtime.soundId) {
    getAudioManager().removeEffect(runtime.soundId, effectId);
  }
}

export function removeDeckAEffect(effectId: string) {
  removeDeckEffect("deck-a", effectId);
}

export function removeDeckBEffect(effectId: string) {
  removeDeckEffect("deck-b", effectId);
}

function reorderDeckEffects(deckId: DeckId, effectIds: string[]) {
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  const deck = config.getDeck();
  if (!deck) {
    return;
  }
  const effects = deck.effects as unknown as EffectConfig[];
  const reorderedEffects = effectIds
    .map((id) => effects.find((e) => e.id === id))
    .filter((e): e is EffectConfig => e !== undefined);
  config.updateDeck((draft) => {
    draft.effects = reorderedEffects as unknown as typeof draft.effects;
  });
  if (runtime.soundId) {
    getAudioManager().reorderEffects(runtime.soundId, effectIds);
  }
}

export function reorderDeckAEffects(effectIds: string[]) {
  reorderDeckEffects("deck-a", effectIds);
}

export function reorderDeckBEffects(effectIds: string[]) {
  reorderDeckEffects("deck-b", effectIds);
}

// ============================================
// CUE Monitoring Actions
// ============================================

/**
 * Enable/disable CUE monitoring for a deck (pre-fader listen)
 */
function setDeckCueEnabled(deckId: DeckId, enabled: boolean) {
  if (!cueBus) {
    console.warn("[DjActions] CueBus not initialized");
    return;
  }
  cueBus.setCueEnabled(deckId, enabled);
  updateMixer((draft) => {
    if (deckId === "deck-a") {
      draft.deckACueEnabled = enabled;
    } else {
      draft.deckBCueEnabled = enabled;
    }
  });
}

export function setDeckACueEnabled(enabled: boolean) {
  setDeckCueEnabled("deck-a", enabled);
}

export function setDeckBCueEnabled(enabled: boolean) {
  setDeckCueEnabled("deck-b", enabled);
}

/**
 * Toggle CUE monitoring for a deck
 */
export function toggleDeckACue() {
  const mixer = getMixer();
  setDeckACueEnabled(!mixer?.deckACueEnabled);
}

export function toggleDeckBCue() {
  const mixer = getMixer();
  setDeckBCueEnabled(!mixer?.deckBCueEnabled);
}

/**
 * Set CUE/MIX blend for headphones
 * 0 = only CUE (pre-fader deck audio)
 * 0.5 = both (default)
 * 1 = only MIX (main program audio)
 */
export function setCueMixBlend(blend: number) {
  if (!cueBus) {
    console.warn("[DjActions] CueBus not initialized");
    return;
  }
  cueBus.setCueMixBlend(blend);
  updateMixer((draft) => {
    draft.cueBlend = blend;
  });
}

/**
 * Cleanup CueBus resources
 */
export function cleanupCueBus() {
  if (cueBus) {
    cueBus.cleanup();
    cueBus = null;
  }
}
