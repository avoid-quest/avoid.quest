import { Card, CardContent } from "@avoid.quest/ui/components/card";
import { Slider } from "@avoid.quest/ui/components/slider";
import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Volume2Icon } from "lucide-react";
import type { Radio } from "@/lib/audio";
import { useDjError } from "@/lib/hooks/use-dj-state";
import { DjRadioList } from "./dj-radio-list";

type DjMixerProps = {
  className?: string;
  radios?: Radio[];
  crossfadePosition: number;
  masterVolume: number;
  onCrossfadeChange: (position: number) => void;
  onMasterVolumeChange: (volume: number) => void;
};

/**
 * Center mixer panel with crossfader, master volume, and radio list.
 */
export function DjMixer({
  className,
  radios = [],
  crossfadePosition,
  masterVolume,
  onCrossfadeChange,
  onMasterVolumeChange,
}: DjMixerProps) {
  const error = useDjError();
  const isMobile = useIsMobile();

  return (
    <Card className={cn("flex h-full min-h-0 w-full flex-col", className)}>
      <CardContent className="flex h-full min-h-0 flex-col gap-4 p-4">
        {/* Crossfader */}
        <div className="flex items-center gap-3">
          <span className="shrink-0 font-bold text-primary text-sm">A</span>
          <div className="relative flex-1">
            <Slider
              className="h-3"
              max={100}
              min={0}
              onValueChange={([v]) => onCrossfadeChange(v / 100)}
              step={1}
              value={[crossfadePosition * 100]}
            />
            {/* Center indicator */}
            <div className="pointer-events-none absolute top-1/2 left-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/50" />
          </div>
          <span className="shrink-0 font-bold text-primary text-sm">B</span>
        </div>

        {/* Master Volume */}
        <div className="flex items-center gap-2">
          <Volume2Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-muted-foreground text-xs">Master</span>
          <Slider
            className="h-2 flex-1"
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

        {/* Divider */}
        <div className="h-px bg-border" />

        {/* Radio List Section - Hidden on mobile */}
        {!isMobile && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <DjRadioList radios={radios} />
          </div>
        )}

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
