/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Knob } from "@avoid.quest/ui/components/knob";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";

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
  const knob = (
    <Knob
      ariaLabel={ariaLabel}
      bipolar={fillFromDefault}
      defaultValue={defaultValue}
      format={formatValue}
      label={label}
      max={max}
      min={min}
      onChange={onChange}
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
