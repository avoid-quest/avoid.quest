import { Checkbox } from "@workspace/ui/components/checkbox";
import { Label } from "@workspace/ui/components/label";
import {
  type EffectConfig,
  getEffectMetadata,
  type StereoToolConfig,
} from "@/lib/audio";
import { ParamGroup, ParamSlider, UniversalParams } from "./";
import { getDefaultValue } from "./utils";

type StereoToolParamsProps = {
  effect: StereoToolConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function StereoToolParams({ effect, onUpdate }: StereoToolParamsProps) {
  const metadata = getEffectMetadata("stereoTool");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;

  return (
    <div className="space-y-4">
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

      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "stereo")}
        formatKey="percentage"
        label="Stereo Width"
        max={ranges.stereo?.max ?? 1}
        min={ranges.stereo?.min ?? -1}
        onChange={(value) => onUpdate({ stereo: value })}
        step={ranges.stereo?.step ?? 0.01}
        value={effect.stereo}
      />

      <ParamGroup title="Channel Options">
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={effect.invertL}
              id="invertL"
              onCheckedChange={(checked) =>
                onUpdate({ invertL: checked === true })
              }
            />
            <Label className="text-xs" htmlFor="invertL">
              Invert Left
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              checked={effect.invertR}
              id="invertR"
              onCheckedChange={(checked) =>
                onUpdate({ invertR: checked === true })
              }
            />
            <Label className="text-xs" htmlFor="invertR">
              Invert Right
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              checked={effect.swap}
              id="swap"
              onCheckedChange={(checked) =>
                onUpdate({ swap: checked === true })
              }
            />
            <Label className="text-xs" htmlFor="swap">
              Swap Channels
            </Label>
          </div>
        </div>
      </ParamGroup>

      <UniversalParams effect={effect} onUpdate={onUpdate} />
    </div>
  );
}
