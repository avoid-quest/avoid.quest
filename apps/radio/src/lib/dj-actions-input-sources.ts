import type {
  AudioManager,
  ChannelSelection,
  EffectConfig,
  FilterConfig,
  Radio,
} from "@/lib/audio";
import { extractFileMetadata } from "@/lib/audio/file-metadata";
import {
  activateChannel,
  deactivateChannel,
} from "@/lib/channel-state-manager";
import { type DeckId, deckConfig } from "@/lib/dj-actions-decks.js";
import type { DeviceInputMetadata, FileMetadata } from "@/lib/platform-types";
import { isDeviceInputMetadata } from "@/lib/platform-types";

type ReportDjError = (
  message: string,
  code: string,
  error?: unknown,
  radio?: Radio | null
) => void;

type InputSourceDependencies = {
  applyCrossfade: () => void;
  applyStoredChannelStrip: (
    audioManager: AudioManager,
    soundId: string,
    muted: boolean,
    pan: number,
    speed: number,
    channelFilter: number,
    effectsDryWet: number
  ) => void;
  applyStoredEffectsAndFilters: (
    audioManager: AudioManager,
    soundId: string,
    effects: EffectConfig[],
    filter: FilterConfig
  ) => Promise<void>;
  clearDjError: () => void;
  connectDeckCueBus: (
    deckId: DeckId,
    soundId: string,
    getAudioManager: () => AudioManager
  ) => void;
  getAudioManager: () => AudioManager;
  initializeAudioDevices: (
    getAudioManager: () => AudioManager,
    reportDjError: ReportDjError
  ) => Promise<void>;
  reportDjError: ReportDjError;
  setDeckRadio: (deckId: DeckId, radio: Radio | null) => Promise<void>;
};

function cleanupFailedDeviceSource(
  deckId: DeckId,
  config: (typeof deckConfig)["deck-a"],
  soundId: string
): void {
  const currentRuntime = config.getRuntime();
  if (currentRuntime.soundId !== soundId) {
    return;
  }

  deactivateChannel(deckId);
}

export async function setDeckDeviceInputSource(
  deckId: DeckId,
  deviceId: string,
  deviceLabel: string,
  dependencies: InputSourceDependencies
): Promise<void> {
  const config = deckConfig[deckId];
  const deck = config.getDeck();

  if (!deck) {
    return;
  }

  deactivateChannel(deckId);

  const side = config.side;
  const radioId = `device-input-${side}`;
  const soundId = `${side}_${radioId}`;

  const platformMetadata: DeviceInputMetadata = {
    platform: "device-input",
    itemType: "track",
    url: "",
    deviceId,
    deviceLabel,
    channelSelection: { left: 0, right: 1 },
    channelCount: 2,
  };

  const radio: Radio = {
    id: radioId,
    name: deviceLabel,
    streamUrl: "",
    description: "Device input (mic/line-in)",
    enabled: true,
    platformMetadata,
  };

  try {
    dependencies.clearDjError();

    config.updateDeck((draft) => {
      draft.radio = radio;
    });

    let hasAppliedChannelStrip = false;
    activateChannel("dj", deckId, radio, {
      soundId,
      onAudioState: (audioState) => {
        const currentDeck = config.getDeck();
        const currentRuntime = config.getRuntime();

        if (
          audioState.isPlaying &&
          !audioState.isLoading &&
          !hasAppliedChannelStrip &&
          currentDeck
        ) {
          hasAppliedChannelStrip = true;
          dependencies.applyStoredEffectsAndFilters(
            dependencies.getAudioManager(),
            soundId,
            currentDeck.effects,
            currentDeck.filter
          );
          dependencies.applyStoredChannelStrip(
            dependencies.getAudioManager(),
            soundId,
            currentDeck.muted,
            currentDeck.pan,
            currentDeck.speed,
            currentDeck.channelFilter,
            currentDeck.effectsDryWet
          );
          dependencies.connectDeckCueBus(
            deckId,
            soundId,
            dependencies.getAudioManager
          );
          dependencies
            .initializeAudioDevices(
              dependencies.getAudioManager,
              dependencies.reportDjError
            )
            .catch((error) => {
              console.warn(
                "[dj-actions] Failed to initialize audio devices:",
                error
              );
            });
        }

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

        if (audioState.error?.message) {
          dependencies.reportDjError(
            audioState.error.message,
            `DJ_${audioState.error.code}`,
            new Error(audioState.error.message),
            currentDeck?.radio
          );
        }
      },
    });
    await dependencies.getAudioManager().playDeviceSound(soundId, deviceId);

    const deviceSource = dependencies
      .getAudioManager()
      .getDeviceSource(soundId);
    if (deviceSource) {
      const actualChannelCount = deviceSource.channelCount;
      config.updateDeck((draft) => {
        const meta = draft.radio?.platformMetadata;
        if (isDeviceInputMetadata(meta)) {
          meta.channelCount = actualChannelCount;
        }
      });
    }

    dependencies.applyCrossfade();
  } catch (error) {
    cleanupFailedDeviceSource(deckId, config, soundId);
    const message =
      error instanceof Error ? error.message : "Failed to start device input";
    dependencies.reportDjError(
      message,
      "DJ_DEVICE_INPUT_START_FAILED",
      error,
      radio
    );
  }
}

export function setDeckDeviceChannelSelection(
  deckId: DeckId,
  selection: ChannelSelection,
  getAudioManager: () => AudioManager
): void {
  const runtime = deckConfig[deckId].getRuntime();
  if (runtime.soundId) {
    getAudioManager().setDeviceChannelSelection(runtime.soundId, selection);
  }

  deckConfig[deckId].updateDeck((draft) => {
    const meta = draft.radio?.platformMetadata;
    if (isDeviceInputMetadata(meta)) {
      meta.channelSelection = selection;
    }
  });
}

export async function setDeckLocalFileSource(
  deckId: DeckId,
  file: File,
  clearDjError: () => void,
  reportDjError: ReportDjError,
  setDeckRadio: (deckId: DeckId, radio: Radio | null) => Promise<void>
): Promise<void> {
  const side = deckConfig[deckId].side;

  try {
    clearDjError();
    const meta = await extractFileMetadata(file);

    const platformMetadata: FileMetadata = {
      platform: "local-file",
      itemType: "track",
      url: "",
      fileName: meta.fileName,
      displayName: meta.displayName,
      duration: meta.duration,
      fileSize: meta.fileSize,
      mimeType: meta.mimeType,
      objectUrl: meta.objectUrl,
    };

    const radio: Radio = {
      id: `local-file-${side}-${Date.now()}`,
      name: meta.displayName,
      streamUrl: meta.objectUrl,
      description: "Local File",
      enabled: true,
      platformMetadata,
    };

    await setDeckRadio(deckId, radio);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load audio file";
    reportDjError(message, "DJ_LOCAL_FILE_LOAD_FAILED", error);
  }
}
