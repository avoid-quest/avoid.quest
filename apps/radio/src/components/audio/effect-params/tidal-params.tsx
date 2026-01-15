import {
  type EffectConfig,
  getEffectMetadata,
  type TidalConfig,
} from "@/lib/audio";
import { ParamGroup, ParamSlider, UniversalParams } from "./";
import { getDefaultValue } from "./utils";

type TidalParamsProps = {
  effect: TidalConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function TidalParams({ effect, onUpdate }: TidalParamsProps) {
  const metadata = getEffectMetadata("tidal");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;

  return (
    <div className="space-y-4">
      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "rate")}
        formatKey="hz"
        label="Rate"
        max={ranges.rate?.max ?? 10}
        min={ranges.rate?.min ?? 0.1}
        onChange={(value) => onUpdate({ rate: value })}
        step={ranges.rate?.step ?? 0.01}
        value={effect.rate}
      />

      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "depth")}
        formatKey="percentage"
        label="Depth"
        max={ranges.depth?.max ?? 1}
        min={ranges.depth?.min ?? 0}
        onChange={(value) => onUpdate({ depth: value })}
        step={ranges.depth?.step ?? 0.01}
        value={effect.depth}
      />

      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "slope")}
        formatKey="percentage"
        label="Slope"
        max={ranges.slope?.max ?? 1}
        min={ranges.slope?.min ?? 0}
        onChange={(value) => onUpdate({ slope: value })}
        step={ranges.slope?.step ?? 0.01}
        value={effect.slope}
      />

      <ParamSlider
        defaultValue={getDefaultValue(defaultConfig, "symmetry")}
        formatKey="percentage"
        label="Symmetry"
        max={ranges.symmetry?.max ?? 1}
        min={ranges.symmetry?.min ?? 0}
        onChange={(value) => onUpdate({ symmetry: value })}
        step={ranges.symmetry?.step ?? 0.01}
        value={effect.symmetry}
      />

      <ParamGroup title="Phase">
        <ParamSlider
          defaultValue={getDefaultValue(defaultConfig, "offset")}
          formatKey="degrees"
          label="Offset"
          max={ranges.offset?.max ?? 360}
          min={ranges.offset?.min ?? 0}
          onChange={(value) => onUpdate({ offset: value })}
          step={ranges.offset?.step ?? 1}
          value={effect.offset}
        />

        <ParamSlider
          defaultValue={getDefaultValue(defaultConfig, "channelOffset")}
          formatKey="degrees"
          label="Channel Offset"
          max={ranges.channelOffset?.max ?? 360}
          min={ranges.channelOffset?.min ?? 0}
          onChange={(value) => onUpdate({ channelOffset: value })}
          step={ranges.channelOffset?.step ?? 1}
          value={effect.channelOffset}
        />
      </ParamGroup>

      <UniversalParams effect={effect} onUpdate={onUpdate} />
    </div>
  );
}
