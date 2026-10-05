import { lazy, type ReactElement, Suspense, useEffect } from "react";
import type { Radio } from "@/lib/audio";
import { useEnabledRadios } from "@/lib/hooks/use-radios";
import { useSettings } from "@/lib/hooks/use-settings";
import {
  normalizePlayerMode,
  type PlayerMode,
} from "@/lib/normalize-player-mode";
import { RadioLoadingSkeleton } from "./radio-loading-skeleton";
import {
  loadDjPlayer,
  loadNodeRadios,
  loadSingleRadio,
} from "./radio-mode-loader";

const SingleRadio = lazy(loadSingleRadio);
const NodeRadios = lazy(loadNodeRadios);
const DjPlayer = lazy(loadDjPlayer);

type RadioModeRenderer = (radios: Radio[]) => ReactElement;

const radioModeRenderers = {
  dj: (radios) => <DjPlayer radios={radios} />,
  node: (radios) => <NodeRadios radios={radios} />,
  single: (radios) => <SingleRadio radios={radios} />,
} satisfies Record<PlayerMode, RadioModeRenderer>;

function RadioMode({ mode, radios }: { mode: PlayerMode; radios: Radio[] }) {
  return radioModeRenderers[mode](radios);
}

export function Radios() {
  const radiosQuery = useEnabledRadios();
  const settingsQuery = useSettings();
  const storedMode: unknown = settingsQuery.data?.player.mode;
  const mode = normalizePlayerMode(storedMode);

  useEffect(() => {
    if (storedMode === undefined) {
      return;
    }
    import("@/lib/mode-lifecycle-requests")
      .then(({ modeLifecycleRequests }) =>
        // A legacy mode ("multiple", or one another tab wrote) runs as its
        // replacement. Committing that could fail on the same stale record
        // the settings step could not rewrite and roll the mode back.
        modeLifecycleRequests.synchronizeMode(mode)
      )
      .catch((error) => {
        console.error("[radio] Failed to synchronize playback mode:", error);
      });
  }, [mode, storedMode]);

  if (!(radiosQuery.isReady && settingsQuery.isReady)) {
    return <RadioLoadingSkeleton mode={mode} phase="database" />;
  }

  const enabledRadios = radiosQuery.data ?? [];

  return (
    <Suspense fallback={<RadioLoadingSkeleton mode={mode} phase="mode" />}>
      <RadioMode mode={mode} radios={enabledRadios} />
    </Suspense>
  );
}
