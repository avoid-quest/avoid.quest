/**
 * Crossfade Utilities
 *
 * Provides smooth transitions between audio sources.
 */

import { AudioManager } from "./audio-manager.js";

/**
 * Crossfade curve types
 */
export type CrossfadeCurve = "linear" | "equalPower" | "exponential";

/**
 * Crossfade options
 */
export type CrossfadeOptions = {
  /** Duration of crossfade in milliseconds */
  duration: number;
  /** Target volume for the incoming sound (default: 1) */
  targetVolume?: number;
  /** Crossfade curve type (default: 'linear') */
  curve?: CrossfadeCurve;
  /** Abort the transition without stopping the outgoing sound. */
  signal?: AbortSignal;
  /** Stop the outgoing sound after completion (default: true). */
  stopOutgoing?: boolean;
};

type CurveDirection = "in" | "out";

/**
 * Apply crossfade curve to progress value
 */
function applyCurve(
  progress: number,
  curve: CrossfadeCurve,
  direction: CurveDirection
): number {
  switch (curve) {
    case "equalPower":
      // Incoming sine and outgoing cosine keep the sum of squared gains at 1.
      // createVolumeCurve interpolates start -> end, so an outgoing cosine
      // needs the complementary interpolation progress (1 - cosine).
      return direction === "in"
        ? Math.sin((progress * Math.PI) / 2)
        : 1 - Math.cos((progress * Math.PI) / 2);
    case "exponential":
      // Exponential curve for more dramatic transitions
      return progress * progress;
    default:
      // Linear (default)
      return progress;
  }
}

function createVolumeCurve(
  startVolume: number,
  endVolume: number,
  curve: CrossfadeCurve,
  direction: CurveDirection
): Float32Array {
  const stepCount = 48;
  const values = new Float32Array(stepCount + 1);

  for (let index = 0; index <= stepCount; index++) {
    const rawProgress = index / stepCount;
    const curvedProgress = applyCurve(rawProgress, curve, direction);
    values[index] = startVolume + (endVolume - startVolume) * curvedProgress;
  }

  return values;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Transition aborted", "AbortError");
}

function wait(duration: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortReason(signal));
  }
  if (duration <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, duration);
    const handleAbort = () => {
      clearTimeout(timeout);
      reject(signal ? abortReason(signal) : undefined);
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

function setVolumeIfPresent(
  manager: AudioManager,
  soundId: string,
  volume: number
): void {
  if (manager.hasSound(soundId)) {
    manager.setVolume(soundId, volume);
  }
}

function stopIfRequested(
  manager: AudioManager,
  soundId: string,
  stop: boolean
): void {
  if (stop && manager.hasSound(soundId)) {
    manager.stopSound(soundId);
  }
}

function restoreCrossfadeVolumes(
  manager: AudioManager,
  fromSoundId: string,
  fromVolume: number,
  toSoundId: string,
  toVolume: number
): void {
  setVolumeIfPresent(manager, fromSoundId, fromVolume);
  setVolumeIfPresent(manager, toSoundId, toVolume);
}

/**
 * Crossfade between two sounds
 *
 * Smoothly transitions from one sound to another over the specified duration.
 * The outgoing sound is stopped after the crossfade completes.
 *
 * @param fromSoundId - ID of the outgoing sound
 * @param toSoundId - ID of the incoming sound
 * @param options - Crossfade configuration
 * @returns Promise that resolves when crossfade is complete
 */
export function crossfade(
  fromSoundId: string,
  toSoundId: string,
  options: CrossfadeOptions
): Promise<void> {
  const manager = AudioManager.getInstance();
  const {
    duration,
    targetVolume = 1,
    curve = "linear",
    signal,
    stopOutgoing = true,
  } = options;
  const clampedDuration = Math.max(0, duration);

  return (async () => {
    if (!manager.hasSound(toSoundId)) {
      return;
    }
    if (signal?.aborted) {
      throw abortReason(signal);
    }

    const fromStartVolume = manager.getSoundVolume(fromSoundId) ?? 1;
    const toStartVolume = manager.getSoundVolume(toSoundId) ?? 0;

    if (clampedDuration === 0) {
      setVolumeIfPresent(manager, fromSoundId, 0);
      setVolumeIfPresent(manager, toSoundId, targetVolume);
      stopIfRequested(manager, fromSoundId, stopOutgoing);
      return;
    }

    if (manager.hasSound(fromSoundId)) {
      manager.scheduleVolumeCurve(
        fromSoundId,
        createVolumeCurve(fromStartVolume, 0, curve, "out"),
        clampedDuration
      );
    }

    manager.scheduleVolumeCurve(
      toSoundId,
      createVolumeCurve(toStartVolume, targetVolume, curve, "in"),
      clampedDuration
    );

    try {
      await wait(clampedDuration, signal);
    } catch (error) {
      // Scheduling automation is fire-and-forget at the Web Audio layer. An
      // aborted owner must explicitly cancel both curves and restore the
      // pre-transition state so this helper is safe outside managed sessions.
      restoreCrossfadeVolumes(
        manager,
        fromSoundId,
        fromStartVolume,
        toSoundId,
        toStartVolume
      );
      throw error;
    }

    stopIfRequested(manager, fromSoundId, stopOutgoing);
  })();
}

/**
 * Fade in a sound
 *
 * @param soundId - ID of the sound to fade in
 * @param duration - Duration in milliseconds
 * @param targetVolume - Target volume (default: 1)
 * @param curve - Fade curve (default: 'linear')
 */
export function fadeIn(
  soundId: string,
  duration: number,
  targetVolume = 1,
  curve: CrossfadeCurve = "linear"
): Promise<void> {
  const manager = AudioManager.getInstance();
  const clampedDuration = Math.max(0, duration);

  return (async () => {
    if (!manager.hasSound(soundId)) {
      return;
    }

    manager.setVolume(soundId, 0);

    if (clampedDuration === 0) {
      manager.setVolume(soundId, targetVolume);
      return;
    }

    manager.scheduleVolumeCurve(
      soundId,
      createVolumeCurve(0, targetVolume, curve, "in"),
      clampedDuration
    );
    await wait(clampedDuration);
  })();
}

/**
 * Fade out a sound
 *
 * @param soundId - ID of the sound to fade out
 * @param duration - Duration in milliseconds
 * @param stopAfter - Whether to stop the sound after fade (default: true)
 * @param curve - Fade curve (default: 'linear')
 */
export function fadeOut(
  soundId: string,
  duration: number,
  stopAfter = true,
  curve: CrossfadeCurve = "linear"
): Promise<void> {
  const manager = AudioManager.getInstance();
  const clampedDuration = Math.max(0, duration);

  return (async () => {
    if (!manager.hasSound(soundId)) {
      return;
    }

    const startVolume = manager.getSoundVolume(soundId) ?? 1;

    if (clampedDuration === 0) {
      manager.setVolume(soundId, 0);
      if (stopAfter && manager.hasSound(soundId)) {
        manager.stopSound(soundId);
      }
      return;
    }

    manager.scheduleVolumeCurve(
      soundId,
      createVolumeCurve(startVolume, 0, curve, "out"),
      clampedDuration
    );
    await wait(clampedDuration);
    if (!manager.hasSound(soundId)) {
      return;
    }
    if (stopAfter) {
      manager.stopSound(soundId);
    }
  })();
}

/**
 * Duck a sound (reduce volume temporarily)
 *
 * Useful for ducking background music when playing announcements.
 *
 * @param soundId - ID of the sound to duck
 * @param duckLevel - Volume level during duck (0-1, default: 0.3)
 * @param fadeDuration - Duration of fade in/out in milliseconds (default: 300)
 */
export async function duckSound(
  soundId: string,
  duckLevel = 0.3,
  fadeDuration = 300
): Promise<() => Promise<void>> {
  const manager = AudioManager.getInstance();
  const startVolume = manager.getSoundVolume(soundId) ?? 1;
  const clampedDuration = Math.max(0, fadeDuration);

  if (manager.hasSound(soundId)) {
    if (clampedDuration === 0) {
      manager.setVolume(soundId, duckLevel);
    } else {
      manager.scheduleVolumeCurve(
        soundId,
        createVolumeCurve(startVolume, duckLevel, "linear", "out"),
        clampedDuration
      );
      await wait(clampedDuration);
    }
  }

  // Return function to restore volume
  return async () => {
    if (!manager.hasSound(soundId)) {
      return;
    }

    if (clampedDuration === 0) {
      manager.setVolume(soundId, startVolume);
      return;
    }

    manager.scheduleVolumeCurve(
      soundId,
      createVolumeCurve(duckLevel, startVolume, "linear", "in"),
      clampedDuration
    );
    await wait(clampedDuration);
  };
}
