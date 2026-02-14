import { Button } from "@avoid.quest/ui/components/button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Volume2Icon } from "lucide-react";
import { useState } from "react";
import { SettingsButton } from "@/components/settings/settings-button";
import type { Radio } from "@/lib/audio";
import {
  useDeckAPeakLevel,
  useDeckBPeakLevel,
} from "@/lib/stores/dj-runtime-store";
import { DeckPanel } from "./deck/deck-panel";
import { PeakMeter } from "./shared/peak-meter";

type DjConsoleMobileProps = {
  radios: Radio[];
  crossfadePosition: number;
  masterVolume: number;
  deckACueEnabled: boolean;
  deckBCueEnabled: boolean;
  isCueActive: boolean;
  onCrossfadeChange: (position: number) => void;
  onMasterVolumeChange: (volume: number) => void;
  onDeckACueChange: (enabled: boolean) => void;
  onDeckBCueChange: (enabled: boolean) => void;
};

export function DjConsoleMobile({
  radios,
  crossfadePosition,
  masterVolume,
  deckACueEnabled,
  deckBCueEnabled,
  isCueActive,
  onCrossfadeChange,
  onMasterVolumeChange,
  onDeckACueChange,
  onDeckBCueChange,
}: DjConsoleMobileProps) {
  const [mobileTab, setMobileTab] = useState<"left" | "right">("left");
  const deckAPeakLevel = useDeckAPeakLevel();
  const deckBPeakLevel = useDeckBPeakLevel();

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 sm:gap-2">
      {/* Mini Mixer Bar */}
      <div className="flex shrink-0 flex-col gap-1 rounded-lg border border-border/50 bg-card/50 p-1.5 sm:gap-1.5 sm:p-2">
        {/* VU meters row */}
        <div className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-center font-bold font-mono text-[10px]">
            A
          </span>
          <PeakMeter
            className="flex-1"
            compact={true}
            left={deckAPeakLevel.left}
            orientation="horizontal"
            right={deckAPeakLevel.right}
          />
          <PeakMeter
            className="flex-1"
            compact={true}
            left={deckBPeakLevel.left}
            orientation="horizontal"
            right={deckBPeakLevel.right}
          />
          <span className="w-5 shrink-0 text-center font-bold font-mono text-[10px]">
            B
          </span>
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-1.5">
          {isCueActive && (
            <Button
              className="h-6 w-11 p-0 font-bold font-mono text-[9px]"
              onClick={() => onDeckACueChange(!deckACueEnabled)}
              size="sm"
              variant={deckACueEnabled ? "default" : "outline"}
            >
              CUE A
            </Button>
          )}

          <div className="min-w-0 flex-1" style={{ touchAction: "none" }}>
            <Slider
              className="h-2"
              max={100}
              min={0}
              onValueChange={([v]) => onCrossfadeChange(v / 100)}
              step={1}
              value={[crossfadePosition * 100]}
            />
          </div>

          {isCueActive && (
            <Button
              className="h-6 w-11 p-0 font-bold font-mono text-[9px]"
              onClick={() => onDeckBCueChange(!deckBCueEnabled)}
              size="sm"
              variant={deckBCueEnabled ? "default" : "outline"}
            >
              CUE B
            </Button>
          )}

          <div className="flex w-20 shrink-0 items-center gap-1">
            <Volume2Icon className="size-3 shrink-0 text-muted-foreground" />
            <div className="flex-1" style={{ touchAction: "none" }}>
              <Slider
                className="h-2"
                max={100}
                min={0}
                onValueChange={([v]) => onMasterVolumeChange(v / 100)}
                step={1}
                value={[masterVolume * 100]}
              />
            </div>
          </div>

          <SettingsButton defaultTab="audio" />
        </div>
      </div>

      {/* Deck tabs */}
      <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-muted p-0.5">
        <Button
          className="h-7 w-full font-mono text-xs"
          onClick={() => setMobileTab("left")}
          size="sm"
          variant={mobileTab === "left" ? "default" : "ghost"}
        >
          Deck A
        </Button>
        <Button
          className="h-7 w-full font-mono text-xs"
          onClick={() => setMobileTab("right")}
          size="sm"
          variant={mobileTab === "right" ? "default" : "ghost"}
        >
          Deck B
        </Button>
      </div>

      {/* Deck content */}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className={cn("h-full min-w-0")}>
          {mobileTab === "left" ? (
            <DeckPanel deckId="deck-a" key="deck-a" radios={radios} />
          ) : (
            <DeckPanel deckId="deck-b" key="deck-b" radios={radios} />
          )}
        </div>
      </div>
    </div>
  );
}
