// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { Tabs, TabsList, TabsTrigger } from "@avoid.quest/ui/components/tabs";
import { cn } from "@avoid.quest/ui/lib/utils";
import { AudioLinesIcon, HeadphonesIcon, Volume2Icon } from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { useDeckA, useDeckB, useDjError } from "@/lib/hooks/use-dj-state";
import {
  useDeckAPeakLevel,
  useDeckBPeakLevel,
} from "@/lib/stores/dj-runtime-store";
import { InlineError } from "../inline-error";
import { DeckPanel } from "./deck/deck-panel";
import { snapChannelSliderValue } from "./shared/channel-slider";
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
  const deckA = useDeckA();
  const deckB = useDeckB();
  const djError = useDjError();
  const handleDeckACueChange = () => onDeckACueChange(!deckACueEnabled);
  const handleDeckBCueChange = () => onDeckBCueChange(!deckBCueEnabled);
  const handleCrossfadeChange = ([value]: number[]) =>
    onCrossfadeChange(
      snapChannelSliderValue({
        defaultValue: 50,
        max: 100,
        min: 0,
        value: value ?? 50,
      }) / 100
    );
  const handleMasterVolumeChange = ([value]: number[]) =>
    onMasterVolumeChange((value ?? 0) / 100);
  const handleDeckTabChange = (value: string) =>
    setMobileTab(value === "right" ? "right" : "left");

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 sm:gap-2">
      {/* Mini Mixer Bar */}
      <div className="flex shrink-0 flex-col gap-1 rounded-lg border border-border/50 bg-card/50 p-1.5 sm:gap-1.5 sm:p-2">
        {/* Meters line up over the crossfader track, A left, B right */}
        <div className="flex items-center gap-2 px-7">
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
        </div>

        {/* Crossfader: the big cap, full width */}
        <div
          className="flex items-center gap-2 px-1"
          style={{ touchAction: "none" }}
        >
          <span className="w-4 shrink-0 font-bold font-mono text-xs">A</span>
          <Slider
            aria-label="Crossfader"
            className="py-1"
            defaultMarkerValue={50}
            defaultValue={[50]}
            max={100}
            min={0}
            onValueChange={handleCrossfadeChange}
            size="lg"
            step={1}
            value={[crossfadePosition * 100]}
            variant="fader"
          />
          <span className="w-4 shrink-0 text-right font-bold font-mono text-xs">
            B
          </span>
        </div>

        {/* Cue A | master | cue B, like the desktop mixer */}
        <div className="flex items-center gap-2 px-1">
          {isCueActive ? (
            <Button
              aria-pressed={deckACueEnabled}
              className={cn(
                "shrink-0 gap-1 font-mono text-[10px] uppercase tracking-wider",
                deckACueEnabled &&
                  "ring-2 ring-foreground/30 ring-offset-1 ring-offset-background"
              )}
              onClick={handleDeckACueChange}
              size="sm"
              variant={deckACueEnabled ? "default" : "outline"}
            >
              <HeadphonesIcon className="size-3.5" />A
            </Button>
          ) : null}
          <div
            className="flex min-w-0 flex-1 items-center gap-2"
            style={{ touchAction: "none" }}
          >
            <Volume2Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <Slider
              aria-label="Master volume"
              className="py-1"
              defaultMarkerValue={100}
              defaultValue={[100]}
              max={100}
              min={0}
              onValueChange={handleMasterVolumeChange}
              step={1}
              value={[masterVolume * 100]}
              variant="fader"
            />
            <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums">
              {Math.round(masterVolume * 100)}%
            </span>
          </div>
          {isCueActive ? (
            <Button
              aria-pressed={deckBCueEnabled}
              className={cn(
                "shrink-0 gap-1 font-mono text-[10px] uppercase tracking-wider",
                deckBCueEnabled &&
                  "ring-2 ring-foreground/30 ring-offset-1 ring-offset-background"
              )}
              onClick={handleDeckBCueChange}
              size="sm"
              variant={deckBCueEnabled ? "default" : "outline"}
            >
              <HeadphonesIcon className="size-3.5" />B
            </Button>
          ) : null}
        </div>
      </div>

      {djError?.trim() ? (
        <InlineError className="shrink-0">{djError}</InlineError>
      ) : null}

      {/* Deck tabs */}
      <Tabs onValueChange={handleDeckTabChange} value={mobileTab}>
        <TabsList className="grid w-full shrink-0 grid-cols-2">
          <TabsTrigger
            className="min-w-0 justify-start gap-1.5 text-xs"
            value="left"
          >
            <span className="font-bold font-mono">A</span>
            <span className="truncate">{deckA?.radio?.name ?? "Empty"}</span>
            {deckA?.isPlaying && !deckA.isLoading ? (
              <AudioLinesIcon
                aria-label="Playing"
                className="ml-auto size-3 shrink-0"
              />
            ) : null}
          </TabsTrigger>
          <TabsTrigger
            className="min-w-0 justify-start gap-1.5 text-xs"
            value="right"
          >
            <span className="font-bold font-mono">B</span>
            <span className="truncate">{deckB?.radio?.name ?? "Empty"}</span>
            {deckB?.isPlaying && !deckB.isLoading ? (
              <AudioLinesIcon
                aria-label="Playing"
                className="ml-auto size-3 shrink-0"
              />
            ) : null}
          </TabsTrigger>
        </TabsList>
      </Tabs>

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
