/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Slider } from "@avoid.quest/ui/components/slider";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
import { snapChannelSliderValue } from "../shared/channel-slider";

type MixerCrossfaderProps = {
  crossfadePosition: number;
  onCrossfadeChange: (position: number) => void;
};

export function MixerCrossfader({
  crossfadePosition,
  onCrossfadeChange,
}: MixerCrossfaderProps) {
  const handleValueChange = ([value]: number[]) =>
    onCrossfadeChange(
      snapChannelSliderValue({
        defaultValue: 50,
        max: 100,
        min: 0,
        value: value ?? 50,
      }) / 100
    );

  return (
    <MidiControlWrapper targetId="mixer:crossfader">
      <div
        className="flex items-center gap-2"
        title="Crossfader. Double-click the handle to centre."
      >
        <span className="w-3.5 shrink-0 text-center font-bold font-mono text-xs">
          A
        </span>
        <div className="flex-1 py-2" style={{ touchAction: "none" }}>
          <Slider
            aria-label="Crossfader"
            defaultMarkerValue={50}
            defaultValue={[50]}
            max={100}
            min={0}
            onValueChange={handleValueChange}
            size="lg"
            step={1}
            value={[crossfadePosition * 100]}
            variant="fader"
          />
        </div>
        <span className="w-9 shrink-0 text-right font-bold font-mono text-xs">
          B
        </span>
      </div>
    </MidiControlWrapper>
  );
}
