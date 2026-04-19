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
};

/**
 * Apply crossfade curve to progress value
 */
function applyCurve(progress: number, curve: CrossfadeCurve): number {
  switch (curve) {
    case "equalPower":
      // Equal power crossfade - maintains constant perceived loudness
      return Math.sin((progress * Math.PI) / 2);
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
  transformProgress: (progress: number) => number
): Float32Array {
  const stepCount = 48;
  const values = new Float32Array(stepCount + 1);

  for (let index = 0; index <= stepCount; index++) {
    const rawProgress = index / stepCount;
    const curvedProgress = transformProgress(applyCurve(rawProgress, curve));
    values[index] = startVolume + (endVolume - startVolume) * curvedProgress;
  }

  return values;
}

function wait(duration: number): Promise<void> {
  if (duration <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
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
  const { duration, targetVolume = 1, curve = "linear" } = options;
  const clampedDuration = Math.max(0, duration);

  return (async () => {
    if (!manager.hasSound(toSoundId)) {
      return;
    }

    const fromStartVolume = manager.getSoundVolume(fromSoundId) ?? 1;
    const toStartVolume = manager.getSoundVolume(toSoundId) ?? 0;

    if (clampedDuration === 0) {
      if (manager.hasSound(fromSoundId)) {
        manager.setVolume(fromSoundId, 0);
      }
      manager.setVolume(toSoundId, targetVolume);
      if (manager.hasSound(fromSoundId)) {
        manager.stopSound(fromSoundId);
      }
      return;
    }

    if (manager.hasSound(fromSoundId)) {
      manager.scheduleVolumeCurve(
        fromSoundId,
        createVolumeCurve(fromStartVolume, 0, curve, (progress) => progress),
        clampedDuration
      );
    }

    manager.scheduleVolumeCurve(
      toSoundId,
      createVolumeCurve(
        toStartVolume,
        targetVolume,
        curve,
        (progress) => progress
      ),
      clampedDuration
    );

    await wait(clampedDuration);

    if (manager.hasSound(toSoundId)) {
      manager.setVolume(toSoundId, targetVolume);
    }
    if (manager.hasSound(fromSoundId)) {
      manager.stopSound(fromSoundId);
    }
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
      createVolumeCurve(0, targetVolume, curve, (progress) => progress),
      clampedDuration
    );
    await wait(clampedDuration);
    if (manager.hasSound(soundId)) {
      manager.setVolume(soundId, targetVolume);
    }
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
      createVolumeCurve(startVolume, 0, curve, (progress) => progress),
      clampedDuration
    );
    await wait(clampedDuration);
    if (!manager.hasSound(soundId)) {
      return;
    }
    manager.setVolume(soundId, 0);
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
        createVolumeCurve(
          startVolume,
          duckLevel,
          "linear",
          (progress) => progress
        ),
        clampedDuration
      );
      await wait(clampedDuration);
      if (manager.hasSound(soundId)) {
        manager.setVolume(soundId, duckLevel);
      }
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
      createVolumeCurve(
        duckLevel,
        startVolume,
        "linear",
        (progress) => progress
      ),
      clampedDuration
    );
    await wait(clampedDuration);
    if (manager.hasSound(soundId)) {
      manager.setVolume(soundId, startVolume);
    }
  };
}
