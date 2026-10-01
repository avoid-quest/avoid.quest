/**
 * Device Input Playback
 *
 * Starting a live input (a mic or line-in) on a sound that already exists:
 * set its channels before opening the capture. DJ decks and Node mode's
 * Audio input lanes both start their device here, so the two can't drift.
 */

import type { ChannelSelection, DeviceAudioConstraints } from "@/lib/audio";
import {
  requestDisplayAudio,
  stopCapturedAudio,
} from "@/lib/audio/playback/display-audio";

/** The engine calls a device start needs; AudioManager provides them. */
export type DeviceInputAudio = {
  startDevice: (
    soundId: string,
    deviceId: string,
    constraints?: DeviceAudioConstraints,
    channelSelection?: ChannelSelection
  ) => Promise<void>;
  getDeviceChannelCount: (soundId: string) => number | null;
};

export type DeviceInputTarget = {
  capture?: "display";
  deviceId: string;
  channelSelection: ChannelSelection;
  /**
   * Set to ask the browser for echo cancellation, the one built-in feedback
   * guard. Left out, the capture keeps DeviceSource's defaults (all off).
   */
  echoCancellation?: boolean;
  /** A display stream the caller already acquired during the user's gesture. */
  stream?: MediaStream;
};

/**
 * Opens `target`'s capture on `soundId` with its channels already selected.
 * Resolves with the device's channel count, or null when it is unknown or
 * the start went stale (`isCurrent` turned false while the capture opened).
 */
export async function startDeviceInput(
  audio: DeviceInputAudio,
  soundId: string,
  {
    capture,
    channelSelection,
    deviceId,
    echoCancellation,
    stream: acquired,
  }: DeviceInputTarget,
  isCurrent: () => boolean = () => true
): Promise<number | null> {
  const stream =
    acquired ??
    (capture === "display" ? await requestDisplayAudio() : undefined);
  if (stream && !isCurrent()) {
    stopCapturedAudio(stream);
    return null;
  }
  const constraints =
    echoCancellation === undefined ? undefined : { echoCancellation };
  try {
    await audio.startDevice(
      soundId,
      deviceId,
      stream ? { stream } : constraints,
      channelSelection
    );
    if (!isCurrent()) {
      if (stream) {
        stopCapturedAudio(stream);
      }
      return null;
    }
  } catch (error) {
    if (stream) {
      stopCapturedAudio(stream);
    }
    throw error;
  }
  const count = audio.getDeviceChannelCount(soundId);
  if (stream && count === null) {
    stopCapturedAudio(stream);
  }
  return count;
}
