/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Knob } from "@avoid.quest/ui/components/knob";
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
  /** Fill the knob's arc from the default outward (pan, filter, offsets). */
  bipolar?: boolean;
};

/** A numeric effect parameter, shown as a knob like every other DJ control. */
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
  bipolar,
}: ParamSliderProps) {
  // Throttle onChange to ~30fps to prevent overwhelming audio manager
  const throttledOnChange = useThrottledParam(onChange);
  const format = (next: number) =>
    formatter ? formatter(next) : formatParam(formatKey, next, formatter);
  const fillFromDefault =
    bipolar ?? (defaultValue !== undefined && min < 0 && max > 0);

  return (
    <Knob
      bipolar={fillFromDefault}
      defaultValue={defaultValue}
      disabled={disabled}
      format={format}
      label={label}
      max={max}
      min={min}
      onChange={throttledOnChange}
      step={step}
      title={description ? `${label}: ${description}` : undefined}
      value={value}
    />
  );
}
