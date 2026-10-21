import { captureError } from "@avoid.quest/error";
import { Suspense, useEffect } from "react";
import { LazyBoundary, lazyWithRetry } from "@/components/lazy-recovery";
import type { Radio } from "@/lib/audio";
import { useEnabledRadios } from "@/lib/hooks/use-radios";
import { usePlayerModeState } from "@/lib/hooks/use-settings";
import type { PlayerMode } from "@/lib/normalize-player-mode";
import { useModeTransitionSnapshot } from "@/lib/use-mode-transition-snapshot";
import { RadioLoadingSkeleton } from "./radio-loading-skeleton";
import {
  loadDjPlayer,
  loadNodeRadios,
  loadSingleRadio,
} from "./radio-mode-loader";

// A failed mode stays failed until Retry. Swapping in a fresh lazy type on
// rejection would import again on React's re-render after the error, in a loop.
const radioModeComponents = {
  dj: lazyWithRetry(loadDjPlayer),
  node: lazyWithRetry(loadNodeRadios),
  single: lazyWithRetry(loadSingleRadio),
};

const radioModeLabels: Record<PlayerMode, string> = {
  dj: "DJ mode",
  node: "Node mode",
  single: "Single mode",
};

function RadioMode({ mode, radios }: { mode: PlayerMode; radios: Radio[] }) {
  const Component = radioModeComponents[mode];
  return <Component radios={radios} />;
}

export function Radios() {
  const radiosQuery = useEnabledRadios();
  const { mode, isReady, hasSettings } = usePlayerModeState();
  const transition = useModeTransitionSnapshot();
  // Another tab can change settings before this tab can load that mode. With
  // no lifecycle active, e.g. after DJ failed to start, render the mode being
  // started rather than the stored one.
  const runningMode =
    transition.currentMode ?? transition.requestedMode ?? mode;

  useEffect(() => {
    if (!hasSettings) {
      return;
    }
    import("@/lib/mode-lifecycle-requests")
      .then(
        ({ modeLifecycleRequests }) =>
          // A legacy mode ("multiple", or one another tab wrote) runs as its
          // replacement. Committing that could fail on the same stale record
          // the settings step could not rewrite and roll the mode back.
          modeLifecycleRequests.synchronizeMode(mode),
        (error) => {
          captureError(error, {
            operation: "loadModeLifecycle",
            surface: "ui",
          });
          throw error;
        }
      )
      .catch((error) => {
        console.error("[radio] Failed to synchronize playback mode:", error);
      });
  }, [mode, hasSettings]);

  if (!(radiosQuery.isReady && isReady)) {
    return <RadioLoadingSkeleton mode={mode} phase="database" />;
  }

  if (transition.error && transition.currentMode === null) {
    return (
      <p className="p-4 text-center text-muted-foreground text-sm">
        Choose another playback mode to keep listening.
      </p>
    );
  }

  const enabledRadios = radiosQuery.data ?? [];

  // Keyed so that choosing another mode leaves a failed one behind.
  return (
    <LazyBoundary key={runningMode} label={radioModeLabels[runningMode]}>
      <Suspense
        fallback={<RadioLoadingSkeleton mode={runningMode} phase="mode" />}
      >
        <RadioMode mode={runningMode} radios={enabledRadios} />
      </Suspense>
    </LazyBoundary>
  );
}
