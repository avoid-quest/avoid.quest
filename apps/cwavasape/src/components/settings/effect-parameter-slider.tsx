import { Label } from "@avoid.quest/ui/components/label";
import { Slider } from "@avoid.quest/ui/components/slider";

type EffectParameterSliderProps = {
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  disabled?: boolean;
};

export function EffectParameterSlider({
  label,
  value,
  defaultValue,
  min,
  max,
  step,
  onChange,
  formatValue = (v) => v.toFixed(2),
  disabled = false,
}: EffectParameterSliderProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-muted-foreground text-xs">{label}</Label>
        <span className="text-muted-foreground text-xs tabular-nums">
          {formatValue(value)}
        </span>
      </div>
      <Slider
        defaultValue={[defaultValue]}
        disabled={disabled}
        max={max}
        min={min}
        onValueChange={([v]) => {
          if (v !== undefined) {
            onChange(v);
          }
        }}
        step={step}
        value={[value]}
      />
    </div>
  );
}
