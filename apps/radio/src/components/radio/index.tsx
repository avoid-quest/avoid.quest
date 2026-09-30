import { lazy, type ReactElement, Suspense, useEffect } from "react";
import type { Radio } from "@/lib/audio";
import type { SettingsRecord } from "@/lib/collections/settings";
import { useEnabledRadios } from "@/lib/hooks/use-radios";
import { useSettings } from "@/lib/hooks/use-settings";
import { RadioLoadingSkeleton } from "./radio-loading-skeleton";
import {
  loadDjPlayer,
  loadMultipleRadios,
  loadNodeRadios,
  loadSingleRadio,
} from "./radio-mode-loader";

type RadioMode = SettingsRecord["player"]["mode"];

// Node is registered but not yet offered in ModeSelect.
const RADIO_MODES: RadioMode[] = ["single", "multiple", "node", "dj"];

const SingleRadio = lazy(loadSingleRadio);
const MultipleRadios = lazy(loadMultipleRadios);
const NodeRadios = lazy(loadNodeRadios);
const DjPlayer = lazy(loadDjPlayer);

const DEFAULT_RADIO_MODE: RadioMode = "single";

type RadioModeRenderer = (radios: Radio[]) => ReactElement;

const radioModeRenderers = {
  dj: (radios) => <DjPlayer radios={radios} />,
  multiple: (radios) => <MultipleRadios radios={radios} />,
  node: (radios) => <NodeRadios radios={radios} />,
  single: (radios) => <SingleRadio radios={radios} />,
} satisfies Record<RadioMode, RadioModeRenderer>;

function RadioMode({ mode, radios }: { mode: RadioMode; radios: Radio[] }) {
  return radioModeRenderers[mode](radios);
}

function getConfiguredMode(mode: unknown): RadioMode | undefined {
  return isRadioMode(mode) ? mode : undefined;
}

function isRadioMode(mode: unknown): mode is RadioMode {
  return (
    typeof mode === "string" &&
    RADIO_MODES.some((radioMode) => radioMode === mode)
  );
}

export function Radios() {
  const radiosQuery = useEnabledRadios();
  const settingsQuery = useSettings();
  const configuredMode = getConfiguredMode(settingsQuery.data?.player.mode);
  const mode = configuredMode ?? DEFAULT_RADIO_MODE;

  useEffect(() => {
    if (!configuredMode) {
      return;
    }
    import("@/lib/mode-lifecycle-requests")
      .then(({ modeLifecycleRequests }) =>
        modeLifecycleRequests.synchronizeMode(configuredMode)
      )
      .catch((error) => {
        console.error("[radio] Failed to synchronize playback mode:", error);
      });
  }, [configuredMode]);

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
