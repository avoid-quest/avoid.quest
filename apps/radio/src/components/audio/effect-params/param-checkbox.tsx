import { Checkbox } from "@workspace/ui/components/checkbox";
import { Label } from "@workspace/ui/components/label";

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
  return (
    <div className="flex items-center gap-2" title={description}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
    </div>
  );
}
