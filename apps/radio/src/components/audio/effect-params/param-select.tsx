import { Label } from "@avoid.quest/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { cn } from "@avoid.quest/ui/lib/utils";

type SelectOption = {
  value: string;
  label: string;
};

type ParamSelectProps = {
  label: string;
  value: string;
  options: readonly SelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
};

export function ParamSelect({
  label,
  value,
  options,
  disabled = false,
  onChange,
  className,
}: ParamSelectProps) {
  return (
    <div className={cn("w-40 space-y-1", className)}>
      <Label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </Label>
      <Select disabled={disabled} onValueChange={onChange} value={value}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
