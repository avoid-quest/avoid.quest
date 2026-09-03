import { Label } from "@avoid.quest/ui/components/label";
import { Slider } from "@avoid.quest/ui/components/slider";
import { useThrottledParam } from "@/lib/hooks/use-throttled-param";
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
  /** Tooltip description shown on hover */
  description?: string;
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
  description,
}: ParamSliderProps) {
  // Throttle onChange to ~30fps to prevent overwhelming audio manager
  const throttledOnChange = useThrottledParam(onChange);

  const displayValue = formatter
    ? formatter(value)
    : formatParam(formatKey, value, formatter);

  const defaultValueArray =
    defaultValue?.valueOf() === undefined ? undefined : [defaultValue];

  return (
    <div className="space-y-2" title={description}>
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
            throttledOnChange(newValue);
          }
        }}
        step={step}
        value={[value]}
      />
    </div>
  );
}
