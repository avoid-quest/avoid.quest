import { useEffect, useState } from "react";
import type { ModeTransitionSnapshot } from "./mode-lifecycle-manager";

const INITIAL_SNAPSHOT: ModeTransitionSnapshot = {
  currentMode: null,
  error: null,
  phase: "inactive",
  requestedMode: null,
};

export function useModeTransitionSnapshot(): ModeTransitionSnapshot {
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    import("./mode-lifecycle-requests").then(({ modeLifecycleRequests }) => {
      if (cancelled) {
        return;
      }
      const update = () =>
        setSnapshot(modeLifecycleRequests.getTransitionSnapshot());
      update();
      unsubscribe = modeLifecycleRequests.subscribeTransitionSnapshot(update);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return snapshot;
}
