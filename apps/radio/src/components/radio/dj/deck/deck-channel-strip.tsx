/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Slider } from "@avoid.quest/ui/components/slider";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
import { StripPanKnob, StripSpeedKnob } from "../../node/source-strip";
import { ChannelSlider } from "../shared/channel-slider";
import { formatChannelFilter, formatPercent } from "../shared/format-utils";
import { useDeckContext } from "./deck-context";

const MAX_VOLUME = 1.585;

/**
 * Channel controls inside a deck (used on phones and device-input decks,
 * where there is no mixer column). Volume is a fader; the rest are knobs.
 * Pan and speed are the shared source strip's knobs, as a Node source's.
 */
export function DeckChannelStrip({ className }: { className?: string }) {
  const {
    volume,
    pan,
    speed,
    channelFilter,
    effectsDryWet,
    deckId,
    setVolume,
    setPan,
    setSpeed,
    setChannelFilter,
    setEffectsDryWet,
  } = useDeckContext();

  const prefix = `${deckId}:`;
  const deckLabel = deckId === "deck-a" ? "A" : "B";
  const handleVolume = ([value]: number[]) => setVolume(value ?? 1);

  return (
    <div className={className}>
      <MidiControlWrapper targetId={`${prefix}volume`}>
        <div className="flex h-7 items-center gap-2 [@media(pointer:coarse)]:h-10">
          <span className="w-8 shrink-0 font-mono text-[9px] text-muted-foreground uppercase tracking-wider">
            vol
          </span>
          <div className="min-w-0 flex-1" style={{ touchAction: "none" }}>
            <Slider
              aria-label={`Deck ${deckLabel} volume`}
              defaultMarkerValue={1}
              defaultValue={[1]}
              max={MAX_VOLUME}
              min={0}
              onValueChange={handleVolume}
              snapToDefault
              step={0.01}
              value={[volume]}
              variant="fader"
            />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums">
            {formatPercent(volume)}
          </span>
        </div>
      </MidiControlWrapper>
      <div className="flex items-start justify-around pt-1">
        <ChannelSlider
          ariaLabel={`Deck ${deckLabel} filter`}
          defaultValue={0}
          fillFromDefault
          formatValue={formatChannelFilter}
          label="FILT"
          max={1}
          min={-1}
          onChange={setChannelFilter}
          step={0.01}
          targetId={`${prefix}filter`}
          value={channelFilter}
        />
        <ChannelSlider
          ariaLabel={`Deck ${deckLabel} effects mix`}
          defaultValue={1}
          formatValue={formatPercent}
          label="FX"
          max={1}
          min={0}
          onChange={setEffectsDryWet}
          step={0.01}
          targetId={`${prefix}effects-drywet`}
          value={effectsDryWet}
        />
        <StripPanKnob
          ariaLabel={`Deck ${deckLabel} pan`}
          label="PAN"
          onChange={setPan}
          targetId={`${prefix}pan`}
          value={pan}
        />
        <StripSpeedKnob
          ariaLabel={`Deck ${deckLabel} speed`}
          label="SPD"
          onChange={setSpeed}
          targetId={`${prefix}speed`}
          value={speed}
        />
      </div>
    </div>
  );
}
