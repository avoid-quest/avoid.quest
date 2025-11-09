"use client";

import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";

type SelectOption = {
  value: string;
  label: string;
};

type ParamSelectProps = {
  label: string;
  value: string;
  options: SelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function ParamSelect({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: ParamSelectProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <Select disabled={disabled} onValueChange={onChange} value={value}>
        <SelectTrigger className="h-8">
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
