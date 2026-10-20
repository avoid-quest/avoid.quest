import { captureError } from "@avoid.quest/error";
import {
  type ComponentType,
  type LazyExoticComponent,
  lazy,
  Suspense,
  useEffect,
} from "react";
import type { Radio } from "@/lib/audio";
import { useEnabledRadios } from "@/lib/hooks/use-radios";
import { usePlayerModeState } from "@/lib/hooks/use-settings";
import type { PlayerMode } from "@/lib/normalize-player-mode";
import { RadioLoadingSkeleton } from "./radio-loading-skeleton";
import {
  loadDjPlayer,
  loadNodeRadios,
  loadSingleRadio,
} from "./radio-mode-loader";

function createLazyMode(
  mode: PlayerMode,
  load: typeof loadSingleRadio
): LazyExoticComponent<ComponentType<{ radios?: Radio[] }>> {
  return lazy(() =>
    load().catch((error: unknown) => {
      // React.lazy caches rejections too. A boundary reset needs a fresh type.
      radioModeComponents[mode] = createLazyMode(mode, load);
      throw error;
    })
  );
}

const radioModeComponents = {
  dj: createLazyMode("dj", loadDjPlayer),
  node: createLazyMode("node", loadNodeRadios),
  single: createLazyMode("single", loadSingleRadio),
};

function RadioMode({ mode, radios }: { mode: PlayerMode; radios: Radio[] }) {
  const Component = radioModeComponents[mode];
  return <Component radios={radios} />;
}

export function Radios() {
  const radiosQuery = useEnabledRadios();
  const { mode, isReady, hasSettings } = usePlayerModeState();

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

  const enabledRadios = radiosQuery.data ?? [];

  return (
    <Suspense fallback={<RadioLoadingSkeleton mode={mode} phase="mode" />}>
      <RadioMode mode={mode} radios={enabledRadios} />
    </Suspense>
  );
}
