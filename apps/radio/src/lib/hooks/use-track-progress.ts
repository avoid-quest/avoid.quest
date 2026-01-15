import { useState } from "react";

/**
 * Track progress hook
 *
 * Note: Track progress tracking is not currently supported with the streaming
 * architecture. This hook returns stub values for compatibility.
 * For finite media (non-streams), progress tracking would require additional
 * AudioManager API extensions.
 */
export function useTrackProgress(_soundId: string | null) {
  const [position] = useState(0);
  const [duration] = useState(0);

  // Track progress is not available for streaming sources
  // The streaming architecture doesn't expose playback position

  return { position, duration };
}
