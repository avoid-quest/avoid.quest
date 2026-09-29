/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { cn } from "@avoid.quest/ui/lib/utils";
import { HeadphonesIcon } from "lucide-react";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
import { useDeckAState, useDeckBState } from "@/lib/hooks/use-deck-state";
import {
  useDeckAPeakLevel,
  useDeckBPeakLevel,
} from "@/lib/stores/dj-runtime-store";
import {
  ChannelSlider,
  snapChannelSliderValue,
} from "../shared/channel-slider";
import {
  formatChannelFilter,
  formatPan,
  formatPercent,
  formatSpeed,
} from "../shared/format-utils";
import { PeakMeter } from "../shared/peak-meter";

type MixerChannelProps = {
  deckId: "deck-a" | "deck-b";
  cueEnabled: boolean;
  isCueActive: boolean;
  onCueChange: (enabled: boolean) => void;
};

const MAX_VOLUME = 1.585;

/**
 * One mixer channel, laid out like a desk: knobs for the set-and-forget
 * controls on top, a long fader with its meter for the level you ride.
 */
export function MixerChannel(props: MixerChannelProps) {
  return props.deckId === "deck-a" ? (
    <MixerChannelA {...props} />
  ) : (
    <MixerChannelB {...props} />
  );
}

function MixerChannelA(props: MixerChannelProps) {
  const deck = useDeckAState();
  const peak = useDeckAPeakLevel();
  return <ChannelBody deck={deck} peak={peak} {...props} />;
}

function MixerChannelB(props: MixerChannelProps) {
  const deck = useDeckBState();
  const peak = useDeckBPeakLevel();
  return <ChannelBody deck={deck} peak={peak} {...props} />;
}

function ChannelBody({
  deckId,
  deck,
  peak,
  cueEnabled,
  isCueActive,
  onCueChange,
}: MixerChannelProps & {
  deck: ReturnType<typeof useDeckAState>;
  peak: { left: number; right: number };
}) {
  const label = deckId === "deck-a" ? "A" : "B";
  const prefix = `${deckId}:`;
  const handleVolume = ([value]: number[]) =>
    deck.setVolume(
      snapChannelSliderValue({
        defaultValue: 1,
        max: MAX_VOLUME,
        min: 0,
        value: value ?? 1,
      })
    );
  const handleCue = () => onCueChange(!cueEnabled);

  return (
    <div className="row-span-4 grid grid-rows-subgrid justify-items-center">
      <span className="font-bold font-mono text-xs">{label}</span>
      <div className="grid grid-cols-2 gap-x-1 gap-y-1">
        <ChannelSlider
          ariaLabel={`Deck ${label} filter`}
          defaultValue={0}
          fillFromDefault
          formatValue={formatChannelFilter}
          label="FILT"
          max={1}
          min={-1}
          onChange={deck.setChannelFilter}
          step={0.01}
          targetId={`${prefix}filter`}
          value={deck.channelFilter}
        />
        <ChannelSlider
          ariaLabel={`Deck ${label} effects mix`}
          defaultValue={1}
          formatValue={formatPercent}
          label="FX"
          max={1}
          min={0}
          onChange={deck.setEffectsDryWet}
          step={0.01}
          targetId={`${prefix}effects-drywet`}
          value={deck.effectsDryWet}
        />
        <ChannelSlider
          ariaLabel={`Deck ${label} pan`}
          defaultValue={0}
          fillFromDefault
          formatValue={formatPan}
          label="PAN"
          max={1}
          min={-1}
          onChange={deck.setPan}
          step={0.01}
          targetId={`${prefix}pan`}
          value={deck.pan}
        />
        <ChannelSlider
          ariaLabel={`Deck ${label} speed`}
          defaultValue={1}
          fillFromDefault
          formatValue={formatSpeed}
          label="SPD"
          max={2}
          min={0.5}
          onChange={deck.setSpeed}
          scale="log"
          step={0.01}
          targetId={`${prefix}speed`}
          value={deck.speed}
        />
      </div>
      <div className="flex min-h-0 items-stretch gap-2">
        <MidiControlWrapper targetId={`${prefix}volume`}>
          <div
            className="flex h-full min-h-0 flex-col items-center gap-1"
            style={{ touchAction: "none" }}
            title="Volume. Double-click the handle for 100%."
          >
            <span className="font-mono text-[10px] tabular-nums">
              {formatPercent(deck.volume)}
            </span>
            <Slider
              aria-label={`Deck ${label} volume`}
              className="min-h-0 flex-1"
              defaultMarkerValue={1}
              defaultValue={[1]}
              max={MAX_VOLUME}
              min={0}
              onValueChange={handleVolume}
              orientation="vertical"
              step={0.01}
              value={[deck.volume]}
              variant="fader"
            />
            <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">
              vol
            </span>
          </div>
        </MidiControlWrapper>
        <div className="flex w-4 py-5">
          <PeakMeter className="w-full" left={peak.left} right={peak.right} />
        </div>
      </div>
      <Button
        aria-pressed={cueEnabled}
        className={cn(
          "h-8 w-full gap-1.5 self-end font-mono text-[10px] uppercase tracking-wider",
          cueEnabled &&
            "ring-2 ring-foreground/30 ring-offset-1 ring-offset-background"
        )}
        disabled={!isCueActive}
        onClick={handleCue}
        size="sm"
        title={
          isCueActive
            ? `Cue ${label} in headphones (${deckId === "deck-a" ? "Q" : "W"})`
            : "Set a cue output in audio settings"
        }
        variant={cueEnabled ? "default" : "outline"}
      >
        <HeadphonesIcon className="size-3.5" />
        cue
      </Button>
    </div>
  );
}
