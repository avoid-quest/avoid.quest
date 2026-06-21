import { lazy, type ReactElement, Suspense, useEffect } from "react";
import type { Radio } from "@/lib/audio";
import {
  PLAYBACK_SESSION_IDS,
  type PlaybackSessionId,
} from "@/lib/collections/playback-sessions";
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

const DEFAULT_RADIO_MODE: PlaybackSessionId = "multiple";

type RadioModeRenderer = (radios: Radio[]) => ReactElement;

const radioModeRenderers = {
  single: (radios) => <SingleRadio radios={radios} />,
  multiple: (radios) => <MultipleRadios radios={radios} />,
  dj: (radios) => <DjPlayer radios={radios} />,
} satisfies Record<PlaybackSessionId, RadioModeRenderer>;

function RadioMode({
  mode,
  radios,
}: {
  mode: PlaybackSessionId;
  radios: Radio[];
}) {
  return radioModeRenderers[mode](radios);
}

function getConfiguredMode(mode: unknown): PlaybackSessionId | undefined {
  return isPlaybackSessionId(mode) ? mode : undefined;
}

function isPlaybackSessionId(mode: unknown): mode is PlaybackSessionId {
  return (
    typeof mode === "string" &&
    PLAYBACK_SESSION_IDS.some((sessionId) => sessionId === mode)
  );
}

export function Radios() {
  const { data: radios } = useEnabledRadios();
  const { data: settings } = useSettings();

  const enabledRadios = radios ?? [];
  const configuredMode = getConfiguredMode(settings?.player.mode);
  const mode = configuredMode ?? DEFAULT_RADIO_MODE;

  useEffect(() => {
    if (!configuredMode) {
      return;
    }
    modeLifecycleRequests.synchronizeMode(configuredMode).catch((error) => {
      console.error("[radio] Failed to synchronize playback mode:", error);
    });
  }, [configuredMode]);

  return (
    <Suspense fallback={null}>
      <RadioMode mode={mode} radios={enabledRadios} />
    </Suspense>
  );
}
