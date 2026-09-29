/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Slider } from "@avoid.quest/ui/components/slider";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
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
import { useDeckContext } from "./deck-context";

const MAX_VOLUME = 1.585;

/**
 * Channel controls inside a deck (used on phones and device-input decks,
 * where there is no mixer column). Volume is a fader; the rest are knobs.
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
  const handleVolume = ([value]: number[]) =>
    setVolume(
      snapChannelSliderValue({
        defaultValue: 1,
        max: MAX_VOLUME,
        min: 0,
        value: value ?? 1,
      })
    );

  return (
    <div className={className}>
      <MidiControlWrapper targetId={`${prefix}volume`}>
        <div className="flex h-7 items-center gap-2 [@media(pointer:coarse)]:h-10">
          <span className="w-8 shrink-0 font-mono text-[9px] text-muted-foreground uppercase tracking-wider">
            vol
          </span>
          <div className="min-w-0 flex-1" style={{ touchAction: "none" }}>
            <Slider
              aria-label="Volume"
              defaultMarkerValue={1}
              defaultValue={[1]}
              max={MAX_VOLUME}
              min={0}
              onValueChange={handleVolume}
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
        <ChannelSlider
          defaultValue={0}
          fillFromDefault
          formatValue={formatPan}
          label="PAN"
          max={1}
          min={-1}
          onChange={setPan}
          step={0.01}
          targetId={`${prefix}pan`}
          value={pan}
        />
        <ChannelSlider
          defaultValue={1}
          fillFromDefault
          formatValue={formatSpeed}
          label="SPD"
          max={2}
          min={0.5}
          onChange={setSpeed}
          scale="log"
          step={0.01}
          targetId={`${prefix}speed`}
          value={speed}
        />
      </div>
    </div>
  );
}
