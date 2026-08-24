/**
 * DJ Audio Actions Module
 *
 * This module provides audio-related actions for the DJ player.
 * It uses TanStack DB collections for persisted state and
 * TanStack Store for runtime state.
 */

import type {
  ChannelSelection,
  EffectConfig,
  EffectType,
  FilterConfig,
} from "@/lib/audio";
import {
  type AudioManager,
  createAudioEngineFacade,
  getAudioContext,
  type Radio,
} from "@/lib/audio";
import {
  createAndAddChannelEffect,
  removeChannelEffect,
  reorderChannelEffects,
  setChannelEffectsDryWet,
  setChannelFilterValue,
  updateChannelEffect,
  updateChannelFilter,
} from "@/lib/channel-state-manager";
import { getAudioSettings, getDelaySettings } from "@/lib/collections";
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
import type { DeckId, DeckSide } from "@/lib/dj-actions-decks.js";
import { findNextTrack as findNextTrackInPlaylist } from "@/lib/dj-actions-playlist.js";
import { calculateDjCrossfadeVolumes } from "@/lib/dj-crossfade.js";
import {
  type DeckLibrarySourceIntent,
  type DeckSourceLoadIntent,
  type DeckSourceLoadResult,
  getDeckLibrarySourceIntent,
} from "@/lib/dj-library-sources.js";
import { createDjOutputDeviceActions } from "@/lib/dj-output-device-actions.js";
import { resolveDjPlatformStreamUrl } from "@/lib/dj-platform-stream-port.js";
import {
  getDeckA,
  getDeckB,
  getMixer,
  setPendingPlatformItem,
  updateMixer,
} from "@/lib/hooks/use-dj-state";
import { createManagedPlaybackSessionWorkflow } from "@/lib/managed-playback-session-workflow";
import {
  type CueDeckRegistration,
  getOutputRouting,
} from "@/lib/output-routing.js";
import { loadPlatformItem } from "@/lib/platform-item-loader";
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

export type DeckLibrarySourceLoadResult =
  | DeckSourceLoadResult
  | Extract<DeckLibrarySourceIntent, { type: "pending-platform" }>;

const deckCueRegistrations = new Map<DeckId, CueDeckRegistration>();
let cueBusInitialized = false;
let outputSettingsInitialized = false;
let outputErrorCleanup: (() => void) | null = null;

function subscribeToOutputErrors(): void {
  outputErrorCleanup?.();
  outputErrorCleanup = getOutputRouting().subscribeErrors((error) => {
    reportDjErrorSurface(error.message, "DJ_OUTPUT_ROUTER_ERROR", error);
  });
}

export function getCueBus() {
  if (typeof window === "undefined") {
    throw new Error("Output routing can only be used in browser environment");
  }
  const routing = getOutputRouting();
  if (!cueBusInitialized) {
    const headphoneVolume = getMixer()?.headphoneVolume;
    if (headphoneVolume !== undefined) {
      routing.setHeadphoneVolume(headphoneVolume);
    }
    cueBusInitialized = true;
  }
  return routing;
}

export function isCueBusInitialized(): boolean {
  return cueBusInitialized;
}

function disableCueDecks(): void {
  for (const [deckId, registration] of deckCueRegistrations) {
    registration.setEnabled(false);
    updateDeckCueState(deckId, false);
  }
}

function getOutputDeviceActions() {
  return createDjOutputDeviceActions({
    disableCueDecks,
    reconcileSingleRouting: () =>
      createManagedPlaybackSessionWorkflow("single").reconcileRouting(),
    routing: getOutputRouting(),
  });
}

export async function applyMainOutputDevice(deviceId: string): Promise<void> {
  subscribeToOutputErrors();
  await getOutputDeviceActions().applyMainOutputDevice(deviceId);
}

export async function applyCueOutputDevice(
  deviceId: string | null
): Promise<void> {
  await getOutputDeviceActions().applyCueOutputDevice(deviceId);
}

export async function applyCurrentAudioSettings(): Promise<void> {
  subscribeToOutputErrors();
  await getOutputRouting().applySettings();
}

function updateDeckCueState(deckId: DeckId, enabled: boolean): void {
  updateMixer((draft) => {
    if (deckId === "deck-a") {
      draft.deckACueEnabled = enabled;
    } else {
      draft.deckBCueEnabled = enabled;
    }
  });
}

export function setDeckCueEnabled(deckId: DeckId, enabled: boolean): void {
  const existing = deckCueRegistrations.get(deckId);
  if (existing) {
    existing.setEnabled(enabled);
  } else {
    deckCueRegistrations.set(
      deckId,
      getOutputRouting().registerCueDeck(deckId, null, enabled)
    );
  }
  updateDeckCueState(deckId, enabled);
}

export function toggleDeckCue(deckId: DeckId): void {
  if (!getAudioSettings().cueOutputId) {
    return;
  }
  const mixer = getMixer();
  if (!mixer) {
    return;
  }
  setDeckCueEnabled(
    deckId,
    deckId === "deck-a" ? !mixer.deckACueEnabled : !mixer.deckBCueEnabled
  );
}

export function toggleDeckACue(): void {
  toggleDeckCue("deck-a");
}

export function toggleDeckBCue(): void {
  toggleDeckCue("deck-b");
}

export function setHeadphoneVolume(volume: number): void {
  const clampedVolume = Math.max(0, Math.min(1, volume));
  getOutputRouting().setHeadphoneVolume(clampedVolume);
  updateMixer((draft) => {
    draft.headphoneVolume = clampedVolume;
  });
}

export function cleanupCueBus(): void {
  for (const registration of deckCueRegistrations.values()) {
    registration.cleanup();
  }
  deckCueRegistrations.clear();
  getOutputRouting().releaseCue();
  outputErrorCleanup?.();
  outputErrorCleanup = null;
  outputSettingsInitialized = false;
  cueBusInitialized = false;
}

export async function setMainOutputDelay(ms: number): Promise<void> {
  await getOutputRouting().applyMainSettings({ mainDelayMs: ms });
  await createManagedPlaybackSessionWorkflow("single").reconcileRouting();
}

export async function setCueOutputDelay(ms: number): Promise<void> {
  await getOutputRouting().applySettings({ cueDelayMs: ms });
}

export function getOutputDelays(): {
  mainDelayMs: number;
  cueDelayMs: number;
} {
  return getDelaySettings();
}

export function initializeOutputDelays(): void {
  const { mainDelayMs, cueDelayMs } = getDelaySettings();
  getOutputRouting()
    .applySettings({ cueDelayMs, mainDelayMs })
    .catch(() => undefined);
}

export function detectSystemLatency(): number | null {
  const context = getAudioContext();
  const latencyMs = Math.round(
    ((context.outputLatency ?? 0) + (context.baseLatency ?? 0)) * 1000
  );
  return latencyMs === 0 ? null : latencyMs;
}

export async function autoCompensateLatency(): Promise<number | null> {
  const latency = detectSystemLatency();
  if (latency !== null) {
    await getOutputRouting().applyMainSettings({ mainDelayMs: latency });
    await createManagedPlaybackSessionWorkflow("single").reconcileRouting();
  }
  return latency;
}

async function initializeSavedAudioDevices(): Promise<void> {
  if (outputSettingsInitialized) {
    return;
  }
  await applyCurrentAudioSettings();
  outputSettingsInitialized = true;
}

function connectDeckCueBus(
  deckId: DeckId,
  soundId: string,
  getManager: () => AudioManager
): void {
  const tap = getManager().getPreFaderNode(soundId);
  if (!tap) {
    return;
  }
  const mixer = getMixer();
  const enabled =
    deckId === "deck-a"
      ? (mixer?.deckACueEnabled ?? false)
      : (mixer?.deckBCueEnabled ?? false);
  const existing = deckCueRegistrations.get(deckId);
  if (existing) {
    existing.replaceTap(tap);
    existing.setEnabled(enabled);
    return;
  }
  getCueBus();
  deckCueRegistrations.set(
    deckId,
    getOutputRouting().registerCueDeck(deckId, tap, enabled)
  );
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

  const [leftFinalVol, rightFinalVol] = calculateDjCrossfadeVolumes(
    crossfadePosition,
    deckA.volume,
    deckB.volume
  );

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
    loadPlatformItem,
    loadTrack: (deckSide, nextRadio, autoPlay) =>
      loadTrack(deckSide, nextRadio, autoPlay, ctx),
    pauseDeckSound: (soundId) => ctx.audioEngine.playback.pause(soundId),
    playDeckSound: (soundId, volume) =>
      ctx.audioEngine.playback.play(soundId, volume),
    resumeAudioContext: ctx.resumeAudioContext,
    playDeviceSound: (soundId, deviceId) =>
      ctx.audio.playDeviceSound(soundId, deviceId),
    reportDjError: reportDjErrorSurface,
    reportPlaybackError: ctx.reportError,
    resolvePlatformStreamUrl:
      ctx.platformStreams?.resolveStreamUrl ?? resolveDjPlatformStreamUrl,
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
    setDeckMute: (deckId, muted) => ctx.channels.setMuted("dj", deckId, muted),
    setDeckPan: (deckId, pan) => ctx.channels.setPan("dj", deckId, pan),
    setDeckSpeed: (deckId, speed) => ctx.channels.setSpeed("dj", deckId, speed),
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

export async function setDeckRadio(
  deckId: DeckId,
  radio: Radio | null,
  ctx = getDefaultPlaybackActionContext()
) {
  await createDeckLoadWorkflow(ctx).loadDeckSource(deckId, {
    type: "radio",
    radio,
  });
}

export async function loadDeckLibrarySource(
  deckId: DeckId,
  radio: Radio,
  ctx = getDefaultPlaybackActionContext()
): Promise<DeckLibrarySourceLoadResult> {
  const intent = getDeckLibrarySourceIntent(radio);
  if (intent.type === "pending-platform") {
    setPendingPlatformItem({ deckId, platform: intent.platform });
    return intent;
  }

  setPendingPlatformItem(null);
  return await createDeckLoadWorkflow(ctx).loadDeckSource(
    deckId,
    intent.source
  );
}

export function clearDeckLibrarySourcePending(): void {
  setPendingPlatformItem(null);
}

const bindDeckAction =
  <Args extends unknown[], Result>(
    deckId: DeckId,
    action: (deckId: DeckId, ...args: Args) => Result
  ) =>
  (...args: Args): Result =>
    action(deckId, ...args);

export type DjDeckActions = {
  loadLibrarySource: (radio: Radio) => Promise<DeckLibrarySourceLoadResult>;
  loadSource: (source: DeckSourceLoadIntent) => Promise<DeckSourceLoadResult>;
  setRadio: (radio: Radio | null) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  reset: () => Promise<void>;
  setVolume: (volume: number) => void;
  setMute: (muted: boolean) => void;
  setPan: (pan: number) => void;
  setSpeed: (speed: number) => void;
  setRepeat: (enabled: boolean) => void;
  setAutoplay: (enabled: boolean) => void;
  seek: (position: number) => void;
  setChannelFilter: (value: number) => void;
  setEffectsDryWet: (value: number) => void;
  updateFilter: (filter: FilterConfig) => void;
  addEffect: (type: EffectType) => void;
  updateEffect: (effectId: string, effectConfig: Partial<EffectConfig>) => void;
  removeEffect: (effectId: string) => void;
  reorderEffects: (effectIds: string[]) => void;
  setCueEnabled: (enabled: boolean) => void;
  toggleCue: () => void;
  setDeviceSource: (deviceId: string, deviceLabel: string) => Promise<void>;
  setChannelSelection: (selection: ChannelSelection) => void;
  setFileSource: (file: File) => Promise<void>;
};

export type DjDeckCommandMap = Record<DeckId, DjDeckActions>;

// Generic play deck function
export async function playDeck(
  deckId: DeckId,
  ctx = getDefaultPlaybackActionContext()
) {
  await createDeckLoadWorkflow(ctx).playDeck(deckId);
}

export function pauseDeck(
  deckId: DeckId,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).pauseDeck(deckId);
}

// Generic reset deck function
export async function resetDeck(
  deckId: DeckId,
  ctx = getDefaultPlaybackActionContext()
) {
  await createDeckLoadWorkflow(ctx).resetDeck(deckId);
}

function createDeckActions(
  deckId: DeckId,
  ctx?: PlaybackActionContext
): DjDeckActions {
  const getContext = () => ctx ?? getDefaultPlaybackActionContext();
  return {
    setRadio: (radio) => setDeckRadio(deckId, radio, getContext()),
    loadLibrarySource: (radio) =>
      loadDeckLibrarySource(deckId, radio, getContext()),
    loadSource: (source) =>
      createDeckLoadWorkflow(getContext()).loadDeckSource(deckId, source),
    play: () => playDeck(deckId, getContext()),
    pause: () => pauseDeck(deckId, getContext()),
    reset: () => resetDeck(deckId, getContext()),
    setVolume: (volume) => setDeckVolume(deckId, volume, getContext()),
    setMute: (muted) => setDeckMute(deckId, muted, getContext()),
    setPan: (pan) => setDeckPan(deckId, pan, getContext()),
    setSpeed: (speed) => setDeckSpeed(deckId, speed, getContext()),
    setRepeat: (enabled) => setDeckRepeat(deckId, enabled, getContext()),
    setAutoplay: (enabled) => setDeckAutoplay(deckId, enabled, getContext()),
    seek: (position) => seekDeck(deckId, position, getContext()),
    setChannelFilter: (value) =>
      setDeckChannelFilter(deckId, value, getContext()),
    setEffectsDryWet: (value) =>
      setDeckEffectsDryWet(deckId, value, getContext()),
    updateFilter: (filter) => updateDeckFilter(deckId, filter, getContext()),
    addEffect: (type) => addDeckEffect(deckId, type, getContext()),
    updateEffect: (effectId, effectConfig) =>
      updateDeckEffect(deckId, effectId, effectConfig, getContext()),
    removeEffect: (effectId) =>
      removeDeckEffect(deckId, effectId, getContext()),
    reorderEffects: (effectIds) =>
      reorderDeckEffects(deckId, effectIds, getContext()),
    setCueEnabled: (enabled) => setDeckCueEnabled(deckId, enabled),
    toggleCue: () => toggleDeckCue(deckId),
    setDeviceSource: (deviceId, deviceLabel) =>
      setDeckDeviceSource(deckId, deviceId, deviceLabel, getContext()),
    setChannelSelection: (selection) =>
      setDeckChannelSelection(deckId, selection, getContext()),
    setFileSource: (file) => setDeckFileSource(deckId, file, getContext()),
  };
}

export function createDjDeckCommandMap(
  ctx?: PlaybackActionContext
): DjDeckCommandMap {
  return {
    "deck-a": createDeckActions("deck-a", ctx),
    "deck-b": createDeckActions("deck-b", ctx),
  };
}

const defaultDjDeckActions = createDjDeckCommandMap();

export function getDjDeckActions(deckId: DeckId): DjDeckActions {
  return defaultDjDeckActions[deckId];
}

export function createDjDeckCommands(ctx = getDefaultPlaybackActionContext()) {
  const deckCommands = createDjDeckCommandMap(ctx);
  const deckA = deckCommands["deck-a"];
  const deckB = deckCommands["deck-b"];
  return {
    ...deckCommands,
    /** @deprecated Prefer commands["deck-a"].setRadio. */
    setDeckARadio: deckA.setRadio,
    /** @deprecated Prefer commands["deck-b"].setRadio. */
    setDeckBRadio: deckB.setRadio,
    /** @deprecated Prefer commands["deck-a"].play. */
    playDeckA: deckA.play,
    /** @deprecated Prefer commands["deck-b"].play. */
    playDeckB: deckB.play,
    /** @deprecated Prefer commands["deck-a"].pause. */
    pauseDeckA: deckA.pause,
    /** @deprecated Prefer commands["deck-b"].pause. */
    pauseDeckB: deckB.pause,
    /** @deprecated Prefer commands["deck-a"].reset. */
    resetDeckA: deckA.reset,
    /** @deprecated Prefer commands["deck-b"].reset. */
    resetDeckB: deckB.reset,
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
  await createDeckLoadWorkflow(ctx).loadDeckSource(deckId, {
    type: "track",
    radio,
    autoPlay,
  });
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
export function setDeckVolume(
  deckId: DeckId,
  volume: number,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckVolume(deckId, volume);
}

// Mute actions with audio manager sync
export function setDeckMute(
  deckId: DeckId,
  muted: boolean,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckMute(deckId, muted);
}

// Channel strip actions with audio manager sync
export function setDeckPan(
  deckId: DeckId,
  pan: number,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckPan(deckId, pan);
}

export function setDeckSpeed(
  deckId: DeckId,
  speed: number,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckSpeed(deckId, speed);
}

export function setDeckRepeat(
  deckId: DeckId,
  enabled: boolean,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckRepeat(deckId, enabled);
}

export function setDeckAutoplay(
  deckId: DeckId,
  enabled: boolean,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckAutoplay(deckId, enabled);
}

export function seekDeck(
  deckId: DeckId,
  position: number,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).seekDeck(deckId, position);
}

export function setDeckChannelFilter(
  deckId: DeckId,
  value: number,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckChannelFilter(deckId, value);
}

export function setDeckEffectsDryWet(
  deckId: DeckId,
  value: number,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).setDeckEffectsDryWet(deckId, value);
}

// Filter actions with audio manager sync
export function updateDeckFilter(
  deckId: DeckId,
  filter: FilterConfig,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).updateDeckFilter(deckId, filter);
}

// Effect actions with audio manager sync
export function addDeckEffect(
  deckId: DeckId,
  type: EffectType,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).addDeckEffect(deckId, type);
}

export function updateDeckEffect(
  deckId: DeckId,
  effectId: string,
  effectConfig: Partial<EffectConfig>,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).updateDeckEffect(deckId, effectId, effectConfig);
}

export function removeDeckEffect(
  deckId: DeckId,
  effectId: string,
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).removeDeckEffect(deckId, effectId);
}

export function reorderDeckEffects(
  deckId: DeckId,
  effectIds: string[],
  ctx = getDefaultPlaybackActionContext()
) {
  createDeckLoadWorkflow(ctx).reorderDeckEffects(deckId, effectIds);
}

export async function setDeckDeviceSource(
  deckId: DeckId,
  deviceId: string,
  deviceLabel: string,
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  await createDeckLoadWorkflow(ctx).loadDeckSource(deckId, {
    type: "device-input",
    deviceId,
    deviceLabel,
  });
}

export function setDeckChannelSelection(
  deckId: DeckId,
  selection: ChannelSelection,
  ctx = getDefaultPlaybackActionContext()
): void {
  createDeckLoadWorkflow(ctx).setDeckDeviceChannelSelection(deckId, selection);
}

export async function setDeckFileSource(
  deckId: DeckId,
  file: File,
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  await createDeckLoadWorkflow(ctx).loadDeckSource(deckId, {
    type: "file",
    file,
  });
}

export function getDeckLibrarySourceLoadIntent(
  radio: Radio
): DeckLibrarySourceIntent {
  return getDeckLibrarySourceIntent(radio);
}

export type {
  DeckLibrarySourceIntent,
  DeckSourceLoadIntent,
  DeckSourceLoadResult,
} from "@/lib/dj-library-sources.js";

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
