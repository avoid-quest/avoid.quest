import { Label } from "@workspace/ui/components/label";
import { Slider } from "@workspace/ui/components/slider";
import { formatParam, type ParamFormatter } from "./param-definitions";

type ParamSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  formatter?: ParamFormatter;
  formatKey?: string;
  defaultValue?: number;
};

export function ParamSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  disabled = false,
  onChange,
  formatter,
  formatKey = "default",
  defaultValue,
}: ParamSliderProps) {
  const displayValue = formatter
    ? formatter(value)
    : formatParam(formatKey, value, formatter);

  const defaultValueArray =
    defaultValue?.valueOf() !== undefined ? [defaultValue] : undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="font-mono text-muted-foreground text-xs">
          {displayValue}
        </span>
      </div>
      <Slider
        className="w-full"
        defaultValue={defaultValueArray}
        disabled={disabled}
        max={max}
        min={min}
        onValueChange={(values) => {
          const newValue = values[0];
          if (newValue !== undefined) {
            onChange(newValue);
          }
        }}
        step={step}
        value={[value]}
      />
    </div>
  );
}
