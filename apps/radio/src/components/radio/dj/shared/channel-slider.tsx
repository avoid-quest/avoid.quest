import { Slider } from "@avoid.quest/ui/components/slider";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";

type ChannelSliderProps = {
  label: string;
  value: number;
  defaultValue?: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
  targetId?: string;
};

export function ChannelSlider({
  label,
  value,
  defaultValue,
  min,
  max,
  step,
  onChange,
  formatValue,
  targetId,
}: ChannelSliderProps) {
  const slider = (
    <div className="flex h-7 items-center gap-2">
      <span className="w-8 shrink-0 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <div className="min-w-0 flex-1" style={{ touchAction: "none" }}>
        <Slider
          defaultValue={defaultValue !== undefined ? [defaultValue] : undefined}
          max={max}
          min={min}
          onValueChange={([v]) => onChange(v)}
          step={step}
          value={[value]}
        />
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
        {formatValue(value)}
      </span>
    </div>
  );

  if (!targetId) {
    return slider;
  }

  return <MidiControlWrapper targetId={targetId}>{slider}</MidiControlWrapper>;
}
