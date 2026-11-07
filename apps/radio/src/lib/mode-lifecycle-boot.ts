import { captureError } from "@avoid.quest/error";
import type { PlaybackSessionId } from "@/lib/collections/playback-sessions";
import type { ModeLifecycleRequests } from "./mode-lifecycle-requests";

/**
 * Loads mode-lifecycle requests (usually via dynamic import) then synchronizes.
 * Import failures are reported as `loadModeLifecycle`; synchronizeMode owns its
 * own failure reporting.
 */
export async function runModeLifecycleSynchronization(
  mode: PlaybackSessionId,
  loadRequests: () => Promise<Pick<ModeLifecycleRequests, "synchronizeMode">>
): Promise<void> {
  let synchronizeMode: ModeLifecycleRequests["synchronizeMode"];
  try {
    ({ synchronizeMode } = await loadRequests());
  } catch (error) {
    captureError(error, {
      operation: "loadModeLifecycle",
      surface: "ui",
      tags: { mode },
    });
    throw error;
  }
  await synchronizeMode(mode);
}
