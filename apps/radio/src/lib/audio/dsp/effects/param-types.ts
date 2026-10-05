import type { EffectConfig, EffectType } from "./types.js";

export type ParamType = "slider" | "select" | "checkbox" | "text" | "group";

export type VisualizationType = "eq-curve" | "compressor-curve" | "none";

export type UniversalEffectParamKey =
  | "enabled"
  | "dryWet"
  | "inputGain"
  | "outputGain";

export type EngineEffectParamValue = unknown;
export type EngineEffectConfig = Record<string, EngineEffectParamValue>;

export type EffectDefaultConfig<TType extends EffectType = EffectType> = Omit<
  Extract<EffectConfig, { type: TType }>,
  "id" | "order"
>;

export type EffectParamKey<TType extends EffectType> = TType extends EffectType
  ? Exclude<
      keyof EffectDefaultConfig<TType>,
      "type" | UniversalEffectParamKey
    > &
      string
  : never;

export type SliderParamDef<TKey extends string = string> = {
  type: "slider";
  key: TKey;
  label: string;
  formatKey?: string;
  min: number;
  max: number;
  step: number;
  /** Whole-value wheel steps for discrete parameters; continuous parameters use 0.01. */
  wheelStep?: number;
  description?: string;
};

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectParamDef<TKey extends string = string> = {
  type: "select";
  key: TKey;
  label: string;
  options: readonly SelectOption[];
  /** If provided, parse value to this type (default: string) */
  valueType?: "string" | "number";
};

export type CheckboxParamDef<TKey extends string = string> = {
  type: "checkbox";
  key: TKey;
  label: string;
  description?: string;
};

export type TextParamDef<TKey extends string = string> = {
  type: "text";
  key: TKey;
  label: string;
  description?: string;
  placeholder?: string;
  multiline?: boolean;
};

export type GroupParamDef<TKey extends string = string> = {
  type: "group";
  title: string;
  children: readonly ParamDef<TKey>[];
  collapsible?: boolean;
  /** Key for enabled toggle that controls collapse state */
  enabledKey?: TKey;
};

export type ParamDef<TKey extends string = string> =
  | SliderParamDef<TKey>
  | SelectParamDef<TKey>
  | CheckboxParamDef<TKey>
  | TextParamDef<TKey>
  | GroupParamDef<TKey>;
export type EffectParamDef<TKey extends string = string> = Exclude<
  ParamDef<TKey>,
  GroupParamDef<TKey>
>;

export type EffectDefinition<TType extends EffectType = EffectType> = {
  type: TType;
  name: string;
  description: string;
  defaultConfig: EffectDefaultConfig<TType>;
  params: readonly ParamDef<EffectParamKey<TType>>[];
  visualization?: VisualizationType;
};

export type EffectDefinitionMap = {
  [TType in EffectType]: EffectDefinition<TType>;
};

export type EffectSchema<TType extends EffectType = EffectType> =
  EffectDefinition<TType>;

export function defineEffect<TType extends EffectType>(
  definition: EffectDefinition<TType>
): EffectDefinition<TType> {
  return definition;
}

/** A select's chosen option as the config stores it: numeric selects hold numbers. */
export function parseSelectValue(
  param: SelectParamDef,
  value: string
): string | number {
  return param.valueType === "number" ? Number(value) : value;
}
