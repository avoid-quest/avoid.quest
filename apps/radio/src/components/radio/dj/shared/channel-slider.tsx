/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Knob } from "@avoid.quest/ui/components/knob";
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
  scale?: "linear" | "log";
};

/** One channel control: a knob with a MIDI-learnable target. */
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
  scale,
}: ChannelSliderProps) {
  const handleChange = (nextValue: number) => {
    onChange(
      snapChannelSliderValue({ defaultValue, max, min, value: nextValue })
    );
  };

  const knob = (
    <Knob
      bipolar={fillFromDefault}
      defaultValue={defaultValue}
      format={formatValue}
      label={label}
      max={max}
      min={min}
      onChange={handleChange}
      scale={scale}
      size={36}
      step={step}
      value={value}
    />
  );

  if (!targetId) {
    return knob;
  }

  return <MidiControlWrapper targetId={targetId}>{knob}</MidiControlWrapper>;
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
