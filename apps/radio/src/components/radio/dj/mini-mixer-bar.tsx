import { Button } from "@avoid.quest/ui/components/button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { Volume2Icon } from "lucide-react";
import { SettingsButton } from "@/components/settings/settings-button";
import { HorizontalPeakMeter } from "./peak-meter";

type MiniMixerBarProps = {
  crossfadePosition: number;
  masterVolume: number;
  isCueActive: boolean;
  deckACueEnabled: boolean;
  deckBCueEnabled: boolean;
  deckAPeakLevel: { left: number; right: number };
  deckBPeakLevel: { left: number; right: number };
  onCrossfadeChange: (position: number) => void;
  onMasterVolumeChange: (volume: number) => void;
  onDeckACueChange: (enabled: boolean) => void;
  onDeckBCueChange: (enabled: boolean) => void;
};

export function MiniMixerBar({
  crossfadePosition,
  masterVolume,
  isCueActive,
  deckACueEnabled,
  deckBCueEnabled,
  deckAPeakLevel,
  deckBPeakLevel,
  onCrossfadeChange,
  onMasterVolumeChange,
  onDeckACueChange,
  onDeckBCueChange,
}: MiniMixerBarProps) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 rounded-lg border bg-card p-2">
      {/* Row 1: Mini VU meters */}
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 text-center font-bold text-[10px]">
          A
        </span>
        <div className="flex-1 space-y-0.5">
          <HorizontalPeakMeter level={deckAPeakLevel.left} />
          <HorizontalPeakMeter level={deckAPeakLevel.right} />
        </div>
        <div className="flex-1 space-y-0.5">
          <HorizontalPeakMeter level={deckBPeakLevel.left} />
          <HorizontalPeakMeter level={deckBPeakLevel.right} />
        </div>
        <span className="w-6 shrink-0 text-center font-bold text-[10px]">
          B
        </span>
      </div>

      {/* Row 2: CUE buttons (if active) + Crossfader + Master vol + Settings */}
      <div className="flex items-center gap-1.5">
        {isCueActive && (
          <Button
            className="h-7 w-12 p-0 font-bold text-[10px]"
            onClick={() => onDeckACueChange(!deckACueEnabled)}
            size="sm"
            variant={deckACueEnabled ? "default" : "outline"}
          >
            CUE A
          </Button>
        )}

        {/* Crossfader */}
        <Slider
          className="h-2 min-w-0 flex-1"
          max={100}
          min={0}
          onValueChange={([v]) => onCrossfadeChange(v / 100)}
          step={1}
          value={[crossfadePosition * 100]}
        />

        {isCueActive && (
          <Button
            className="h-7 w-12 p-0 font-bold text-[10px]"
            onClick={() => onDeckBCueChange(!deckBCueEnabled)}
            size="sm"
            variant={deckBCueEnabled ? "default" : "outline"}
          >
            CUE B
          </Button>
        )}

        {/* Master volume mini-slider */}
        <div className="flex w-20 shrink-0 items-center gap-1">
          <Volume2Icon className="size-3 shrink-0 text-muted-foreground" />
          <Slider
            className="h-2 flex-1"
            max={100}
            min={0}
            onValueChange={([v]) => onMasterVolumeChange(v / 100)}
            step={1}
            value={[masterVolume * 100]}
          />
        </div>

        <SettingsButton defaultTab="audio" />
      </div>
    </div>
  );
}
