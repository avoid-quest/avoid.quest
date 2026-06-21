import { lazy, Suspense, useEffect } from "react";
import type { Radio } from "@/lib/audio";
import { useEnabledRadios } from "@/lib/hooks/use-radios";
import { useSettings } from "@/lib/hooks/use-settings";
import { modeLifecycleRequests } from "@/lib/mode-lifecycle-requests";

const SingleRadio = lazy(() =>
  import("./single").then((mod) => ({ default: mod.SingleRadio }))
);
const MultipleRadios = lazy(() =>
  import("./multiple").then((mod) => ({ default: mod.MultipleRadios }))
);
const DjPlayer = lazy(() =>
  import("./dj/dj-player").then((mod) => ({ default: mod.DjPlayer }))
);

function RadioMode({
  mode,
  radios,
}: {
  mode: string | undefined;
  radios: Radio[];
}) {
  if (mode === "single") {
    return <SingleRadio radios={radios} />;
  }
  if (mode === "dj") {
    return <DjPlayer radios={radios} />;
  }
  return <MultipleRadios radios={radios} />;
}

export function Radios() {
  const { data: radios } = useEnabledRadios();
  const { data: settings } = useSettings();

  const enabledRadios = radios ?? [];
  const mode = settings?.player.mode;

  useEffect(() => {
    if (!mode) {
      return;
    }
    modeLifecycleRequests.synchronizeMode(mode).catch((error) => {
      console.error("[radio] Failed to synchronize playback mode:", error);
    });
  }, [mode]);

  return (
    <Suspense fallback={null}>
      <RadioMode mode={mode} radios={enabledRadios} />
    </Suspense>
  );
}
