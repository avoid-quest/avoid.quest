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
  type AudioManager,
  createAudioEngineFacade,
  type Radio,
} from "@/lib/audio";
import { validatePlaybackStreamUrl } from "@/lib/audio/playback/url-validation";
import {
  createAndAddChannelEffect,
  removeChannelEffect,
  reorderChannelEffects,
  setChannelEffectsDryWet,
  setChannelFilterValue,
  setChannelMuted,
  setChannelPan,
  setChannelSpeed,
  updateChannelEffect,
  updateChannelFilter,
} from "@/lib/channel-state-manager";
import {
  clearDjErrorSurface,
  reportDjErrorSurface,
} from "@/lib/dj/dj-error-surface";
import {
  applyStoredChannelStrip,
  applyStoredEffectsAndFilters,
} from "@/lib/dj-actions-channel-strip.js";
import {
  createDjDeckLoadWorkflow,
  type DeckLoadDependencies,
  type DjDeckLoadWorkflow,
} from "@/lib/dj-actions-deck-load.js";
import {
  type DeckId,
  type DeckSide,
  deckConfig,
} from "@/lib/dj-actions-decks.js";
import { setDeckLocalFileSource } from "@/lib/dj-actions-input-sources.js";
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
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "@/lib/playback-action-context";
import {
  getDeckARuntime,
  getDeckBRuntime,
} from "@/lib/stores/dj-runtime-store";
import { generateId } from "@/lib/types";

const getAudioManager = (): AudioManager => {
  if (typeof window === "undefined") {
    throw new Error("AudioManager can only be used in browser environment");
  }
  return getDefaultPlaybackActionContext().audio;
};

const getAudioEngine = () => createAudioEngineFacade(getAudioManager());

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
export function applyCrossfade(ctx = getDefaultPlaybackActionContext()) {
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

  if (runtimeA.soundId) {
    ctx.audioEngine.volume.setChannelVolume(runtimeA.soundId, leftFinalVol);
  }
  if (runtimeB.soundId) {
    ctx.audioEngine.volume.setChannelVolume(runtimeB.soundId, rightFinalVol);
  }
}

function createDeckLoadDependencies(
  ctx: PlaybackActionContext
): DeckLoadDependencies {
  return {
    activateChannel: ctx.channels.activate,
    applyCrossfade: () => applyCrossfade(ctx),
    applyStoredChannelStrip,
    applyStoredEffectsAndFilters,
    clearDjError: clearDjErrorSurface,
    connectDeckCueBus,
    deactivateChannel: ctx.channels.deactivate,
    getAudioManager: () => ctx.audio,
    getDeviceChannelCount: (soundId) =>
      ctx.audio.getDeviceSource(soundId)?.channelCount ?? null,
    getSoundId,
    initializeAudioDevices: initializeSavedAudioDevices,
    loadTrack: (deckSide, nextRadio, autoPlay) =>
      loadTrack(deckSide, nextRadio, autoPlay, ctx),
    pauseDeckSound: (soundId) => ctx.audioEngine.playback.pause(soundId),
    playDeckSound: (soundId, volume) =>
      ctx.audioEngine.playback.play(soundId, volume),
    playDeviceSound: (soundId, deviceId) =>
      ctx.audio.playDeviceSound(soundId, deviceId),
    reportDjError: reportDjErrorSurface,
    reportPlaybackError: ctx.reportError,
    resolvePlatformStreamUrl: ({ videoId }) => resolveStreamUrl(videoId),
    seekDeckSound: (soundId, position) =>
      ctx.audioEngine.playback.seek(soundId, position),
    setDeviceChannelSelection: (soundId, selection) =>
      ctx.audio.setDeviceChannelSelection(soundId, selection),
    addDeckEffect: (deckId, type, effectId) =>
      createAndAddChannelEffect("dj", deckId, type, effectId),
    createEffectId: generateId,
    removeDeckEffect: (deckId, effectId) =>
      removeChannelEffect("dj", deckId, effectId),
    reorderDeckEffects: (deckId, effectIds) =>
      reorderChannelEffects("dj", deckId, effectIds),
    setDeckChannelFilter: (deckId, value) =>
      setChannelFilterValue("dj", deckId, value),
    setDeckEffectsDryWet: (deckId, value) =>
      setChannelEffectsDryWet("dj", deckId, value),
    setDeckMute: (deckId, muted) => setChannelMuted("dj", deckId, muted),
    setDeckPan: (deckId, pan) => setChannelPan("dj", deckId, pan),
    setDeckSpeed: (deckId, speed) => setChannelSpeed("dj", deckId, speed),
    setDeckVolume: (deckId, volume) =>
      ctx.channels.setVolume("dj", deckId, volume),
    updateDeckEffect: (deckId, effectId, effectConfig) =>
      updateChannelEffect("dj", deckId, effectId, effectConfig),
    updateDeckFilter: (deckId, filter) =>
      updateChannelFilter("dj", deckId, filter),
  };
}

function createDeckLoadWorkflow(
  ctx: PlaybackActionContext
): DjDeckLoadWorkflow {
  return createDjDeckLoadWorkflow(createDeckLoadDependencies(ctx));
}

async function setDeckRadio(
  deckId: DeckId,
  radio: Radio | null,
  ctx = getDefaultPlaybackActionContext()
) {
  await createDeckLoadWorkflow(ctx).loadDeckRadio(deckId, radio);
}

const bindDeckAction = <Args extends unknown[], Result>(
  deckId: DeckId,
  action: (deckId: DeckId, ...args: Args) => Result
) => {
  return (...args: Args): Result => action(deckId, ...args);
};

// Generic play deck function
async function playDeck(
  deckId: DeckId,
  ctx = getDefaultPlaybackActionContext()
) {
  await createDeckLoadWorkflow(ctx).playDeck(deckId);
}

function pauseDeck(deckId: DeckId, ctx = getDefaultPlaybackActionContext()) {
  createDeckLoadWorkflow(ctx).pauseDeck(deckId);
}

// Generic reset deck function
async function resetDeck(
  deckId: DeckId,
  ctx = getDefaultPlaybackActionContext()
) {
  await createDeckLoadWorkflow(ctx).resetDeck(deckId);
}

export function createDjDeckCommands(ctx = getDefaultPlaybackActionContext()) {
  return {
    setDeckARadio: (radio: Radio | null) => setDeckRadio("deck-a", radio, ctx),
    setDeckBRadio: (radio: Radio | null) => setDeckRadio("deck-b", radio, ctx),
    playDeckA: () => playDeck("deck-a", ctx),
    playDeckB: () => playDeck("deck-b", ctx),
    pauseDeckA: () => pauseDeck("deck-a", ctx),
    pauseDeckB: () => pauseDeck("deck-b", ctx),
    resetDeckA: () => resetDeck("deck-a", ctx),
    resetDeckB: () => resetDeck("deck-b", ctx),
    loadTrack: (deckSide: DeckSide, radio: Radio | null, autoPlay = false) =>
      loadTrack(deckSide, radio, autoPlay, ctx),
  };
}

// Cleanup all decks
export async function cleanupAll(ctx = getDefaultPlaybackActionContext()) {
  await Promise.all([
    setDeckRadio("deck-a", null, ctx),
    setDeckRadio("deck-b", null, ctx),
  ]);
}

// Cleanup audio only (keep radio state)
export function cleanupAudioOnly(
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  ctx.channels.deactivate("deck-a");
  ctx.channels.deactivate("deck-b");
  clearDjErrorSurface();
  return Promise.resolve();
}

// Unified track loading
export async function loadTrack(
  deckSide: DeckSide,
  radio: Radio | null,
  autoPlay = false,
  ctx = getDefaultPlaybackActionContext()
) {
  const deckId = deckSide === "left" ? "deck-a" : "deck-b";
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  const setRadio = (nextRadio: Radio | null) =>
    setDeckRadio(deckId, nextRadio, ctx);
  const pause = () => pauseDeck(deckId, ctx);
  const play = () => playDeck(deckId, ctx);

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
export function setCrossfadePosition(
  position: number,
  ctx = getDefaultPlaybackActionContext()
) {
  updateMixer((draft) => {
    draft.crossfadePosition = position;
  });
  applyCrossfade(ctx);
}

export function setMasterVolume(volume: number, ctx?: PlaybackActionContext) {
  updateMixer((draft) => {
    draft.masterVolume = volume;
  });
  const engine = ctx?.audioEngine ?? getAudioEngine();
  engine.volume.setMasterVolume(volume);
}

// Volume actions with audio manager sync
function setDeckVolume(
  deckId: DeckId,
  volume: number,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckVolume(deckId, volume);
}

// Mute actions with audio manager sync
function setDeckMute(
  deckId: DeckId,
  muted: boolean,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckMute(deckId, muted);
}

// Channel strip actions with audio manager sync
function setDeckPan(
  deckId: DeckId,
  pan: number,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckPan(deckId, pan);
}

function setDeckSpeed(
  deckId: DeckId,
  speed: number,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckSpeed(deckId, speed);
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

function seekDeck(
  deckId: DeckId,
  position: number,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).seekDeck(deckId, position);
}

function setDeckChannelFilter(
  deckId: DeckId,
  value: number,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckChannelFilter(deckId, value);
}

function setDeckEffectsDryWet(
  deckId: DeckId,
  value: number,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckEffectsDryWet(deckId, value);
}

// Filter actions with audio manager sync
function updateDeckFilter(
  deckId: DeckId,
  filter: FilterConfig,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).updateDeckFilter(deckId, filter);
}

// Effect actions with audio manager sync
function addDeckEffect(
  deckId: DeckId,
  type: EffectType,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).addDeckEffect(deckId, type);
}

function updateDeckEffect(
  deckId: DeckId,
  effectId: string,
  effectConfig: Partial<EffectConfig>,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).updateDeckEffect(deckId, effectId, effectConfig);
}

function removeDeckEffect(
  deckId: DeckId,
  effectId: string,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).removeDeckEffect(deckId, effectId);
}

function reorderDeckEffects(
  deckId: DeckId,
  effectIds: string[],
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).reorderDeckEffects(deckId, effectIds);
}

async function setDeckDeviceSource(
  deckId: DeckId,
  deviceId: string,
  deviceLabel: string,
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  await createDeckLoadWorkflow(ctx).loadDeckDeviceInput(
    deckId,
    deviceId,
    deviceLabel
  );
}

function setDeckChannelSelection(
  deckId: DeckId,
  selection: ChannelSelection,
  ctx = getDefaultPlaybackActionContext()
): void {
  createDeckLoadWorkflow(ctx).setDeckDeviceChannelSelection(deckId, selection);
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
