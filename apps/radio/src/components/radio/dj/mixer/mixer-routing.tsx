import { Badge } from "@avoid.quest/ui/components/badge";
import { ClockIcon, HeadphonesIcon, Volume2Icon } from "lucide-react";
import { SettingsButton } from "@/components/settings/settings-button";
import {
  type AudioDeviceInfo,
  isSinkIdSupported,
  useAudioDevices,
} from "@/lib/audio";
import { useAudioSettings, useDelaySettings } from "@/lib/hooks/use-settings";

function resolveDeviceLabel(
  deviceId: string | null,
  outputDevices: AudioDeviceInfo[]
): string {
  if (!deviceId || deviceId === "default") {
    return "System Default";
  }
  const device = outputDevices.find((d) => d.deviceId === deviceId);
  return device?.label || "Unknown Device";
}

export function MixerRouting() {
  const audioSettings = useAudioSettings();
  const delaySettings = useDelaySettings();
  const { outputDevices } = useAudioDevices();

  const mainOutputId = audioSettings.mainOutputId ?? "default";
  const cueOutputId = audioSettings.cueOutputId;
  const canResolveDevices = isSinkIdSupported();

  const mainLabel = canResolveDevices
    ? resolveDeviceLabel(mainOutputId, outputDevices)
    : "System Default";
  const isDualMode = !!cueOutputId;
  const resolvedCueLabel = canResolveDevices
    ? resolveDeviceLabel(cueOutputId, outputDevices)
    : "System Default";
  const cueLabel = isDualMode ? resolvedCueLabel : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
          Output Routing
        </span>
        <SettingsButton className="size-6 rounded-sm" defaultTab="audio" />
      </div>

      {/* Main output */}
      <div className="space-y-0.5 rounded-md border border-border/50 bg-muted/30 p-2">
        <div className="flex items-center gap-1.5">
          <Volume2Icon className="size-3 shrink-0 text-muted-foreground" />
          <span className="font-medium text-[11px] text-muted-foreground">
            Main
          </span>
        </div>
        <p className="truncate text-xs leading-none">{mainLabel}</p>
        <div className="flex items-center gap-1 text-muted-foreground">
          <ClockIcon className="size-2.5 shrink-0" />
          <span className="font-mono text-[10px] leading-none">
            {delaySettings.mainDelayMs}ms
          </span>
        </div>
      </div>

      {/* CUE output */}
      <div className="space-y-0.5 rounded-md border border-border/50 bg-muted/30 p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <HeadphonesIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="font-medium text-[11px] text-muted-foreground">
              CUE
            </span>
          </div>
          {isDualMode ? (
            <Badge className="h-4 border-emerald-500/20 bg-emerald-500/10 px-1.5 text-[9px] text-emerald-500">
              Active
            </Badge>
          ) : (
            <Badge className="h-4 px-1.5 text-[9px]" variant="outline">
              Off
            </Badge>
          )}
        </div>
        {isDualMode ? (
          <>
            <p className="truncate text-xs leading-none">{cueLabel}</p>
            <div className="flex items-center gap-1 text-muted-foreground">
              <ClockIcon className="size-2.5 shrink-0" />
              <span className="font-mono text-[10px] leading-none">
                {delaySettings.cueDelayMs}ms
              </span>
            </div>
          </>
        ) : (
          <p className="truncate text-muted-foreground text-xs leading-none">
            Not configured
          </p>
        )}
      </div>
    </div>
  );
}
