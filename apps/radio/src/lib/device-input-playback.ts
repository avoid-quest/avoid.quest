/**
 * Device Input Playback
 *
 * Starting a live input (a mic or line-in) on a sound that already exists:
 * set its channels before opening the capture. DJ decks and Node mode's
 * Audio input lanes both start their device here, so the two can't drift.
 */

import type { ChannelSelection, DeviceAudioConstraints } from "@/lib/audio";

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
  deviceId: string;
  channelSelection: ChannelSelection;
  /**
   * Set to ask the browser for echo cancellation, the one built-in feedback
   * guard. Left out, the capture keeps DeviceSource's defaults (all off).
   */
  echoCancellation?: boolean;
};

/**
 * Opens `target`'s capture on `soundId` with its channels already selected.
 * Resolves with the device's channel count, or null when it is unknown or
 * the start went stale (`isCurrent` turned false while the capture opened).
 */
export async function startDeviceInput(
  audio: DeviceInputAudio,
  soundId: string,
  { channelSelection, deviceId, echoCancellation }: DeviceInputTarget,
  isCurrent: () => boolean = () => true
): Promise<number | null> {
  await audio.startDevice(
    soundId,
    deviceId,
    echoCancellation === undefined ? undefined : { echoCancellation },
    channelSelection
  );
  if (!isCurrent()) {
    return null;
  }
  return audio.getDeviceChannelCount(soundId);
}
