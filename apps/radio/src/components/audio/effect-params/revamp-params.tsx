import { Checkbox } from "@workspace/ui/components/checkbox";
import { Label } from "@workspace/ui/components/label";
import {
  type EffectConfig,
  getEffectMetadata,
  type RevampConfig,
} from "@/lib/audio";
import { ParamGroup, ParamSelect, ParamSlider, UniversalParams } from "./";
import { getDefaultValue } from "./utils";

type RevampParamsProps = {
  effect: RevampConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

const orderOptions = [
  { value: "1", label: "6 dB/oct" },
  { value: "2", label: "12 dB/oct" },
  { value: "3", label: "18 dB/oct" },
  { value: "4", label: "24 dB/oct" },
] as const;

type BandToggleProps = {
  checked: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

function BandToggle({ checked, id, label, onCheckedChange }: BandToggleProps) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Checkbox
        checked={checked}
        id={id}
        onCheckedChange={(c) => onCheckedChange(c === true)}
      />
      <Label className="font-medium text-xs" htmlFor={id}>
        {label}
      </Label>
    </div>
  );
}

export function RevampParams({ effect, onUpdate }: RevampParamsProps) {
  const metadata = getEffectMetadata("revamp");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;

  return (
    <div className="space-y-4">
      <ParamGroup title="High Pass">
        <BandToggle
          checked={effect.highPassEnabled}
          id="highPassEnabled"
          label="Enabled"
          onCheckedChange={(checked) => onUpdate({ highPassEnabled: checked })}
        />
        {effect.highPassEnabled && (
          <>
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "highPassFrequency")}
              formatKey="frequency"
              label="Frequency"
              max={ranges.highPassFrequency?.max ?? 20_000}
              min={ranges.highPassFrequency?.min ?? 20}
              onChange={(value) => onUpdate({ highPassFrequency: value })}
              step={ranges.highPassFrequency?.step ?? 1}
              value={effect.highPassFrequency}
            />
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "highPassQ")}
              formatKey="q"
              label="Q"
              max={ranges.highPassQ?.max ?? 30}
              min={ranges.highPassQ?.min ?? 0.1}
              onChange={(value) => onUpdate({ highPassQ: value })}
              step={ranges.highPassQ?.step ?? 0.1}
              value={effect.highPassQ}
            />
            <ParamSelect
              label="Slope"
              onChange={(value) =>
                onUpdate({ highPassOrder: Number.parseInt(value, 10) })
              }
              options={orderOptions}
              value={String(effect.highPassOrder)}
            />
          </>
        )}
      </ParamGroup>

      <ParamGroup title="Low Shelf">
        <BandToggle
          checked={effect.lowShelfEnabled}
          id="lowShelfEnabled"
          label="Enabled"
          onCheckedChange={(checked) => onUpdate({ lowShelfEnabled: checked })}
        />
        {effect.lowShelfEnabled && (
          <>
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "lowShelfFrequency")}
              formatKey="frequency"
              label="Frequency"
              max={ranges.lowShelfFrequency?.max ?? 20_000}
              min={ranges.lowShelfFrequency?.min ?? 20}
              onChange={(value) => onUpdate({ lowShelfFrequency: value })}
              step={ranges.lowShelfFrequency?.step ?? 1}
              value={effect.lowShelfFrequency}
            />
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "lowShelfGain")}
              formatKey="db"
              label="Gain"
              max={ranges.lowShelfGain?.max ?? 40}
              min={ranges.lowShelfGain?.min ?? -40}
              onChange={(value) => onUpdate({ lowShelfGain: value })}
              step={ranges.lowShelfGain?.step ?? 0.1}
              value={effect.lowShelfGain}
            />
          </>
        )}
      </ParamGroup>

      <ParamGroup title="Low Bell">
        <BandToggle
          checked={effect.lowBellEnabled}
          id="lowBellEnabled"
          label="Enabled"
          onCheckedChange={(checked) => onUpdate({ lowBellEnabled: checked })}
        />
        {effect.lowBellEnabled && (
          <>
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "lowBellFrequency")}
              formatKey="frequency"
              label="Frequency"
              max={ranges.lowBellFrequency?.max ?? 20_000}
              min={ranges.lowBellFrequency?.min ?? 20}
              onChange={(value) => onUpdate({ lowBellFrequency: value })}
              step={ranges.lowBellFrequency?.step ?? 1}
              value={effect.lowBellFrequency}
            />
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "lowBellQ")}
              formatKey="q"
              label="Q"
              max={ranges.lowBellQ?.max ?? 30}
              min={ranges.lowBellQ?.min ?? 0.1}
              onChange={(value) => onUpdate({ lowBellQ: value })}
              step={ranges.lowBellQ?.step ?? 0.1}
              value={effect.lowBellQ}
            />
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "lowBellGain")}
              formatKey="db"
              label="Gain"
              max={ranges.lowBellGain?.max ?? 40}
              min={ranges.lowBellGain?.min ?? -40}
              onChange={(value) => onUpdate({ lowBellGain: value })}
              step={ranges.lowBellGain?.step ?? 0.1}
              value={effect.lowBellGain}
            />
          </>
        )}
      </ParamGroup>

      <ParamGroup title="Mid Bell">
        <BandToggle
          checked={effect.midBellEnabled}
          id="midBellEnabled"
          label="Enabled"
          onCheckedChange={(checked) => onUpdate({ midBellEnabled: checked })}
        />
        {effect.midBellEnabled && (
          <>
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "midBellFrequency")}
              formatKey="frequency"
              label="Frequency"
              max={ranges.midBellFrequency?.max ?? 20_000}
              min={ranges.midBellFrequency?.min ?? 20}
              onChange={(value) => onUpdate({ midBellFrequency: value })}
              step={ranges.midBellFrequency?.step ?? 1}
              value={effect.midBellFrequency}
            />
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "midBellQ")}
              formatKey="q"
              label="Q"
              max={ranges.midBellQ?.max ?? 30}
              min={ranges.midBellQ?.min ?? 0.1}
              onChange={(value) => onUpdate({ midBellQ: value })}
              step={ranges.midBellQ?.step ?? 0.1}
              value={effect.midBellQ}
            />
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "midBellGain")}
              formatKey="db"
              label="Gain"
              max={ranges.midBellGain?.max ?? 40}
              min={ranges.midBellGain?.min ?? -40}
              onChange={(value) => onUpdate({ midBellGain: value })}
              step={ranges.midBellGain?.step ?? 0.1}
              value={effect.midBellGain}
            />
          </>
        )}
      </ParamGroup>

      <ParamGroup title="High Bell">
        <BandToggle
          checked={effect.highBellEnabled}
          id="highBellEnabled"
          label="Enabled"
          onCheckedChange={(checked) => onUpdate({ highBellEnabled: checked })}
        />
        {effect.highBellEnabled && (
          <>
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "highBellFrequency")}
              formatKey="frequency"
              label="Frequency"
              max={ranges.highBellFrequency?.max ?? 20_000}
              min={ranges.highBellFrequency?.min ?? 20}
              onChange={(value) => onUpdate({ highBellFrequency: value })}
              step={ranges.highBellFrequency?.step ?? 1}
              value={effect.highBellFrequency}
            />
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "highBellQ")}
              formatKey="q"
              label="Q"
              max={ranges.highBellQ?.max ?? 30}
              min={ranges.highBellQ?.min ?? 0.1}
              onChange={(value) => onUpdate({ highBellQ: value })}
              step={ranges.highBellQ?.step ?? 0.1}
              value={effect.highBellQ}
            />
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "highBellGain")}
              formatKey="db"
              label="Gain"
              max={ranges.highBellGain?.max ?? 40}
              min={ranges.highBellGain?.min ?? -40}
              onChange={(value) => onUpdate({ highBellGain: value })}
              step={ranges.highBellGain?.step ?? 0.1}
              value={effect.highBellGain}
            />
          </>
        )}
      </ParamGroup>

      <ParamGroup title="High Shelf">
        <BandToggle
          checked={effect.highShelfEnabled}
          id="highShelfEnabled"
          label="Enabled"
          onCheckedChange={(checked) => onUpdate({ highShelfEnabled: checked })}
        />
        {effect.highShelfEnabled && (
          <>
            <ParamSlider
              defaultValue={getDefaultValue(
                defaultConfig,
                "highShelfFrequency"
              )}
              formatKey="frequency"
              label="Frequency"
              max={ranges.highShelfFrequency?.max ?? 20_000}
              min={ranges.highShelfFrequency?.min ?? 20}
              onChange={(value) => onUpdate({ highShelfFrequency: value })}
              step={ranges.highShelfFrequency?.step ?? 1}
              value={effect.highShelfFrequency}
            />
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "highShelfGain")}
              formatKey="db"
              label="Gain"
              max={ranges.highShelfGain?.max ?? 40}
              min={ranges.highShelfGain?.min ?? -40}
              onChange={(value) => onUpdate({ highShelfGain: value })}
              step={ranges.highShelfGain?.step ?? 0.1}
              value={effect.highShelfGain}
            />
          </>
        )}
      </ParamGroup>

      <ParamGroup title="Low Pass">
        <BandToggle
          checked={effect.lowPassEnabled}
          id="lowPassEnabled"
          label="Enabled"
          onCheckedChange={(checked) => onUpdate({ lowPassEnabled: checked })}
        />
        {effect.lowPassEnabled && (
          <>
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "lowPassFrequency")}
              formatKey="frequency"
              label="Frequency"
              max={ranges.lowPassFrequency?.max ?? 20_000}
              min={ranges.lowPassFrequency?.min ?? 20}
              onChange={(value) => onUpdate({ lowPassFrequency: value })}
              step={ranges.lowPassFrequency?.step ?? 1}
              value={effect.lowPassFrequency}
            />
            <ParamSlider
              defaultValue={getDefaultValue(defaultConfig, "lowPassQ")}
              formatKey="q"
              label="Q"
              max={ranges.lowPassQ?.max ?? 30}
              min={ranges.lowPassQ?.min ?? 0.1}
              onChange={(value) => onUpdate({ lowPassQ: value })}
              step={ranges.lowPassQ?.step ?? 0.1}
              value={effect.lowPassQ}
            />
            <ParamSelect
              label="Slope"
              onChange={(value) =>
                onUpdate({ lowPassOrder: Number.parseInt(value, 10) })
              }
              options={orderOptions}
              value={String(effect.lowPassOrder)}
            />
          </>
        )}
      </ParamGroup>

      <UniversalParams effect={effect} onUpdate={onUpdate} />
    </div>
  );
}
