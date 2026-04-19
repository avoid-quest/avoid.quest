/**
 * DJ Audio Actions Module
 *
 * This module provides audio-related actions for the DJ player.
 * It uses TanStack DB collections for persisted state and
 * TanStack Store for runtime state.
 */

import { resolveStreamUrl } from "@avoid.quest/platforms";
import type {
  ChannelSelection,
  EffectConfig,
  EffectType,
  FilterConfig,
} from "@/lib/audio";
import {
  AudioManager,
  createDefaultEffectConfig,
  type Radio,
} from "@/lib/audio";
import { validatePlaybackStreamUrl } from "@/lib/audio/playback/url-validation";
import {
  clearDjErrorSurface,
  reportDjErrorSurface,
} from "@/lib/dj/dj-error-surface";
import {
  applyStoredChannelStrip,
  applyStoredEffectsAndFilters,
} from "@/lib/dj-actions-channel-strip.js";
import { setDeckRadioSource } from "@/lib/dj-actions-deck-load.js";
import {
  type DeckId,
  type DeckSide,
  deckConfig,
  getDeckRadio,
} from "@/lib/dj-actions-decks.js";
import {
  setDeckDeviceChannelSelection,
  setDeckDeviceInputSource,
  setDeckLocalFileSource,
} from "@/lib/dj-actions-input-sources.js";
import { findNextTrack as findNextTrackInPlaylist } from "@/lib/dj-actions-playlist.js";
import {
  setCueOutputDelay as applyCueOutputDelay,
  applyCueOutputDevice as applyCueOutputDeviceSetting,
  setMainOutputDelay as applyMainOutputDelay,
  applyMainOutputDevice as applyMainOutputDeviceSetting,
  applyCurrentAudioSettings as applySavedAudioSettings,
  autoCompensateLatency as autoCompensateOutputLatency,
  cleanupCueBus as cleanupDjCueBus,
  connectDeckToCueBus as connectDeckCueBus,
  detectSystemLatency as detectOutputLatency,
  getOutputDelays as getConfiguredOutputDelays,
  getCueBus as getDjCueBus,
  initializeAudioDevices as initializeSavedAudioDevices,
  initializeOutputDelays as initializeSavedOutputDelays,
  isCueBusInitialized as isDjCueBusInitialized,
  setHeadphoneVolume as setCueHeadphoneVolume,
  setDeckCueEnabled as setDeckCueRoutingEnabled,
  toggleDeckCue as toggleDeckCueRouting,
} from "@/lib/dj-actions-routing.js";
import {
  getDeckA,
  getDeckB,
  getMixer,
  updateMixer,
} from "@/lib/hooks/use-dj-state";
import {
  getDeckARuntime,
  getDeckASubscriptionCleanup,
  getDeckBRuntime,
  getDeckBSubscriptionCleanup,
  resetDeckARuntime,
  resetDeckBRuntime,
} from "@/lib/stores/dj-runtime-store";
import { generateId } from "@/lib/types";

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

export const getCueBus = getDjCueBus;
export const isCueBusInitialized = isDjCueBusInitialized;

export async function applyMainOutputDevice(deviceId: string): Promise<void> {
  await applyMainOutputDeviceSetting(deviceId, reportDjErrorSurface);
}

export async function applyCueOutputDevice(
  deviceId: string | null
): Promise<void> {
  await applyCueOutputDeviceSetting(deviceId);
}

export async function applyCurrentAudioSettings(): Promise<void> {
  await applySavedAudioSettings(getAudioManager, reportDjErrorSurface);
}

const setDeckCueEnabled = setDeckCueRoutingEnabled;

export function toggleDeckACue(): void {
  toggleDeckCueRouting("deck-a");
}

export function toggleDeckBCue(): void {
  toggleDeckCueRouting("deck-b");
}

export function setHeadphoneVolume(volume: number): void {
  setCueHeadphoneVolume(volume);
}

export function cleanupCueBus(): void {
  cleanupDjCueBus();
}

export function setMainOutputDelay(ms: number): void {
  applyMainOutputDelay(ms, getAudioManager);
}

export function setCueOutputDelay(ms: number): void {
  applyCueOutputDelay(ms);
}

export function getOutputDelays(): {
  mainDelayMs: number;
  cueDelayMs: number;
} {
  return getConfiguredOutputDelays();
}

export function initializeOutputDelays(): void {
  initializeSavedOutputDelays(getAudioManager);
}

export function detectSystemLatency(): number | null {
  return detectOutputLatency();
}

export function autoCompensateLatency(): number | null {
  return autoCompensateOutputLatency(getAudioManager);
}

export const findNextTrack = (
  radio: Radio | null
): { streamUrl: string } | null => findNextTrackInPlaylist(radio);

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

  const angle = (crossfadePosition * Math.PI) / 2;
  const leftFinalVol = Math.cos(angle) * deckA.volume;
  const rightFinalVol = Math.sin(angle) * deckB.volume;

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
  await setDeckRadioSource(deckId, radio, {
    applyCrossfade,
    applyStoredChannelStrip,
    applyStoredEffectsAndFilters,
    clearDjError: clearDjErrorSurface,
    connectDeckCueBus,
    getAudioManager,
    getSoundId,
    initializeAudioDevices: initializeSavedAudioDevices,
    loadTrack,
    reportDjError: reportDjErrorSurface,
    resolveStreamUrl,
  });
}

const bindDeckAction = <Args extends unknown[], Result>(
  deckId: DeckId,
  action: (deckId: DeckId, ...args: Args) => Result
) => {
  return (...args: Args): Result => action(deckId, ...args);
};

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
      reportDjErrorSurface(
        err instanceof Error ? err.message : `Failed to play ${deckId}`,
        "DJ_PLAY_DECK_FAILED",
        err,
        deck.radio
      );
    }
  }
}

function pauseDeck(deckId: DeckId) {
  const runtime = deckConfig[deckId].getRuntime();
  if (runtime.soundId) {
    getAudioManager().pauseSound(runtime.soundId);
  }
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
    const radio = getDeckRadio(deck);
    await setDeckRadio(deckId, radio);
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
  clearDjErrorSurface();
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

  const streamValidation = validatePlaybackStreamUrl(radio.streamUrl);
  if (!streamValidation.ok) {
    reportDjErrorSurface("Invalid stream URL", "DJ_INVALID_STREAM_URL");
    return;
  }

  const normalizedRadio =
    streamValidation.normalizedUrl === radio.streamUrl
      ? radio
      : { ...radio, streamUrl: streamValidation.normalizedUrl };

  // Prevent re-entry if already loading
  if (runtime.isLoading) {
    return;
  }

  // Pause current track if playing
  if (runtime.isPlaying) {
    pause();
  }

  // Load new track
  await setRadio(normalizedRadio);

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

function setDeckSpeed(deckId: DeckId, speed: number) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.speed = speed;
  });
  if (runtime.soundId) {
    getAudioManager().setPlaybackRate(runtime.soundId, speed);
  }
}

function setDeckRepeat(deckId: DeckId, enabled: boolean) {
  deckConfig[deckId].updateDeck((draft) => {
    draft.repeat = enabled;
  });
}

function setDeckAutoplay(deckId: DeckId, enabled: boolean) {
  deckConfig[deckId].updateDeck((draft) => {
    draft.autoplay = enabled;
  });
}

function seekDeck(deckId: DeckId, position: number) {
  const runtime = deckConfig[deckId].getRuntime();
  if (runtime.soundId) {
    getAudioManager().seekSound(runtime.soundId, position);
  }
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

function setDeckEffectsDryWet(deckId: DeckId, value: number) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.effectsDryWet = value;
  });
  if (runtime.soundId) {
    getAudioManager().setEffectsDryWet(runtime.soundId, value);
  }
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

// Effect actions with audio manager sync
function addDeckEffect(deckId: DeckId, type: EffectType) {
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  const deck = config.getDeck();
  const effects = deck?.effects ?? [];
  const effect = createDefaultEffectConfig(type, generateId(), effects.length);
  config.updateDeck((draft) => {
    draft.effects.push(effect);
  });
  if (runtime.soundId) {
    getAudioManager().addEffect(runtime.soundId, effect);
  }
}

function updateDeckEffect(
  deckId: DeckId,
  effectId: string,
  effectConfig: Partial<EffectConfig>
) {
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  let effectFound = false;
  config.updateDeck((draft) => {
    const effect = draft.effects.find((e) => e.id === effectId);
    if (effect) {
      Object.assign(effect, effectConfig);
      effectFound = true;
    }
  });
  if (effectFound && runtime.soundId) {
    getAudioManager().updateEffect(runtime.soundId, effectId, effectConfig);
  }
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

function reorderDeckEffects(deckId: DeckId, effectIds: string[]) {
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  const deck = config.getDeck();
  if (!deck) {
    return;
  }
  config.updateDeck((draft) => {
    const reordered = effectIds
      .map((id) => draft.effects.find((e) => e.id === id))
      .filter((e) => e !== undefined);
    draft.effects = reordered;
    for (let i = 0; i < draft.effects.length; i++) {
      draft.effects[i].order = i;
    }
  });
  if (runtime.soundId) {
    getAudioManager().reorderEffects(runtime.soundId, effectIds);
  }
}

async function setDeckDeviceSource(
  deckId: DeckId,
  deviceId: string,
  deviceLabel: string
): Promise<void> {
  await setDeckDeviceInputSource(deckId, deviceId, deviceLabel, {
    applyCrossfade,
    applyStoredChannelStrip,
    applyStoredEffectsAndFilters,
    clearDjError: clearDjErrorSurface,
    connectDeckCueBus,
    getAudioManager,
    initializeAudioDevices: initializeSavedAudioDevices,
    reportDjError: reportDjErrorSurface,
    setDeckRadio,
  });
}

function setDeckChannelSelection(
  deckId: DeckId,
  selection: ChannelSelection
): void {
  setDeckDeviceChannelSelection(deckId, selection, getAudioManager);
}

async function setDeckFileSource(deckId: DeckId, file: File): Promise<void> {
  await setDeckLocalFileSource(
    deckId,
    file,
    clearDjErrorSurface,
    reportDjErrorSurface,
    setDeckRadio
  );
}

export const setDeckARadio = bindDeckAction("deck-a", setDeckRadio);
export const setDeckBRadio = bindDeckAction("deck-b", setDeckRadio);
export const playDeckA = bindDeckAction("deck-a", playDeck);
export const playDeckB = bindDeckAction("deck-b", playDeck);
export const pauseDeckA = bindDeckAction("deck-a", pauseDeck);
export const pauseDeckB = bindDeckAction("deck-b", pauseDeck);
export const resetDeckA = bindDeckAction("deck-a", resetDeck);
export const resetDeckB = bindDeckAction("deck-b", resetDeck);
export const setDeckAVolume = bindDeckAction("deck-a", setDeckVolume);
export const setDeckBVolume = bindDeckAction("deck-b", setDeckVolume);
export const setDeckAMute = bindDeckAction("deck-a", setDeckMute);
export const setDeckBMute = bindDeckAction("deck-b", setDeckMute);
export const setDeckAPan = bindDeckAction("deck-a", setDeckPan);
export const setDeckBPan = bindDeckAction("deck-b", setDeckPan);
export const setDeckASpeed = bindDeckAction("deck-a", setDeckSpeed);
export const setDeckBSpeed = bindDeckAction("deck-b", setDeckSpeed);
export const setDeckARepeat = bindDeckAction("deck-a", setDeckRepeat);
export const setDeckBRepeat = bindDeckAction("deck-b", setDeckRepeat);
export const setDeckAAutoplay = bindDeckAction("deck-a", setDeckAutoplay);
export const setDeckBAutoplay = bindDeckAction("deck-b", setDeckAutoplay);
export const seekDeckA = bindDeckAction("deck-a", seekDeck);
export const seekDeckB = bindDeckAction("deck-b", seekDeck);
export const setDeckAChannelFilter = bindDeckAction(
  "deck-a",
  setDeckChannelFilter
);
export const setDeckBChannelFilter = bindDeckAction(
  "deck-b",
  setDeckChannelFilter
);
export const setDeckAEffectsDryWet = bindDeckAction(
  "deck-a",
  setDeckEffectsDryWet
);
export const setDeckBEffectsDryWet = bindDeckAction(
  "deck-b",
  setDeckEffectsDryWet
);
export const updateDeckAFilter = bindDeckAction("deck-a", updateDeckFilter);
export const updateDeckBFilter = bindDeckAction("deck-b", updateDeckFilter);
export const addDeckAEffect = bindDeckAction("deck-a", addDeckEffect);
export const addDeckBEffect = bindDeckAction("deck-b", addDeckEffect);
export const updateDeckAEffect = bindDeckAction("deck-a", updateDeckEffect);
export const updateDeckBEffect = bindDeckAction("deck-b", updateDeckEffect);
export const removeDeckAEffect = bindDeckAction("deck-a", removeDeckEffect);
export const removeDeckBEffect = bindDeckAction("deck-b", removeDeckEffect);
export const reorderDeckAEffects = bindDeckAction("deck-a", reorderDeckEffects);
export const reorderDeckBEffects = bindDeckAction("deck-b", reorderDeckEffects);
export const setDeckACueEnabled = bindDeckAction("deck-a", setDeckCueEnabled);
export const setDeckBCueEnabled = bindDeckAction("deck-b", setDeckCueEnabled);
export const setDeckADeviceSource = bindDeckAction(
  "deck-a",
  setDeckDeviceSource
);
export const setDeckBDeviceSource = bindDeckAction(
  "deck-b",
  setDeckDeviceSource
);
export const setDeckAChannelSelection = bindDeckAction(
  "deck-a",
  setDeckChannelSelection
);
export const setDeckBChannelSelection = bindDeckAction(
  "deck-b",
  setDeckChannelSelection
);
export const setDeckAFileSource = bindDeckAction("deck-a", setDeckFileSource);
export const setDeckBFileSource = bindDeckAction("deck-b", setDeckFileSource);
