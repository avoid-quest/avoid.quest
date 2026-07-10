import {
  type AudioManager,
  type CueBus,
  createCueBus,
  getAudioContext,
} from "@/lib/audio";
import {
  getAudioSettings,
  getDelaySettings,
  setCueDelayMs as setCueDelayMsSetting,
  setMainDelayMs as setMainDelayMsSetting,
} from "@/lib/collections";
import type { DeckId } from "@/lib/dj-actions-decks.js";
import { getMixer, updateMixer } from "@/lib/hooks/use-dj-state";
import {
  getMainOutputRouter,
  onMainOutputRouterError,
} from "@/lib/main-output-router";

type ReportDjError = (message: string, code: string, error?: unknown) => void;
type GetAudioManager = () => AudioManager;

let cueBus: CueBus | null = null;

export function createDjRoutingLifecycleState() {
  let audioDevicesInitialized = false;
  let outputRouterErrorCleanup: (() => void) | null = null;

  return {
    beginAudioDeviceInitialization(): boolean {
      if (audioDevicesInitialized) {
        return false;
      }
      audioDevicesInitialized = true;
      return true;
    },
    cleanup(): void {
      audioDevicesInitialized = false;
      outputRouterErrorCleanup?.();
      outputRouterErrorCleanup = null;
    },
    replaceOutputRouterErrorListener(subscribe: () => () => void): void {
      outputRouterErrorCleanup?.();
      outputRouterErrorCleanup = subscribe();
    },
    resetAudioDeviceInitialization(): void {
      audioDevicesInitialized = false;
    },
  };
}

const routingLifecycle = createDjRoutingLifecycleState();

function getCueBus(audioContext: AudioContext): CueBus {
  if (typeof window === "undefined") {
    throw new Error("CueBus can only be used in browser environment");
  }

  if (!cueBus) {
    cueBus = createCueBus(audioContext, {
      onHeadphoneVolumeChange: (volume) => {
        updateMixer((draft) => {
          draft.headphoneVolume = volume;
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

    cueBus.registerDeck("deck-a");
    cueBus.registerDeck("deck-b");

    const mixer = getMixer();
    if (mixer) {
      if (mixer.headphoneVolume !== undefined) {
        cueBus.setHeadphoneVolume(mixer.headphoneVolume);
      }
      if (mixer.deckACueEnabled) {
        cueBus.setCueEnabled("deck-a", true);
      }
      if (mixer.deckBCueEnabled) {
        cueBus.setCueEnabled("deck-b", true);
      }
    }
  }

  return cueBus;
}

function isCueBusInitialized(): boolean {
  return cueBus !== null;
}

function ensureCueBus(): CueBus | null {
  if (cueBus) {
    return cueBus;
  }

  const context = getAudioContext();
  if (!context) {
    return null;
  }

  return getCueBus(context);
}

function cleanupCueBus(): void {
  if (cueBus) {
    cueBus.cleanup();
    cueBus = null;
  }
  routingLifecycle.cleanup();
}

function registerOutputRouterErrors(reportDjError: ReportDjError): void {
  routingLifecycle.replaceOutputRouterErrorListener(() =>
    onMainOutputRouterError((error) => {
      reportDjError(error.message, "DJ_OUTPUT_ROUTER_ERROR", error);
    })
  );
}

function getOutputRouter(reportDjError: ReportDjError) {
  if (typeof window === "undefined") {
    return null;
  }

  registerOutputRouterErrors(reportDjError);
  return getMainOutputRouter();
}

async function applyMainOutputDevice(
  deviceId: string,
  reportDjError: ReportDjError
): Promise<void> {
  const router = getOutputRouter(reportDjError);
  if (router) {
    await router.setMainOutput(deviceId);
  }
}

async function applyCueOutputDevice(deviceId: string | null): Promise<void> {
  const bus = ensureCueBus();
  if (!bus) {
    return;
  }

  await bus.setCueOutputDevice(deviceId);

  if (!deviceId) {
    bus.setCueEnabled("deck-a", false);
    bus.setCueEnabled("deck-b", false);
    updateMixer((draft) => {
      draft.deckACueEnabled = false;
      draft.deckBCueEnabled = false;
    });
  }
}

async function applyCurrentAudioSettings(
  getAudioManager: GetAudioManager,
  reportDjError: ReportDjError
): Promise<void> {
  const router = getOutputRouter(reportDjError);
  if (!router) {
    return;
  }

  try {
    const settings = getAudioSettings();
    if (settings.mainOutputId && settings.mainOutputId !== "default") {
      await router.setMainOutput(settings.mainOutputId);
    }
    if (settings.cueOutputId) {
      const bus = ensureCueBus();
      if (bus) {
        await bus.setCueOutputDevice(settings.cueOutputId);
      }
    }

    const delaySettings = getDelaySettings();
    if (delaySettings.mainDelayMs > 0) {
      getAudioManager().setMainDelay(delaySettings.mainDelayMs);
    }
    if (delaySettings.cueDelayMs > 0) {
      const bus = ensureCueBus();
      if (bus) {
        bus.setCueDelay(delaySettings.cueDelayMs);
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to apply audio settings";
    reportDjError(message, "DJ_APPLY_AUDIO_SETTINGS_FAILED", error);
  }
}

async function initializeAudioDevices(
  getAudioManager: GetAudioManager,
  reportDjError: ReportDjError
): Promise<void> {
  if (!routingLifecycle.beginAudioDeviceInitialization()) {
    return;
  }

  const router = getOutputRouter(reportDjError);
  if (!router) {
    routingLifecycle.resetAudioDeviceInitialization();
    return;
  }

  await applyCurrentAudioSettings(getAudioManager, reportDjError);
}

function connectDeckToCueBus(
  deckId: DeckId,
  soundId: string,
  getAudioManager: GetAudioManager
): void {
  const bus = ensureCueBus();
  if (!bus) {
    return;
  }

  const preFaderNode = getAudioManager().getPreFaderNode(soundId);
  if (preFaderNode) {
    bus.connectPreFader(deckId, preFaderNode);
  }

  const mixer = getMixer();
  if (!mixer) {
    return;
  }

  const enabled =
    deckId === "deck-a" ? mixer.deckACueEnabled : mixer.deckBCueEnabled;
  if (enabled) {
    bus.setCueEnabled(deckId, true);
  }
}

function setDeckCueEnabled(deckId: DeckId, enabled: boolean): void {
  const bus = ensureCueBus();
  if (bus) {
    bus.setCueEnabled(deckId, enabled);
  }

  updateMixer((draft) => {
    if (deckId === "deck-a") {
      draft.deckACueEnabled = enabled;
    } else {
      draft.deckBCueEnabled = enabled;
    }
  });
}

function toggleDeckCue(deckId: DeckId): void {
  if (!getAudioSettings().cueOutputId) {
    return;
  }

  const mixer = getMixer();
  if (!mixer) {
    return;
  }

  const enabled =
    deckId === "deck-a" ? !mixer.deckACueEnabled : !mixer.deckBCueEnabled;
  setDeckCueEnabled(deckId, enabled);
}

function setHeadphoneVolume(volume: number): void {
  const bus = ensureCueBus();
  updateMixer((draft) => {
    draft.headphoneVolume = volume;
  });
  if (bus) {
    bus.setHeadphoneVolume(volume);
  }
}

function setMainOutputDelay(
  ms: number,
  getAudioManager: GetAudioManager
): void {
  setMainDelayMsSetting(ms);
  getAudioManager().setMainDelay(ms);
}

function setCueOutputDelay(ms: number): void {
  setCueDelayMsSetting(ms);
  const bus = ensureCueBus();
  if (bus) {
    bus.setCueDelay(ms);
  }
}

function getOutputDelays(): { mainDelayMs: number; cueDelayMs: number } {
  return getDelaySettings();
}

function initializeOutputDelays(getAudioManager: GetAudioManager): void {
  const { mainDelayMs, cueDelayMs } = getDelaySettings();

  if (mainDelayMs > 0) {
    getAudioManager().setMainDelay(mainDelayMs);
  }

  if (cueDelayMs > 0) {
    const bus = ensureCueBus();
    if (bus) {
      bus.setCueDelay(cueDelayMs);
    }
  }
}

function detectSystemLatency(): number | null {
  const context = getAudioContext();
  if (!context) {
    return null;
  }

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

  setMainOutputDelay(latencyMs, getAudioManager);
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
