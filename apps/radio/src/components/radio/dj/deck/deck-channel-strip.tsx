import { ChannelSlider } from "../shared/channel-slider";
import {
  formatChannelFilter,
  formatPan,
  formatPercent,
  formatSpeed,
} from "../shared/format-utils";
import { useDeckContext } from "./deck-context";

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

  const prefix = deckId ? `${deckId}:` : "";

  return (
    <div className={className}>
      <div className="space-y-1">
        <ChannelSlider
          defaultValue={1}
          formatValue={formatPercent}
          label="VOL"
          max={1.585}
          min={0}
          onChange={setVolume}
          step={0.01}
          targetId={prefix ? `${prefix}volume` : undefined}
          value={volume}
        />
        <ChannelSlider
          defaultValue={0}
          fillFromDefault={true}
          formatValue={formatPan}
          label="PAN"
          max={1}
          min={-1}
          onChange={setPan}
          step={0.01}
          targetId={prefix ? `${prefix}pan` : undefined}
          value={pan}
        />
        <ChannelSlider
          defaultValue={0}
          fillFromDefault={true}
          formatValue={formatChannelFilter}
          label="FILT"
          max={1}
          min={-1}
          onChange={setChannelFilter}
          step={0.01}
          targetId={prefix ? `${prefix}filter` : undefined}
          value={channelFilter}
        />
        <ChannelSlider
          defaultValue={1}
          fillFromDefault={true}
          formatValue={formatSpeed}
          label="SPD"
          max={2.0}
          min={0.5}
          onChange={setSpeed}
          step={0.01}
          targetId={prefix ? `${prefix}speed` : undefined}
          value={speed}
        />
        <ChannelSlider
          defaultValue={0}
          formatValue={formatPercent}
          label="FX"
          max={1}
          min={0}
          onChange={setEffectsDryWet}
          step={0.01}
          targetId={prefix ? `${prefix}effects-drywet` : undefined}
          value={effectsDryWet}
        />
      </div>
    </div>
  );
}
