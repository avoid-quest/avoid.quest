/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
/**
 * Declarative Parameter Renderer
 *
 * Renders effect parameters based on schema definitions.
 * Single component that handles all effect types.
 */

import { Input } from "@avoid.quest/ui/components/input";
import { Label } from "@avoid.quest/ui/components/label";
import { Textarea } from "@avoid.quest/ui/components/textarea";
import type { ChangeEvent } from "react";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
import type { EffectConfig } from "@/lib/audio";
import {
  type CheckboxParamDef,
  type EffectSchema,
  type GroupParamDef,
  type ParamDef,
  parseSelectValue,
  type SelectParamDef,
  type SliderParamDef,
  type TextParamDef,
} from "@/lib/audio/dsp/effects/schema";
import { ParamGroup } from "./param-group";
import { ParamSelect } from "./param-select";
import { ParamSlider } from "./param-slider";
import { ParamSwitch } from "./param-switch";
import { UniversalParams } from "./universal-params";

type DeclarativeParamsProps = {
  schema: EffectSchema;
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  deckId?: "deck-a" | "deck-b";
  effectId?: string;
  midiTargetPrefix?: string;
};

function getEffectValue(effect: EffectConfig, key: string): unknown {
  return (effect as unknown as Record<string, unknown>)[key];
}

function getDefaultValue(
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined,
  key: string
): number | undefined {
  if (!defaultConfig) {
    return;
  }
  const value = (defaultConfig as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

type RenderParamContext = {
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
  deckId?: "deck-a" | "deck-b";
  effectId?: string;
  midiTargetPrefix?: string;
};

function SliderControl({
  param,
  ctx,
}: {
  param: SliderParamDef;
  ctx: RenderParamContext;
}) {
  const value = getEffectValue(ctx.effect, param.key);
  function updateValue(nextValue: number) {
    ctx.onUpdate({ [param.key]: nextValue });
  }

  if (typeof value !== "number") {
    return null;
  }

  const slider = (
    <ParamSlider
      defaultValue={getDefaultValue(ctx.defaultConfig, param.key)}
      description={param.description}
      formatKey={param.formatKey ?? "default"}
      label={param.label}
      max={param.max}
      min={param.min}
      onChange={updateValue}
      step={param.step}
      value={value}
      wheelStep={param.wheelStep}
    />
  );

  const targetPrefix =
    ctx.midiTargetPrefix ??
    (ctx.deckId && ctx.effectId
      ? `${ctx.deckId}:effect:${ctx.effectId}`
      : undefined);
  if (targetPrefix) {
    return (
      <MidiControlWrapper
        key={param.key}
        targetId={`${targetPrefix}:${param.key}`}
      >
        {slider}
      </MidiControlWrapper>
    );
  }

  return slider;
}

function SelectControl({
  param,
  ctx,
}: {
  param: SelectParamDef;
  ctx: RenderParamContext;
}) {
  const value = getEffectValue(ctx.effect, param.key);
  const stringValue = String(value);
  function updateValue(nextValue: string) {
    ctx.onUpdate({ [param.key]: parseSelectValue(param, nextValue) });
  }

  return (
    <ParamSelect
      label={param.label}
      onChange={updateValue}
      options={param.options}
      value={stringValue}
    />
  );
}

function CheckboxControl({
  param,
  ctx,
}: {
  param: CheckboxParamDef;
  ctx: RenderParamContext;
}) {
  const value = getEffectValue(ctx.effect, param.key);
  const checked = value === true;
  function updateChecked(isChecked: boolean) {
    ctx.onUpdate({ [param.key]: isChecked });
  }

  return (
    <ParamSwitch
      checked={checked}
      description={param.description}
      id={`${ctx.effect.id}-${param.key}`}
      label={param.label}
      onChange={updateChecked}
    />
  );
}

function TextControl({
  param,
  ctx,
}: {
  param: TextParamDef;
  ctx: RenderParamContext;
}) {
  const value = getEffectValue(ctx.effect, param.key);
  const id = `${ctx.effect.id}-${param.key}`;
  const Control = param.multiline ? Textarea : Input;
  function updateText(
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    ctx.onUpdate({ [param.key]: event.target.value });
  }

  return (
    <div className="basis-full space-y-1">
      <Label
        className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider"
        htmlFor={id}
      >
        {param.label}
      </Label>
      <Control
        className={param.multiline ? "text-xs" : "h-7 text-xs"}
        id={id}
        onChange={updateText}
        placeholder={param.placeholder}
        value={typeof value === "string" ? value : ""}
      />
      {Boolean(param.description) && (
        <p className="text-muted-foreground text-xs">{param.description}</p>
      )}
    </div>
  );
}

function GroupControl({
  param,
  ctx,
}: {
  param: GroupParamDef;
  ctx: RenderParamContext;
}) {
  // Check if group is controlled by enabled key
  const isEnabled = param.enabledKey
    ? getEffectValue(ctx.effect, param.enabledKey) === true
    : true;

  // For collapsible groups with enabledKey, filter out the enabled checkbox
  // since it's shown at the top of the group by ParamGroup
  const childrenToRender = param.enabledKey
    ? param.children.filter((child) => {
        if (child.type === "checkbox" && child.key === param.enabledKey) {
          return true; // Keep the enabled checkbox but render it first
        }
        // Only show other children if enabled
        return isEnabled;
      })
    : param.children;

  return (
    <ParamGroup
      collapsible={param.collapsible}
      defaultOpen={isEnabled}
      title={param.title}
    >
      {childrenToRender.map((child) => (
        <ParamControl
          ctx={ctx}
          key={child.type === "group" ? child.title : child.key}
          param={child}
        />
      ))}
    </ParamGroup>
  );
}

function ParamControl({
  param,
  ctx,
}: {
  param: ParamDef;
  ctx: RenderParamContext;
}) {
  switch (param.type) {
    case "slider":
      return <SliderControl ctx={ctx} param={param} />;
    case "select":
      return <SelectControl ctx={ctx} param={param} />;
    case "checkbox":
      return <CheckboxControl ctx={ctx} param={param} />;
    case "text":
      return <TextControl ctx={ctx} param={param} />;
    case "group":
      return <GroupControl ctx={ctx} param={param} />;
    default:
      return null;
  }
}

export function DeclarativeParams({
  schema,
  effect,
  onUpdate,
  deckId,
  effectId,
  midiTargetPrefix,
}: DeclarativeParamsProps) {
  const ctx: RenderParamContext = {
    deckId,
    defaultConfig: schema.defaultConfig,
    effect,
    effectId,
    midiTargetPrefix,
    onUpdate,
  };

  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-3">
      {schema.params.map((param) => (
        <ParamControl
          ctx={ctx}
          key={param.type === "group" ? param.title : param.key}
          param={param}
        />
      ))}
      <UniversalParams
        deckId={deckId}
        effect={effect}
        effectId={effectId}
        midiTargetPrefix={midiTargetPrefix}
        onUpdate={onUpdate}
      />
    </div>
  );
}
