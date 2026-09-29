/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Input } from "@avoid.quest/ui/components/input";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
import type { EffectConfig } from "@/lib/audio";
import type {
  EffectParamDef,
  EffectSchema,
} from "@/lib/audio/dsp/effects/schema";
import { getEffectParamDefs } from "@/lib/audio/dsp/effects/schema";
import {
  type EffectLayout,
  type LayoutRow,
  shortLabel,
} from "./effect-layouts";
import { ParamGroup } from "./param-group";
import { ParamSelect } from "./param-select";
import { ParamSlider } from "./param-slider";
import { ParamSwitch } from "./param-switch";
import { UniversalParams } from "./universal-params";

type TailoredParamsProps = {
  schema: EffectSchema;
  layout: EffectLayout;
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  deckId?: "deck-a" | "deck-b";
  effectId?: string;
};

function readValue(effect: EffectConfig, key: string): unknown {
  return (effect as unknown as Record<string, unknown>)[key];
}

function readDefault(schema: EffectSchema, key: string): number | undefined {
  const value = (schema.defaultConfig as Record<string, unknown> | undefined)?.[
    key
  ];
  return typeof value === "number" ? value : undefined;
}

function Control({
  param,
  label,
  bipolar,
  schema,
  effect,
  onUpdate,
  targetPrefix,
}: {
  param: EffectParamDef;
  label: string;
  bipolar: boolean;
  schema: EffectSchema;
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  targetPrefix?: string;
}) {
  const value = readValue(effect, param.key);
  const id = `${effect.id}-${param.key}`;

  if (param.type === "slider") {
    if (typeof value !== "number") {
      return null;
    }
    const knob = (
      <ParamSlider
        bipolar={bipolar}
        defaultValue={readDefault(schema, param.key)}
        description={param.description}
        formatKey={param.formatKey ?? "default"}
        label={label}
        max={param.max}
        min={param.min}
        onChange={(next) => onUpdate({ [param.key]: next })}
        step={param.step}
        value={value}
      />
    );
    return targetPrefix ? (
      <MidiControlWrapper targetId={`${targetPrefix}:${param.key}`}>
        {knob}
      </MidiControlWrapper>
    ) : (
      knob
    );
  }
  if (param.type === "select") {
    return (
      <ParamSelect
        label={label}
        onChange={(next) => {
          const option = param.options.find((o) => String(o.value) === next);
          onUpdate({ [param.key]: option?.value ?? next });
        }}
        options={param.options.map((o) => ({
          label: o.label,
          value: String(o.value),
        }))}
        value={String(value)}
      />
    );
  }
  if (param.type === "checkbox") {
    return (
      <ParamSwitch
        checked={value === true}
        description={param.description}
        id={id}
        label={label}
        onChange={(checked) => onUpdate({ [param.key]: checked })}
      />
    );
  }
  return (
    <div className="basis-full space-y-1">
      <label
        className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider"
        htmlFor={id}
      >
        {label}
      </label>
      <Input
        className="h-7 text-xs"
        id={id}
        onChange={(event) => onUpdate({ [param.key]: event.target.value })}
        value={typeof value === "string" ? value : ""}
      />
    </div>
  );
}

/**
 * Renders an effect from its layout: rows of controls in a deliberate
 * order, then anything the layout did not mention, then the shared mix row.
 */
export function TailoredParams({
  schema,
  layout,
  effect,
  onUpdate,
  deckId,
  effectId,
}: TailoredParamsProps) {
  const defs = getEffectParamDefs(effect.type);
  const byKey = new Map(defs.map((def) => [def.key, def]));
  const targetPrefix =
    deckId && effectId ? `${deckId}:effect:${effectId}` : undefined;
  const placed = new Set(layout.rows.flatMap((row) => row.keys));
  const leftovers = defs.filter((def) => !placed.has(def.key));
  const rows: LayoutRow[] = leftovers.length
    ? [
        ...layout.rows,
        { collapsible: true, keys: leftovers.map((d) => d.key), title: "More" },
      ]
    : layout.rows;

  const renderRow = (row: LayoutRow, index: number) => {
    const controls = row.keys.flatMap((key) => {
      const param = byKey.get(key);
      if (!param) {
        return [];
      }
      const label = shortLabel(layout.labels?.[key] ?? param.label);
      const bipolar =
        layout.bipolar?.includes(key) ??
        (param.type === "slider" && param.min < 0 && param.max > 0);
      return [
        <Control
          bipolar={Boolean(bipolar)}
          effect={effect}
          key={key}
          label={label}
          onUpdate={onUpdate}
          param={param}
          schema={schema}
          targetPrefix={targetPrefix}
        />,
      ];
    });
    if (controls.length === 0) {
      return null;
    }
    return (
      <ParamGroup
        className={index === 0 ? "border-t-0 pt-0" : undefined}
        collapsible={row.collapsible}
        defaultOpen={!row.collapsible}
        key={row.title ?? row.keys.join(",")}
        title={row.title}
      >
        {controls}
      </ParamGroup>
    );
  };

  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-3">
      {rows.map(renderRow)}
      <UniversalParams
        deckId={deckId}
        effect={effect}
        effectId={effectId}
        onUpdate={onUpdate}
      />
    </div>
  );
}
