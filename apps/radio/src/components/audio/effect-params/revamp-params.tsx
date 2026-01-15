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

type BandConfig = {
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
  ranges: Record<string, { min?: number; max?: number; step?: number }>;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

type PassBandProps = BandConfig & {
  title: string;
  enabled: boolean;
  enabledKey: "highPassEnabled" | "lowPassEnabled";
  frequencyKey: "highPassFrequency" | "lowPassFrequency";
  qKey: "highPassQ" | "lowPassQ";
  orderKey: "highPassOrder" | "lowPassOrder";
  frequency: number;
  q: number;
  order: number;
};

function PassBandParams({
  title,
  enabled,
  enabledKey,
  frequencyKey,
  qKey,
  orderKey,
  frequency,
  q,
  order,
  defaultConfig,
  ranges,
  onUpdate,
}: PassBandProps) {
  return (
    <ParamGroup title={title}>
      <BandToggle
        checked={enabled}
        id={enabledKey}
        label="Enabled"
        onCheckedChange={(checked) => onUpdate({ [enabledKey]: checked })}
      />
      {enabled && (
        <>
          <ParamSlider
            defaultValue={getDefaultValue(defaultConfig, frequencyKey)}
            formatKey="frequency"
            label="Frequency"
            max={ranges[frequencyKey]?.max ?? 20_000}
            min={ranges[frequencyKey]?.min ?? 20}
            onChange={(value) => onUpdate({ [frequencyKey]: value })}
            step={ranges[frequencyKey]?.step ?? 1}
            value={frequency}
          />
          <ParamSlider
            defaultValue={getDefaultValue(defaultConfig, qKey)}
            formatKey="q"
            label="Q"
            max={ranges[qKey]?.max ?? 30}
            min={ranges[qKey]?.min ?? 0.1}
            onChange={(value) => onUpdate({ [qKey]: value })}
            step={ranges[qKey]?.step ?? 0.1}
            value={q}
          />
          <ParamSelect
            label="Slope"
            onChange={(value) =>
              onUpdate({ [orderKey]: Number.parseInt(value, 10) })
            }
            options={orderOptions}
            value={String(order)}
          />
        </>
      )}
    </ParamGroup>
  );
}

type ShelfBandProps = BandConfig & {
  title: string;
  enabled: boolean;
  enabledKey: "lowShelfEnabled" | "highShelfEnabled";
  frequencyKey: "lowShelfFrequency" | "highShelfFrequency";
  gainKey: "lowShelfGain" | "highShelfGain";
  frequency: number;
  gain: number;
};

function ShelfBandParams({
  title,
  enabled,
  enabledKey,
  frequencyKey,
  gainKey,
  frequency,
  gain,
  defaultConfig,
  ranges,
  onUpdate,
}: ShelfBandProps) {
  return (
    <ParamGroup title={title}>
      <BandToggle
        checked={enabled}
        id={enabledKey}
        label="Enabled"
        onCheckedChange={(checked) => onUpdate({ [enabledKey]: checked })}
      />
      {enabled && (
        <>
          <ParamSlider
            defaultValue={getDefaultValue(defaultConfig, frequencyKey)}
            formatKey="frequency"
            label="Frequency"
            max={ranges[frequencyKey]?.max ?? 20_000}
            min={ranges[frequencyKey]?.min ?? 20}
            onChange={(value) => onUpdate({ [frequencyKey]: value })}
            step={ranges[frequencyKey]?.step ?? 1}
            value={frequency}
          />
          <ParamSlider
            defaultValue={getDefaultValue(defaultConfig, gainKey)}
            formatKey="db"
            label="Gain"
            max={ranges[gainKey]?.max ?? 40}
            min={ranges[gainKey]?.min ?? -40}
            onChange={(value) => onUpdate({ [gainKey]: value })}
            step={ranges[gainKey]?.step ?? 0.1}
            value={gain}
          />
        </>
      )}
    </ParamGroup>
  );
}

type BellBandProps = BandConfig & {
  title: string;
  enabled: boolean;
  enabledKey: "lowBellEnabled" | "midBellEnabled" | "highBellEnabled";
  frequencyKey: "lowBellFrequency" | "midBellFrequency" | "highBellFrequency";
  qKey: "lowBellQ" | "midBellQ" | "highBellQ";
  gainKey: "lowBellGain" | "midBellGain" | "highBellGain";
  frequency: number;
  q: number;
  gain: number;
};

function BellBandParams({
  title,
  enabled,
  enabledKey,
  frequencyKey,
  qKey,
  gainKey,
  frequency,
  q,
  gain,
  defaultConfig,
  ranges,
  onUpdate,
}: BellBandProps) {
  return (
    <ParamGroup title={title}>
      <BandToggle
        checked={enabled}
        id={enabledKey}
        label="Enabled"
        onCheckedChange={(checked) => onUpdate({ [enabledKey]: checked })}
      />
      {enabled && (
        <>
          <ParamSlider
            defaultValue={getDefaultValue(defaultConfig, frequencyKey)}
            formatKey="frequency"
            label="Frequency"
            max={ranges[frequencyKey]?.max ?? 20_000}
            min={ranges[frequencyKey]?.min ?? 20}
            onChange={(value) => onUpdate({ [frequencyKey]: value })}
            step={ranges[frequencyKey]?.step ?? 1}
            value={frequency}
          />
          <ParamSlider
            defaultValue={getDefaultValue(defaultConfig, qKey)}
            formatKey="q"
            label="Q"
            max={ranges[qKey]?.max ?? 30}
            min={ranges[qKey]?.min ?? 0.1}
            onChange={(value) => onUpdate({ [qKey]: value })}
            step={ranges[qKey]?.step ?? 0.1}
            value={q}
          />
          <ParamSlider
            defaultValue={getDefaultValue(defaultConfig, gainKey)}
            formatKey="db"
            label="Gain"
            max={ranges[gainKey]?.max ?? 40}
            min={ranges[gainKey]?.min ?? -40}
            onChange={(value) => onUpdate({ [gainKey]: value })}
            step={ranges[gainKey]?.step ?? 0.1}
            value={gain}
          />
        </>
      )}
    </ParamGroup>
  );
}

export function RevampParams({ effect, onUpdate }: RevampParamsProps) {
  const metadata = getEffectMetadata("revamp");
  const ranges = metadata?.parameterRanges ?? {};
  const defaultConfig = metadata?.defaultConfig;

  const bandConfig = { defaultConfig, ranges, onUpdate };

  return (
    <div className="space-y-4">
      <PassBandParams
        {...bandConfig}
        enabled={effect.highPassEnabled}
        enabledKey="highPassEnabled"
        frequency={effect.highPassFrequency}
        frequencyKey="highPassFrequency"
        order={effect.highPassOrder}
        orderKey="highPassOrder"
        q={effect.highPassQ}
        qKey="highPassQ"
        title="High Pass"
      />

      <ShelfBandParams
        {...bandConfig}
        enabled={effect.lowShelfEnabled}
        enabledKey="lowShelfEnabled"
        frequency={effect.lowShelfFrequency}
        frequencyKey="lowShelfFrequency"
        gain={effect.lowShelfGain}
        gainKey="lowShelfGain"
        title="Low Shelf"
      />

      <BellBandParams
        {...bandConfig}
        enabled={effect.lowBellEnabled}
        enabledKey="lowBellEnabled"
        frequency={effect.lowBellFrequency}
        frequencyKey="lowBellFrequency"
        gain={effect.lowBellGain}
        gainKey="lowBellGain"
        q={effect.lowBellQ}
        qKey="lowBellQ"
        title="Low Bell"
      />

      <BellBandParams
        {...bandConfig}
        enabled={effect.midBellEnabled}
        enabledKey="midBellEnabled"
        frequency={effect.midBellFrequency}
        frequencyKey="midBellFrequency"
        gain={effect.midBellGain}
        gainKey="midBellGain"
        q={effect.midBellQ}
        qKey="midBellQ"
        title="Mid Bell"
      />

      <BellBandParams
        {...bandConfig}
        enabled={effect.highBellEnabled}
        enabledKey="highBellEnabled"
        frequency={effect.highBellFrequency}
        frequencyKey="highBellFrequency"
        gain={effect.highBellGain}
        gainKey="highBellGain"
        q={effect.highBellQ}
        qKey="highBellQ"
        title="High Bell"
      />

      <ShelfBandParams
        {...bandConfig}
        enabled={effect.highShelfEnabled}
        enabledKey="highShelfEnabled"
        frequency={effect.highShelfFrequency}
        frequencyKey="highShelfFrequency"
        gain={effect.highShelfGain}
        gainKey="highShelfGain"
        title="High Shelf"
      />

      <PassBandParams
        {...bandConfig}
        enabled={effect.lowPassEnabled}
        enabledKey="lowPassEnabled"
        frequency={effect.lowPassFrequency}
        frequencyKey="lowPassFrequency"
        order={effect.lowPassOrder}
        orderKey="lowPassOrder"
        q={effect.lowPassQ}
        qKey="lowPassQ"
        title="Low Pass"
      />

      <UniversalParams effect={effect} onUpdate={onUpdate} />
    </div>
  );
}
