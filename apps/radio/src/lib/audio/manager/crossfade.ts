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

  // Get initial volumes
  // For now, we estimate from current state - ideally we'd track this
  const fromStartVolume = 1; // Assumes current volume is 1
  const toStartVolume = 0;

  const startTime = Date.now();

  return new Promise((resolve) => {
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const rawProgress = Math.min(elapsed / duration, 1);
      const progress = applyCurve(rawProgress, curve);

      // Calculate volumes
      const fromVolume = fromStartVolume * (1 - progress);
      const toVolume =
        toStartVolume + (targetVolume - toStartVolume) * progress;

      // Apply volumes
      manager.setVolume(fromSoundId, fromVolume);
      manager.setVolume(toSoundId, toVolume);

      if (rawProgress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Crossfade complete - stop the outgoing sound
        manager.stopSound(fromSoundId);
        resolve();
      }
    };

    animate();
  });
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
  const startTime = Date.now();

  // Start at zero volume
  manager.setVolume(soundId, 0);

  return new Promise((resolve) => {
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const rawProgress = Math.min(elapsed / duration, 1);
      const progress = applyCurve(rawProgress, curve);

      manager.setVolume(soundId, targetVolume * progress);

      if (rawProgress < 1) {
        requestAnimationFrame(animate);
      } else {
        resolve();
      }
    };

    animate();
  });
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
  const startTime = Date.now();
  const startVolume = 1; // Assumes current volume is 1

  return new Promise((resolve) => {
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const rawProgress = Math.min(elapsed / duration, 1);
      const progress = applyCurve(rawProgress, curve);

      manager.setVolume(soundId, startVolume * (1 - progress));

      if (rawProgress < 1) {
        requestAnimationFrame(animate);
      } else {
        if (stopAfter) {
          manager.stopSound(soundId);
        }
        resolve();
      }
    };

    animate();
  });
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
  const startTime = Date.now();
  const startVolume = 1; // Assumes current volume is 1

  // Fade down
  await new Promise<void>((resolve) => {
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / fadeDuration, 1);

      const volume = startVolume - (startVolume - duckLevel) * progress;
      manager.setVolume(soundId, volume);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        resolve();
      }
    };
    animate();
  });

  // Return function to restore volume
  return () => {
    const restoreStartTime = Date.now();

    return new Promise((resolve) => {
      const animate = () => {
        const elapsed = Date.now() - restoreStartTime;
        const progress = Math.min(elapsed / fadeDuration, 1);

        const volume = duckLevel + (startVolume - duckLevel) * progress;
        manager.setVolume(soundId, volume);

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };
      animate();
    });
  };
}
