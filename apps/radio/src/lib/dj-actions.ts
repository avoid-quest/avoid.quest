/**
 * DJ Audio Actions Module
 *
 * This module provides audio-related actions for the DJ player.
 * It uses TanStack DB collections for persisted state and
 * TanStack Store for runtime state.
 */

import type { EffectConfig } from "@/lib/audio";
import {
  type AudioManager,
  createAudioEngineFacade,
  getAudioContext,
} from "@/lib/audio";
import { reportDjErrorSurface } from "@/lib/dj/dj-error-surface";
import { calculateDjCrossfadeVolumes } from "@/lib/dj-crossfade.js";
import { type DeckId, getDjDeckModule } from "@/lib/dj-deck.js";
import { createDjOutputDeviceActions } from "@/lib/dj-output-device-actions.js";
import {
  getDeckA,
  getDeckB,
  getMixer,
  updateMixer,
} from "@/lib/hooks/use-dj-state";
import {
  getOutputRouting,
  type MainOutputRoutingSettings,
  type OutputRoutingSettings,
} from "@/lib/output-routing.js";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "@/lib/playback-action-context";
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

async function applyOutputSettings(patch: Partial<OutputRoutingSettings> = {}) {
  try {
    return await getOutputRouting().applySettings(patch);
  } catch (error) {
    reportDjErrorSurface(
      error instanceof Error
        ? error.message
        : "Failed to apply output settings",
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
      error instanceof Error
        ? error.message
        : "Failed to apply output settings",
      "DJ_OUTPUT_ROUTER_ERROR",
      error
    );
    throw error;
  }
}

function getOutputDeviceActions() {
  return createDjOutputDeviceActions({
    disableCueDecks: () => {
      setDeckCueEnabled("deck-a", false);
      setDeckCueEnabled("deck-b", false);
    },
    reconcileSingleRouting: () => getSinglePlayback().reconcileRouting(),
    routing: {
      applyMainSettings: applyMainOutputSettings,
      applySettings: applyOutputSettings,
    },
  });
}

export async function applyMainOutputDevice(deviceId: string): Promise<void> {
  await getOutputDeviceActions().applyMainOutputDevice(deviceId);
}

export async function applyCueOutputDevice(
  deviceId: string | null
): Promise<void> {
  await getOutputDeviceActions().applyCueOutputDevice(deviceId);
}

function setDeckCueEnabled(deckId: DeckId, enabled: boolean): void {
  getDjDeckModule().deck(deckId).change({ type: "cue", enabled });
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

function detectSystemLatency(): number | null {
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

// Apply crossfade based on current mixer position
function applyCrossfade(ctx = getDefaultPlaybackActionContext()) {
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

type MidiDjDeckActions = {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  setVolume: (volume: number) => void;
  setPan: (pan: number) => void;
  setSpeed: (speed: number) => void;
  setChannelFilter: (value: number) => void;
  setEffectsDryWet: (value: number) => void;
  updateEffect: (effectId: string, effectConfig: Partial<EffectConfig>) => void;
  toggleCue: () => void;
};

function createMidiDeckActions(deckId: DeckId): MidiDjDeckActions {
  const deck = () => getDjDeckModule().deck(deckId);
  return {
    play: () => deck().transport({ type: "play" }),
    pause: () => deck().transport({ type: "pause" }),
    setVolume: (volume) => deck().change({ type: "volume", volume }),
    setPan: (pan) => deck().change({ type: "pan", pan }),
    setSpeed: (speed) => deck().change({ type: "speed", speed }),
    setChannelFilter: (value) =>
      deck().change({ type: "channel-filter", value }),
    setEffectsDryWet: (value) =>
      deck().change({ type: "effects-dry-wet", value }),
    updateEffect: (effectId, effectConfig) =>
      deck().change({
        type: "effect",
        change: { type: "update", effectId, patch: effectConfig },
      }),
    toggleCue: () => deck().change({ type: "cue" }),
  };
}

const midiDeckActions: Record<DeckId, MidiDjDeckActions> = {
  "deck-a": createMidiDeckActions("deck-a"),
  "deck-b": createMidiDeckActions("deck-b"),
};

export function getDjDeckActions(deckId: DeckId): MidiDjDeckActions {
  return midiDeckActions[deckId];
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
