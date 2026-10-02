import { HeadphonesIcon, Volume2Icon } from "lucide-react";
import { useEffect } from "react";
import { SettingsButton } from "@/components/settings/settings-button";
import { type AudioDeviceInfo, useAudioDevices } from "@/lib/audio";
import { useAudioSettings, useDelaySettings } from "@/lib/hooks/use-settings";
import { getOutputRouting } from "@/lib/output-routing.js";

function resolveDeviceLabel(
  deviceId: string | null,
  outputDevices: AudioDeviceInfo[]
): string {
  if (!deviceId || deviceId === "default") {
    return "System default";
  }
  const device = outputDevices.find((d) => d.deviceId === deviceId);
  return device?.label || "On";
}

/** Where the audio goes, in one line. Click to change it in audio settings. */
export function MixerRouting() {
  const audioSettings = useAudioSettings();
  const delaySettings = useDelaySettings();
  const { outputDevices, refreshDevices } = useAudioDevices();

  const { cueOutputId, mainOutputId: configuredMainOutputId } = audioSettings;

  // Outputs are picked in settings after permission is granted there; the
  // list this component loaded on mount may predate that, so reload it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the chosen outputs change
  useEffect(() => {
    refreshDevices();
  }, [cueOutputId, configuredMainOutputId, refreshDevices]);
  const canResolveDevices =
    getOutputRouting().getSnapshot().sinkSelectionSupported;
  const mainLabel = canResolveDevices
    ? resolveDeviceLabel(configuredMainOutputId ?? "default", outputDevices)
    : "System default";
  let cueLabel = "Cue off";
  if (cueOutputId) {
    cueLabel = canResolveDevices
      ? resolveDeviceLabel(cueOutputId, outputDevices)
      : "System default";
  }
  const delays = [
    `Main delay ${delaySettings.mainDelayMs} ms`,
    cueOutputId ? `cue delay ${delaySettings.cueDelayMs} ms` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <SettingsButton
      defaultTab="audio"
      trigger={
        <button
          className="flex w-full items-center gap-3 rounded-sm text-muted-foreground text-xs hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={`${delays}. Click to change outputs.`}
          type="button"
        >
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <Volume2Icon className="size-3.5 shrink-0" />
            <span className="truncate">{mainLabel}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1">
            <HeadphonesIcon className="size-3.5 shrink-0" />
            <span className="truncate">{cueLabel}</span>
          </span>
        </button>
      }
    />
  );
}
