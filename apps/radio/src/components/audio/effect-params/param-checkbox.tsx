/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Checkbox } from "@avoid.quest/ui/components/checkbox";
import { Label } from "@avoid.quest/ui/components/label";

type ParamCheckboxProps = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
};

export function ParamCheckbox({
  id,
  label,
  checked,
  onChange,
  description,
  disabled = false,
}: ParamCheckboxProps) {
  function handleCheckedChange(value: boolean | "indeterminate") {
    onChange(value === true);
  }

  return (
    <div className="flex items-center gap-2" title={description}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={handleCheckedChange}
      />
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
    </div>
  );
}
