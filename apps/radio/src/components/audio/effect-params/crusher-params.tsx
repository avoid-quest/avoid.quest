import { Checkbox } from "@workspace/ui/components/checkbox";
import { Label } from "@workspace/ui/components/label";
import {
  type CrusherConfig,
  type EffectConfig,
  getEffectMetadata,
} from "@/lib/audio";
import { ParamSlider, UniversalParams } from "./";
import { getDefaultValue } from "./utils";

type CrusherParamsProps = {
  effect: CrusherConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function CrusherParams({ effect, onUpdate }: CrusherParamsProps) {
  const metadata = getEffectMetadata("crusher");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;

  return (
    <div className="space-y-4">
      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "crush")}
        formatKey="percentage"
        label="Crush"
        max={ranges.crush?.max ?? 1}
        min={ranges.crush?.min ?? 0}
        onChange={(value) => onUpdate({ crush: value })}
        step={ranges.crush?.step ?? 0.01}
        value={effect.crush}
      />

      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "bitDepth")}
        formatKey="bits"
        label="Bit Depth"
        max={ranges.bitDepth?.max ?? 16}
        min={ranges.bitDepth?.min ?? 1}
        onChange={(value) => onUpdate({ bitDepth: value })}
        step={ranges.bitDepth?.step ?? 1}
        value={effect.bitDepth}
      />

      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "boost")}
        formatKey="db"
        label="Boost"
        max={ranges.boost?.max ?? 40}
        min={ranges.boost?.min ?? -40}
        onChange={(value) => onUpdate({ boost: value })}
        step={ranges.boost?.step ?? 0.1}
        value={effect.boost}
      />

      <div className="flex items-center gap-2">
        <Checkbox
          checked={effect.autoGain}
          id="crusher-autoGain"
          onCheckedChange={(checked) =>
            onUpdate({ autoGain: checked === true })
          }
        />
        <Label className="text-xs" htmlFor="crusher-autoGain">
          Auto Gain
        </Label>
      </div>

      <UniversalParams effect={effect} onUpdate={onUpdate} />
    </div>
  );
}
