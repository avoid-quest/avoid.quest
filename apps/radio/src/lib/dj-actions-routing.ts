import { type AudioManager, getAudioContext } from "@/lib/audio";
import { getAudioSettings, getDelaySettings } from "@/lib/collections";
import type { DeckId } from "@/lib/dj-actions-decks.js";
import { getMixer, updateMixer } from "@/lib/hooks/use-dj-state";
import {
  type CueDeckRegistration,
  getOutputRouting,
} from "@/lib/output-routing.js";

type ReportDjError = (message: string, code: string, error?: unknown) => void;
type GetAudioManager = () => AudioManager;

const deckRegistrations = new Map<DeckId, CueDeckRegistration>();
let cueInitialized = false;
let outputSettingsInitialized = false;
let outputErrorCleanup: (() => void) | null = null;

function registerOutputErrors(reportDjError: ReportDjError): void {
  outputErrorCleanup?.();
  outputErrorCleanup = getOutputRouting().subscribeErrors((error) => {
    reportDjError(error.message, "DJ_OUTPUT_ROUTER_ERROR", error);
  });
}

function getCueBus(_audioContext?: AudioContext) {
  if (typeof window === "undefined") {
    throw new Error("Output routing can only be used in browser environment");
  }
  const routing = getOutputRouting();
  if (!cueInitialized) {
    const headphoneVolume = getMixer()?.headphoneVolume;
    if (headphoneVolume !== undefined) {
      routing.setHeadphoneVolume(headphoneVolume);
    }
    cueInitialized = true;
  }
  return routing;
}

function isCueBusInitialized(): boolean {
  return cueInitialized;
}

function ensureCueBus() {
  if (typeof window === "undefined") {
    return null;
  }
  return getCueBus(getAudioContext());
}

function cleanupCueBus(): void {
  for (const registration of deckRegistrations.values()) {
    registration.cleanup();
  }
  deckRegistrations.clear();
  getOutputRouting().releaseCue();
  outputErrorCleanup?.();
  outputErrorCleanup = null;
  outputSettingsInitialized = false;
  cueInitialized = false;
}

async function applyMainOutputDevice(
  deviceId: string,
  reportDjError: ReportDjError
): Promise<void> {
  registerOutputErrors(reportDjError);
  const snapshot = await getOutputRouting().applySettings({
    mainOutputId: deviceId,
  });
  if (snapshot.settings.cueOutputId === null) {
    disableCueDecks();
  }
}

async function applyCueOutputDevice(deviceId: string | null): Promise<void> {
  await getOutputRouting().applySettings({ cueOutputId: deviceId });
  if (deviceId !== null) {
    return;
  }
  disableCueDecks();
}

function disableCueDecks(): void {
  for (const [deckId, registration] of deckRegistrations) {
    registration.setEnabled(false);
    updateDeckCueState(deckId, false);
  }
}

async function applyCurrentAudioSettings(
  _getAudioManager: GetAudioManager,
  reportDjError: ReportDjError
): Promise<void> {
  registerOutputErrors(reportDjError);
  await getOutputRouting().applySettings();
}

async function initializeAudioDevices(
  getAudioManager: GetAudioManager,
  reportDjError: ReportDjError
): Promise<void> {
  if (outputSettingsInitialized) {
    return;
  }
  await applyCurrentAudioSettings(getAudioManager, reportDjError);
  outputSettingsInitialized = true;
}

function connectDeckToCueBus(
  deckId: DeckId,
  soundId: string,
  getAudioManager: GetAudioManager
): void {
  const tap = getAudioManager().getPreFaderNode(soundId);
  if (!tap) {
    return;
  }
  const mixer = getMixer();
  const enabled =
    deckId === "deck-a"
      ? (mixer?.deckACueEnabled ?? false)
      : (mixer?.deckBCueEnabled ?? false);
  const existing = deckRegistrations.get(deckId);
  if (existing) {
    existing.replaceTap(tap);
    existing.setEnabled(enabled);
    return;
  }
  ensureCueBus();
  deckRegistrations.set(
    deckId,
    getOutputRouting().registerCueDeck(deckId, tap, enabled)
  );
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

function setDeckCueEnabled(deckId: DeckId, enabled: boolean): void {
  const existing = deckRegistrations.get(deckId);
  if (existing) {
    existing.setEnabled(enabled);
  } else {
    deckRegistrations.set(
      deckId,
      getOutputRouting().registerCueDeck(deckId, null, enabled)
    );
  }
  updateDeckCueState(deckId, enabled);
}

function toggleDeckCue(deckId: DeckId): void {
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

function setHeadphoneVolume(volume: number): void {
  const clampedVolume = Math.max(0, Math.min(1, volume));
  getOutputRouting().setHeadphoneVolume(clampedVolume);
  updateMixer((draft) => {
    draft.headphoneVolume = clampedVolume;
  });
}

function reportAsyncOutputError(operation: Promise<unknown>): void {
  operation.catch(() => undefined);
}

function setMainOutputDelay(
  ms: number,
  _getAudioManager: GetAudioManager
): Promise<void> {
  return getOutputRouting()
    .applySettings({ mainDelayMs: ms })
    .then(() => undefined);
}

function setCueOutputDelay(ms: number): Promise<void> {
  return getOutputRouting()
    .applySettings({ cueDelayMs: ms })
    .then(() => undefined);
}

function getOutputDelays(): { mainDelayMs: number; cueDelayMs: number } {
  return getDelaySettings();
}

function initializeOutputDelays(_getAudioManager: GetAudioManager): void {
  const { mainDelayMs, cueDelayMs } = getDelaySettings();
  reportAsyncOutputError(
    getOutputRouting().applySettings({ cueDelayMs, mainDelayMs })
  );
}

function detectSystemLatency(): number | null {
  const context = getAudioContext();
  const outputLatency = context.outputLatency ?? 0;
  const baseLatency = context.baseLatency ?? 0;
  const totalLatencyMs = Math.round((outputLatency + baseLatency) * 1000);
  return totalLatencyMs === 0 ? null : totalLatencyMs;
}

function autoCompensateLatency(
  getAudioManager: GetAudioManager
): number | null {
  const latencyMs = detectSystemLatency();
  if (latencyMs === null) {
    return null;
  }
  setMainOutputDelay(latencyMs, getAudioManager).catch(() => undefined);
  return latencyMs;
}

export type { GetAudioManager, ReportDjError };
export {
  applyCueOutputDevice,
  applyCurrentAudioSettings,
  applyMainOutputDevice,
  autoCompensateLatency,
  cleanupCueBus,
  connectDeckToCueBus,
  detectSystemLatency,
  ensureCueBus,
  getCueBus,
  getOutputDelays,
  initializeAudioDevices,
  initializeOutputDelays,
  isCueBusInitialized,
  setCueOutputDelay,
  setDeckCueEnabled,
  setHeadphoneVolume,
  setMainOutputDelay,
  toggleDeckCue,
};
