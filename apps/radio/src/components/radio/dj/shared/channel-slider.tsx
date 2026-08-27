// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Slider } from "@avoid.quest/ui/components/slider";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";

const DEFAULT_SNAP_THRESHOLD_RATIO = 0.02;

type ChannelSliderProps = {
  label: string;
  value: number;
  defaultValue?: number;
  fillFromDefault?: boolean;
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
  fillFromDefault = false,
  min,
  max,
  step,
  onChange,
  formatValue,
  targetId,
}: ChannelSliderProps) {
  const handleValueChange = (nextValues: number[]) => {
    const [nextValue = value] = nextValues;

    onChange(
      snapChannelSliderValue({
        defaultValue,
        max,
        min,
        value: nextValue,
      })
    );
  };

  const slider = (
    <div className="flex h-7 items-center gap-2 [@media(pointer:coarse)]:h-10">
      <span className="w-8 shrink-0 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <div className="min-w-0 flex-1" style={{ touchAction: "none" }}>
        <Slider
          defaultMarkerValue={defaultValue}
          defaultValue={defaultValue === undefined ? undefined : [defaultValue]}
          max={max}
          min={min}
          onValueChange={handleValueChange}
          rangeOriginValue={fillFromDefault ? defaultValue : undefined}
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

export function snapChannelSliderValue({
  defaultValue,
  max,
  min,
  thresholdRatio = DEFAULT_SNAP_THRESHOLD_RATIO,
  value,
}: {
  value: number;
  defaultValue?: number;
  min: number;
  max: number;
  thresholdRatio?: number;
}) {
  if (defaultValue === undefined) {
    return value;
  }

  const threshold = Math.abs(max - min) * thresholdRatio;
  if (Math.abs(value - defaultValue) < threshold) {
    return defaultValue;
  }

  return value;
}
