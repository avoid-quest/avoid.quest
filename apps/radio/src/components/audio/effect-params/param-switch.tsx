/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Switch } from "@avoid.quest/ui/components/switch";

type ParamSwitchProps = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
};

/** An on/off effect parameter: a small switch with its label beside it. */
export function ParamSwitch({
  id,
  label,
  checked,
  onChange,
  description,
  disabled = false,
}: ParamSwitchProps) {
  return (
    <label
      className="flex h-10 items-center gap-1.5 text-xs"
      htmlFor={id}
      title={description}
    >
      <Switch
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={onChange}
      />
      {label}
    </label>
  );
}
