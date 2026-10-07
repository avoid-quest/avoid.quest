import type { Project } from "@opendaw/studio-core";
import type { EngineParamTarget } from "@/lib/node-engine/param-target";
import type { OfficialEffectGroup } from "./official-opendaw-effect-adapter";

export type NativeField = Parameters<Project["api"]["modulation"]["assign"]>[1];
export type EffectParamTarget = Extract<
  EngineParamTarget,
  { kind: "effect" | "chain" }
>;
/** D1: these controls represent a Radio scalar rather than one native field. */
export function isCoupledParameter(
  group: Pick<OfficialEffectGroup, "config">,
  target: EffectParamTarget
): boolean {
  return (
    ["dryWet", "inputGain", "outputGain", "signalGain"].includes(
      target.field
    ) ||
    target.kind === "chain" ||
    (group.config.type === "crusher" && target.field === "boost") ||
    (group.config.type === "fold" &&
      ["amount", "volume"].includes(target.field))
  );
}

const FIELD_ALIASES: Partial<
  Record<OfficialEffectGroup["config"]["type"], Record<string, string>>
> = {
  autotune: { retuneAmount: "retune" },
  crusher: { bitDepth: "bits" },
  neuralAmp: { input: "inputGain", output: "outputGain" },
  plateReverb: { preDelayMillis: "preDelay" },
  waveshaper: { deviceInputGain: "inputGain", deviceOutputGain: "outputGain" },
};

const REVAMP_FIELD =
  /^(lowPass|highPass|lowShelf|highShelf|lowBell|midBell|highBell)(Frequency|Gain|Q)$/;

/** Resolve slider keys against the current box, including Revamp's nested bands. */
export function officialModulationField(
  group: OfficialEffectGroup,
  target: EffectParamTarget
): NativeField | undefined {
  if (isCoupledParameter(group, target) || group.config.type === "werkstatt") {
    return;
  }
  let owner: object = group.device;
  let key = FIELD_ALIASES[group.config.type]?.[target.field] ?? target.field;
  if (group.config.type === "revamp") {
    const match = REVAMP_FIELD.exec(key);
    const band = match?.[1];
    const field = match?.[2];
    if (!(band && field)) {
      return;
    }
    owner = Reflect.get(owner, band);
    key = field.toLowerCase();
  }
  const field = Reflect.get(owner, key);
  return field &&
    typeof field.getValue === "function" &&
    typeof field.setValue === "function"
    ? (field as NativeField)
    : undefined;
}

export type ModulationHost = {
  project: Project;
  retainOutput: () => () => void;
  transaction: <T>(write: () => T) => T;
  field: (
    soundId: string,
    target: EffectParamTarget
  ) => NativeField | undefined;
  onEndpointsChanged: (listener: () => void) => () => void;
};
