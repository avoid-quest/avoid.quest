import { useThrottledCallback } from "@tanstack/react-pacer";

/**
 * Creates a throttled setter function for slider/param controls.
 * Limits state updates to ~30fps (32ms) to prevent overwhelming
 * the audio manager while maintaining smooth visual feedback.
 *
 * @param setter - The state setter function to throttle
 * @param wait - Throttle interval in ms (default: 32ms for ~30fps)
 * @returns A throttled version of the setter
 */
export function useThrottledParam<T>(setter: (value: T) => void, wait = 32) {
  return useThrottledCallback(setter, { leading: true, trailing: true, wait });
}
