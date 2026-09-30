/**
 * Device Input Playback
 *
 * Starting a live input (a mic or line-in) on a sound that already exists:
 * open the capture, then route the chosen channels. DJ decks and Node mode's
 * Audio input lanes both start their device here, so the two can't drift.
 */

import type { ChannelSelection, DeviceAudioConstraints } from "@/lib/audio";

/** The engine calls a device start needs; AudioManager provides them. */
export type DeviceInputAudio = {
  startDevice: (
    soundId: string,
    deviceId: string,
    constraints?: DeviceAudioConstraints
  ) => Promise<void>;
  setDeviceChannelSelection: (
    soundId: string,
    selection: ChannelSelection
  ) => void;
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
 * Opens `target`'s capture on `soundId`, then selects its channels.
 * Resolves with the device's channel count, or null when it is unknown or
 * the start went stale (`isCurrent` turned false while the capture opened).
 */
export async function startDeviceInput(
  audio: DeviceInputAudio,
  soundId: string,
  { channelSelection, deviceId, echoCancellation }: DeviceInputTarget,
  isCurrent: () => boolean = () => true
): Promise<number | null> {
  if (echoCancellation === undefined) {
    await audio.startDevice(soundId, deviceId);
  } else {
    await audio.startDevice(soundId, deviceId, { echoCancellation });
  }
  if (!isCurrent()) {
    return null;
  }
  audio.setDeviceChannelSelection(soundId, channelSelection);
  return audio.getDeviceChannelCount(soundId);
}
