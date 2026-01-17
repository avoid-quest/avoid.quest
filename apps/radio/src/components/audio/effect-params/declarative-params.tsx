/**
 * Declarative Parameter Renderer
 *
 * Renders effect parameters based on schema definitions.
 * Single component that handles all effect types.
 */

import { useMemo } from "react";
import type { EffectConfig } from "@/lib/audio";
import { getEffectMetadata } from "@/lib/audio";
import type {
  CheckboxParamDef,
  EffectSchema,
  GroupParamDef,
  ParamDef,
  SelectParamDef,
  SliderParamDef,
} from "@/lib/audio/dsp/effects/schema";
import { ParamCheckbox } from "./param-checkbox";
import { ParamGroup } from "./param-group";
import { ParamSelect } from "./param-select";
import { ParamSlider } from "./param-slider";
import { UniversalParams } from "./universal-params";

type DeclarativeParamsProps = {
  schema: EffectSchema;
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

function getEffectValue(effect: EffectConfig, key: string): unknown {
  return (effect as unknown as Record<string, unknown>)[key];
}

function getDefaultValue(
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined,
  key: string
): number | undefined {
  if (!defaultConfig) {
    return undefined;
  }
  const value = (defaultConfig as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

type RenderParamContext = {
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  defaultConfig: Omit<EffectConfig, "id" | "order"> | undefined;
};

function renderSlider(
  param: SliderParamDef,
  ctx: RenderParamContext
): React.ReactNode {
  const value = getEffectValue(ctx.effect, param.key);
  if (typeof value !== "number") {
    return null;
  }

  return (
    <ParamSlider
      defaultValue={getDefaultValue(ctx.defaultConfig, param.key)}
      description={param.description}
      formatKey={param.formatKey ?? "default"}
      key={param.key}
      label={param.label}
      max={param.max}
      min={param.min}
      onChange={(v) => ctx.onUpdate({ [param.key]: v })}
      step={param.step}
      value={value}
    />
  );
}

function renderSelect(
  param: SelectParamDef,
  ctx: RenderParamContext
): React.ReactNode {
  const value = getEffectValue(ctx.effect, param.key);
  const stringValue = String(value);

  return (
    <ParamSelect
      key={param.key}
      label={param.label}
      onChange={(v) => {
        const parsed =
          param.valueType === "number" ? Number.parseInt(v, 10) : v;
        ctx.onUpdate({ [param.key]: parsed });
      }}
      options={param.options}
      value={stringValue}
    />
  );
}

function renderCheckbox(
  param: CheckboxParamDef,
  ctx: RenderParamContext
): React.ReactNode {
  const value = getEffectValue(ctx.effect, param.key);
  const checked = value === true;

  return (
    <ParamCheckbox
      checked={checked}
      description={param.description}
      id={`${ctx.effect.id}-${param.key}`}
      key={param.key}
      label={param.label}
      onChange={(c) => ctx.onUpdate({ [param.key]: c })}
    />
  );
}

function renderGroup(
  param: GroupParamDef,
  ctx: RenderParamContext
): React.ReactNode {
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
      key={param.title}
      title={param.title}
    >
      {childrenToRender.map((child) => renderParam(child, ctx))}
    </ParamGroup>
  );
}

function renderParam(
  param: ParamDef,
  ctx: RenderParamContext
): React.ReactNode {
  switch (param.type) {
    case "slider":
      return renderSlider(param, ctx);
    case "select":
      return renderSelect(param, ctx);
    case "checkbox":
      return renderCheckbox(param, ctx);
    case "group":
      return renderGroup(param, ctx);
    default:
      return null;
  }
}

export function DeclarativeParams({
  schema,
  effect,
  onUpdate,
}: DeclarativeParamsProps) {
  const defaultConfig = useMemo(() => {
    const metadata = getEffectMetadata(effect.type);
    return metadata?.defaultConfig;
  }, [effect.type]);

  const ctx: RenderParamContext = {
    effect,
    onUpdate,
    defaultConfig,
  };

  return (
    <div className="space-y-4">
      {schema.params.map((param) => renderParam(param, ctx))}
      <UniversalParams effect={effect} onUpdate={onUpdate} />
    </div>
  );
}
