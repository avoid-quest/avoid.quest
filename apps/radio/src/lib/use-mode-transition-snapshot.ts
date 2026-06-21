import { useSyncExternalStore } from "react";
import type { ModeTransitionSnapshot } from "./mode-lifecycle-manager";
import { modeLifecycleRequests } from "./mode-lifecycle-requests";

export function useModeTransitionSnapshot(): ModeTransitionSnapshot {
  return useSyncExternalStore(
    modeLifecycleRequests.subscribeTransitionSnapshot,
    modeLifecycleRequests.getTransitionSnapshot,
    modeLifecycleRequests.getTransitionSnapshot
  );
}
