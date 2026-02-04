import { Badge } from "@avoid.quest/ui/components/badge";
import { Card, CardContent } from "@avoid.quest/ui/components/card";
import { Slider } from "@avoid.quest/ui/components/slider";
import { cn } from "@avoid.quest/ui/lib/utils";
import { ClockIcon, HeadphonesIcon, Volume2Icon } from "lucide-react";
import { SettingsButton } from "@/components/settings/settings-button";
import {
  type AudioDeviceInfo,
  isSinkIdSupported,
  useAudioDevices,
} from "@/lib/audio";
import { useDjError } from "@/lib/hooks/use-dj-state";
import { useAudioSettings, useDelaySettings } from "@/lib/hooks/use-settings";
import { CueControls } from "./cue-controls";
import { HorizontalPeakMeter } from "./peak-meter";

type DjMixerProps = {
  className?: string;
  crossfadePosition: number;
  masterVolume: number;
  headphoneVolume: number;
  isCueActive: boolean;
  deckACueEnabled: boolean;
  deckBCueEnabled: boolean;
  deckAPeakLevel?: { left: number; right: number };
  deckBPeakLevel?: { left: number; right: number };
  onCrossfadeChange: (position: number) => void;
  onMasterVolumeChange: (volume: number) => void;
  onHeadphoneVolumeChange: (volume: number) => void;
  onDeckACueChange: (enabled: boolean) => void;
  onDeckBCueChange: (enabled: boolean) => void;
};

/**
 * Center mixer panel with crossfader, master volume, master VU, CUE controls, and audio quick-access.
 */
export function DjMixer({
  className,
  crossfadePosition,
  masterVolume,
  headphoneVolume,
  isCueActive,
  deckACueEnabled,
  deckBCueEnabled,
  deckAPeakLevel,
  deckBPeakLevel,
  onCrossfadeChange,
  onMasterVolumeChange,
  onHeadphoneVolumeChange,
  onDeckACueChange,
  onDeckBCueChange,
}: DjMixerProps) {
  const error = useDjError();

  // Compute combined master peak (max of both decks, scaled by master volume)
  const masterPeakLeft = Math.min(
    1,
    Math.max(deckAPeakLevel?.left ?? 0, deckBPeakLevel?.left ?? 0) *
      masterVolume
  );
  const masterPeakRight = Math.min(
    1,
    Math.max(deckAPeakLevel?.right ?? 0, deckBPeakLevel?.right ?? 0) *
      masterVolume
  );

  return (
    <Card className={cn("flex h-full min-h-0 w-full flex-col", className)}>
      <CardContent className="flex h-full min-h-0 flex-col gap-4 p-4">
        {/* Master VU — horizontal stereo peak meters */}
        <div className="space-y-1">
          <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
            Master
          </span>
          <div className="space-y-0.5">
            <HorizontalPeakMeter level={masterPeakLeft} />
            <HorizontalPeakMeter level={masterPeakRight} />
          </div>
        </div>

        {/* Crossfader */}
        <div className="flex items-center gap-3">
          <span className="shrink-0 font-bold text-blue-500 text-sm">A</span>
          <div className="relative flex-1">
            <Slider
              className="h-3"
              defaultValue={[50]}
              max={100}
              min={0}
              onValueChange={([v]) => onCrossfadeChange(v / 100)}
              step={1}
              value={[crossfadePosition * 100]}
            />
            {/* Center indicator */}
            <div className="pointer-events-none absolute top-1/2 left-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/50" />
          </div>
          <span className="shrink-0 font-bold text-amber-500 text-sm">B</span>
        </div>

        {/* Master Volume */}
        <div className="flex items-center gap-2">
          <Volume2Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-muted-foreground text-xs">Master</span>
          <Slider
            className="h-2 flex-1"
            defaultValue={[100]}
            max={100}
            min={0}
            onValueChange={([v]) => onMasterVolumeChange(v / 100)}
            step={1}
            value={[masterVolume * 100]}
          />
          <span className="w-9 shrink-0 text-right font-mono text-muted-foreground text-xs">
            {Math.round(masterVolume * 100)}%
          </span>
        </div>

        {/* Headphone Volume — only when CUE output is configured */}
        {isCueActive && (
          <div className="flex items-center gap-2">
            <HeadphonesIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-muted-foreground text-xs">
              Phones
            </span>
            <Slider
              className="h-2 flex-1"
              defaultValue={[100]}
              max={100}
              min={0}
              onValueChange={([v]) => onHeadphoneVolumeChange(v / 100)}
              step={1}
              value={[headphoneVolume * 100]}
            />
            <span className="w-9 shrink-0 text-right font-mono text-muted-foreground text-xs">
              {Math.round(headphoneVolume * 100)}%
            </span>
          </div>
        )}

        {/* CUE Controls */}
        {isCueActive ? (
          <CueControls
            deckACueEnabled={deckACueEnabled}
            deckBCueEnabled={deckBCueEnabled}
            onDeckACueChange={onDeckACueChange}
            onDeckBCueChange={onDeckBCueChange}
          />
        ) : (
          <p className="text-center text-[10px] text-muted-foreground">
            Enable CUE output in audio settings
          </p>
        )}

        {/* Divider */}
        <div className="h-px bg-border" />

        {/* Audio Routing Status + Settings — pushed to bottom */}
        <div className="mt-auto">
          <AudioRoutingStatus />
        </div>

        {/* Status Indicators */}
        {!!error?.trim() && (
          <div className="rounded-md bg-destructive/10 p-3 text-center">
            <div className="font-medium text-destructive text-sm">Error</div>
            <div className="text-destructive text-xs">{error}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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

function AudioRoutingStatus() {
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
      {/* Section header with integrated settings gear */}
      <div className="flex items-center justify-between">
        <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
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
