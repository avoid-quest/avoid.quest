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
  createDefaultEffectConfig,
  getAudioContext,
  type Radio,
} from "@/lib/audio";
import {
  getAudioSettings,
  getDelaySettings,
} from "@/lib/collections/settings";
import { reportDjErrorSurface } from "@/lib/dj/dj-error-surface";
import { findNextTrack as findNextTrackInPlaylist } from "@/lib/dj-actions-playlist.js";
import { calculateDjCrossfadeVolumes } from "@/lib/dj-crossfade.js";
import {
  createDjDeckEffectChange,
  type DeckId,
  type DeckSide,
  getDjDeckModule,
} from "@/lib/dj-deck.js";
import {
  type DeckLibrarySourceIntent,
  type DeckSourceLoadIntent,
  type DeckSourceLoadResult,
  getDeckLibrarySourceIntent,
} from "@/lib/dj-library-sources.js";
import {
  getDeckA,
  getDeckB,
  getMixer,
  setPendingPlatformItem,
  updateMixer,
} from "@/lib/hooks/use-dj-state";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "@/lib/playback-action-context";
import {
  getOutputRouting,
  type MainOutputRoutingSettings,
  type OutputRoutingSettings,
} from "@/lib/output-routing.js";
import { getSinglePlayback } from "@/lib/single-playback";
import {
  getDeckARuntime,
  getDeckBRuntime,
} from "@/lib/stores/dj-runtime-store";

const getAudioManager = (): AudioManager => {
  if (typeof window === "undefined") {
    throw new Error("AudioManager can only be used in browser environment");
  }
  return getDefaultPlaybackActionContext().audio;
};

const getAudioEngine = () => createAudioEngineFacade(getAudioManager());

export type DeckLibrarySourceLoadResult =
  | DeckSourceLoadResult
  | Extract<DeckLibrarySourceIntent, { type: "pending-platform" }>;

async function applyOutputSettings(
  patch: Partial<OutputRoutingSettings> = {}
) {
  try {
    return await getOutputRouting().applySettings(patch);
  } catch (error) {
    reportDjErrorSurface(
      error instanceof Error ? error.message : "Failed to apply output settings",
      "DJ_OUTPUT_ROUTER_ERROR",
      error
    );
    throw error;
  }
}

async function applyMainOutputSettings(
  patch: Partial<MainOutputRoutingSettings>
) {
  try {
    return await getOutputRouting().applyMainSettings(patch);
  } catch (error) {
    reportDjErrorSurface(
      error instanceof Error ? error.message : "Failed to apply output settings",
      "DJ_OUTPUT_ROUTER_ERROR",
      error
    );
    throw error;
  }
}

export async function applyMainOutputDevice(deviceId: string): Promise<void> {
  await Promise.all([
    applyMainOutputSettings({ mainOutputId: deviceId }),
    getSinglePlayback().reconcileRouting(),
  ]);
  if (!getAudioSettings().cueOutputId) {
    setDeckCueEnabled("deck-a", false);
    setDeckCueEnabled("deck-b", false);
  }
}

export async function applyCueOutputDevice(
  deviceId: string | null
): Promise<void> {
  await applyOutputSettings({ cueOutputId: deviceId });
  if (deviceId === null) {
    setDeckCueEnabled("deck-a", false);
    setDeckCueEnabled("deck-b", false);
  }
}

export async function applyCurrentAudioSettings(): Promise<void> {
  await applyOutputSettings();
}

export function setDeckCueEnabled(deckId: DeckId, enabled: boolean): void {
  getDjDeckModule().deck(deckId).change({ type: "cue", enabled });
}

export function toggleDeckCue(deckId: DeckId): void {
  getDjDeckModule().deck(deckId).change({ type: "cue" });
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

export async function setMainOutputDelay(ms: number): Promise<void> {
  await applyMainOutputSettings({ mainDelayMs: ms });
  await getSinglePlayback().reconcileRouting();
}

export async function setCueOutputDelay(ms: number): Promise<void> {
  await applyOutputSettings({ cueDelayMs: ms });
}

export function getOutputDelays(): {
  mainDelayMs: number;
  cueDelayMs: number;
} {
  return getDelaySettings();
}

export function initializeOutputDelays(): void {
  const { mainDelayMs, cueDelayMs } = getDelaySettings();
  applyOutputSettings({ cueDelayMs, mainDelayMs }).catch(() => undefined);
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
    await applyMainOutputSettings({ mainDelayMs: latency });
    await getSinglePlayback().reconcileRouting();
  }
  return latency;
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

export async function setDeckRadio(
  deckId: DeckId,
  radio: Radio | null,
  ctx = getDefaultPlaybackActionContext()
) {
  await getDjDeckModule(ctx).deck(deckId).load({
    type: "radio",
    radio,
  });
}

export async function loadDeckLibrarySource(
  deckId: DeckId,
  radio: Radio,
  ctx = getDefaultPlaybackActionContext()
): Promise<DeckLibrarySourceLoadResult> {
  return (await getDjDeckModule(ctx)
    .deck(deckId)
    .load({ type: "library", radio })) as DeckLibrarySourceLoadResult;
}

export function clearDeckLibrarySourcePending(): void {
  setPendingPlatformItem(null);
}

export type DjDeckActions = {
  loadLibrarySource: (radio: Radio) => Promise<DeckLibrarySourceLoadResult>;
  loadSource: (source: DeckSourceLoadIntent) => Promise<DeckSourceLoadResult>;
  setRadio: (radio: Radio | null) => Promise<void>;
  play: () => Promise<void>;
  togglePlayback: () => Promise<void>;
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
  await getDjDeckModule(ctx).deck(deckId).transport({ type: "play" });
}

export function pauseDeck(
  deckId: DeckId,
  ctx = getDefaultPlaybackActionContext()
) {
  return getDjDeckModule(ctx).deck(deckId).transport({ type: "pause" });
}

export async function toggleDeckPlayback(
  deckId: DeckId,
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  await getDjDeckModule(ctx).deck(deckId).transport({ type: "toggle" });
}

// Generic reset deck function
export async function resetDeck(
  deckId: DeckId,
  ctx = getDefaultPlaybackActionContext()
) {
  await getDjDeckModule(ctx).deck(deckId).transport({ type: "reset" });
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
    loadSource: async (source) =>
      (await getDjDeckModule(getContext())
        .deck(deckId)
        .load(source)) as DeckSourceLoadResult,
    play: () => playDeck(deckId, getContext()),
    togglePlayback: () => toggleDeckPlayback(deckId, getContext()),
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

// Unified track loading
export async function loadTrack(
  deckSide: DeckSide,
  radio: Radio | null,
  autoPlay = false,
  ctx = getDefaultPlaybackActionContext()
) {
  const deckId = deckSide === "left" ? "deck-a" : "deck-b";
  await getDjDeckModule(ctx).deck(deckId).load({
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
  getDjDeckModule(ctx).deck(deckId).change({ type: "volume", volume });
}

// Mute actions with audio manager sync
export function setDeckMute(
  deckId: DeckId,
  muted: boolean,
  ctx = getDefaultPlaybackActionContext()
) {
  getDjDeckModule(ctx).deck(deckId).change({ type: "mute", muted });
}

// Channel strip actions with audio manager sync
export function setDeckPan(
  deckId: DeckId,
  pan: number,
  ctx = getDefaultPlaybackActionContext()
) {
  getDjDeckModule(ctx).deck(deckId).change({ type: "pan", pan });
}

export function setDeckSpeed(
  deckId: DeckId,
  speed: number,
  ctx = getDefaultPlaybackActionContext()
) {
  getDjDeckModule(ctx).deck(deckId).change({ type: "speed", speed });
}

export function setDeckRepeat(
  deckId: DeckId,
  enabled: boolean,
  ctx = getDefaultPlaybackActionContext()
) {
  getDjDeckModule(ctx).deck(deckId).change({ type: "repeat", enabled });
}

export function setDeckAutoplay(
  deckId: DeckId,
  enabled: boolean,
  ctx = getDefaultPlaybackActionContext()
) {
  getDjDeckModule(ctx).deck(deckId).change({ type: "autoplay", enabled });
}

export function seekDeck(
  deckId: DeckId,
  position: number,
  ctx = getDefaultPlaybackActionContext()
) {
  return getDjDeckModule(ctx)
    .deck(deckId)
    .transport({ type: "seek", position });
}

export function setDeckChannelFilter(
  deckId: DeckId,
  value: number,
  ctx = getDefaultPlaybackActionContext()
) {
  getDjDeckModule(ctx).deck(deckId).change({ type: "channel-filter", value });
}

export function setDeckEffectsDryWet(
  deckId: DeckId,
  value: number,
  ctx = getDefaultPlaybackActionContext()
) {
  getDjDeckModule(ctx).deck(deckId).change({ type: "effects-dry-wet", value });
}

// Filter actions with audio manager sync
export function updateDeckFilter(
  deckId: DeckId,
  filter: FilterConfig,
  ctx = getDefaultPlaybackActionContext()
) {
  getDjDeckModule(ctx).deck(deckId).change({ type: "filter", filter });
}

// Effect actions with audio manager sync
export function addDeckEffect(
  deckId: DeckId,
  type: EffectType,
  ctx = getDefaultPlaybackActionContext()
) {
  getDjDeckModule(ctx).deck(deckId).change(createDjDeckEffectChange(type));
}

export function updateDeckEffect(
  deckId: DeckId,
  effectId: string,
  effectConfig: Partial<EffectConfig>,
  ctx = getDefaultPlaybackActionContext()
) {
  getDjDeckModule(ctx)
    .deck(deckId)
    .change({
      type: "effect",
      change: { type: "update", effectId, patch: effectConfig },
    });
}

export function removeDeckEffect(
  deckId: DeckId,
  effectId: string,
  ctx = getDefaultPlaybackActionContext()
) {
  getDjDeckModule(ctx)
    .deck(deckId)
    .change({
      type: "effect",
      change: { type: "remove", effectId },
    });
}

export function reorderDeckEffects(
  deckId: DeckId,
  effectIds: string[],
  ctx = getDefaultPlaybackActionContext()
) {
  getDjDeckModule(ctx)
    .deck(deckId)
    .change({
      type: "effect",
      change: { type: "reorder", effectIds },
    });
}

export async function setDeckDeviceSource(
  deckId: DeckId,
  deviceId: string,
  deviceLabel: string,
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  await getDjDeckModule(ctx).deck(deckId).load({
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
  getDjDeckModule(ctx)
    .deck(deckId)
    .change({ type: "device-channel-selection", selection });
}

export async function setDeckFileSource(
  deckId: DeckId,
  file: File,
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  await getDjDeckModule(ctx).deck(deckId).load({
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
