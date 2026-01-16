import { Checkbox } from "@workspace/ui/components/checkbox";
import { Label } from "@workspace/ui/components/label";
import {
  type EffectConfig,
  type FoldConfig,
  getEffectMetadata,
} from "@/lib/audio";
import { ParamSelect, ParamSlider, UniversalParams } from "./";
import { getDefaultValue } from "./utils";

type FoldParamsProps = {
  effect: FoldConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

const oversampleOptions = [
  { value: "2", label: "2x" },
  { value: "4", label: "4x" },
  { value: "8", label: "8x" },
] as const;

export function FoldParams({ effect, onUpdate }: FoldParamsProps) {
  const metadata = getEffectMetadata("fold");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;

  return (
    <div className="space-y-4">
      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "amount")}
        formatKey="db"
        label="Amount"
        max={ranges.amount?.max ?? 40}
        min={ranges.amount?.min ?? -40}
        onChange={(value) => onUpdate({ amount: value })}
        step={ranges.amount?.step ?? 0.1}
        value={effect.amount}
      />

      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "volume")}
        formatKey="db"
        label="Volume"
        max={ranges.volume?.max ?? 40}
        min={ranges.volume?.min ?? -40}
        onChange={(value) => onUpdate({ volume: value })}
        step={ranges.volume?.step ?? 0.1}
        value={effect.volume}
      />

      <ParamSelect
        label="Oversample"
        onChange={(value) =>
          onUpdate({ oversample: Number.parseInt(value, 10) as 2 | 4 | 8 })
        }
        options={oversampleOptions}
        value={String(effect.oversample)}
      />

      <div className="flex items-center gap-2">
        <Checkbox
          checked={effect.autoGain}
          id="fold-autoGain"
          onCheckedChange={(checked) =>
            onUpdate({ autoGain: checked === true })
          }
        />
        <Label className="text-xs" htmlFor="fold-autoGain">
          Auto Gain
        </Label>
      </div>

      <UniversalParams effect={effect} onUpdate={onUpdate} />
    </div>
  );
}
