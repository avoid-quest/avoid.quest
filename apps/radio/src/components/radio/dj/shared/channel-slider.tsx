/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Knob } from "@avoid.quest/ui/components/knob";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";

const DEFAULT_SNAP_THRESHOLD_RATIO = 0.02;

type ChannelSliderProps = {
  label: string;
  ariaLabel?: string;
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
  ariaLabel,
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
      snapChannelSliderValue({
        defaultValue,
        max,
        min,
        previousValue: value,
        step,
        value: nextValue,
      })
    );
  };

  const knob = (
    <Knob
      ariaLabel={ariaLabel}
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

/**
 * Snaps a value near `defaultValue` onto it, so a drag finds the centre.
 * A move of one `step` or less from `previousValue` (an arrow key) is left
 * alone, or a keyboard could never leave the default.
 */
export function snapChannelSliderValue({
  defaultValue,
  max,
  min,
  previousValue,
  step,
  thresholdRatio = DEFAULT_SNAP_THRESHOLD_RATIO,
  value,
}: {
  value: number;
  defaultValue?: number;
  min: number;
  max: number;
  previousValue?: number;
  step?: number;
  thresholdRatio?: number;
}) {
  if (defaultValue === undefined) {
    return value;
  }
  if (
    previousValue !== undefined &&
    step !== undefined &&
    Math.abs(value - previousValue) <= step + Number.EPSILON * 16
  ) {
    return value;
  }

  const threshold = Math.abs(max - min) * thresholdRatio;
  if (Math.abs(value - defaultValue) < threshold) {
    return defaultValue;
  }

  return value;
}
