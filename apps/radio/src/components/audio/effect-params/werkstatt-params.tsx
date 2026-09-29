/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { Label } from "@avoid.quest/ui/components/label";
import { Textarea } from "@avoid.quest/ui/components/textarea";
import {
  type ChangeEvent,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { InlineError } from "@/components/radio/inline-error";
import type { EffectConfig } from "@/lib/audio";
import {
  parseWerkstattDeclarations,
  reconcileWerkstattParameters,
  type WerkstattDeclarations,
  type WerkstattParamDeclaration,
} from "@/lib/audio/dsp/effects/werkstatt-declarations";
import { WERKSTATT_PRESETS } from "@/lib/audio/dsp/effects/werkstatt-presets";
import {
  getWerkstattRuntimeStatus,
  subscribeWerkstattRuntimeStatus,
} from "@/lib/audio/dsp/effects/werkstatt-runtime-status";
import { ParamGroup } from "./param-group";
import { ParamSelect } from "./param-select";
import { ParamSlider } from "./param-slider";
import { ParamSwitch } from "./param-switch";

type WerkstattEffect = Extract<EffectConfig, { type: "werkstatt" }>;

type WerkstattParamsProps = {
  effect: WerkstattEffect;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

function sourceOf(effect: WerkstattEffect): string {
  return effect.code ?? effect.source;
}

function unitFormatter(unit: string): (value: number) => string {
  return (value) => `${Number(value.toPrecision(5))}${unit ? ` ${unit}` : ""}`;
}

function DynamicControl({
  declaration,
  effect,
  onUpdate,
}: {
  declaration: WerkstattParamDeclaration;
  effect: WerkstattEffect;
  onUpdate: WerkstattParamsProps["onUpdate"];
}) {
  const value =
    effect.parameters[declaration.label] ?? declaration.defaultValue;
  function update(nextValue: number) {
    onUpdate({
      parameters: {
        ...effect.parameters,
        [declaration.label]: nextValue,
      },
    } as Partial<EffectConfig>);
  }

  function updateBoolean(checked: boolean) {
    update(Number(checked));
  }

  if (declaration.mapping === "bool") {
    return (
      <ParamSwitch
        checked={value >= 0.5}
        id={`${effect.id}-werkstatt-${declaration.label}`}
        label={declaration.label}
        onChange={updateBoolean}
      />
    );
  }

  return (
    <ParamSlider
      defaultValue={declaration.defaultValue}
      formatter={unitFormatter(declaration.unit)}
      label={declaration.label}
      max={declaration.max}
      min={declaration.min}
      onChange={update}
      step={
        declaration.mapping === "int"
          ? 1
          : Math.max((declaration.max - declaration.min) / 1000, 0.000_001)
      }
      value={value}
    />
  );
}

export function WerkstattParams({ effect, onUpdate }: WerkstattParamsProps) {
  const appliedSource = sourceOf(effect);
  const [draft, setDraft] = useState(appliedSource);
  const [declarations, setDeclarations] =
    useState<WerkstattDeclarations | null>(null);
  const [declarationError, setDeclarationError] = useState<string | null>(null);
  const runtimeStatus = useSyncExternalStore(
    (listener) => subscribeWerkstattRuntimeStatus(effect.id, listener),
    () => getWerkstattRuntimeStatus(effect.id),
    () => getWerkstattRuntimeStatus(effect.id)
  );

  useEffect(() => {
    setDraft(appliedSource);
  }, [appliedSource]);

  useEffect(() => {
    let active = true;
    parseWerkstattDeclarations(draft)
      .then((parsed) => {
        if (active) {
          setDeclarations(parsed);
          setDeclarationError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setDeclarations(null);
          setDeclarationError(
            cause instanceof Error
              ? cause.message
              : "Couldn't read the declarations."
          );
        }
      });
    return () => {
      active = false;
    };
  }, [draft]);

  async function applySource(source: string, reset: boolean) {
    setDraft(source);
    try {
      const parsed = await parseWerkstattDeclarations(source);
      setDeclarations(parsed);
      setDeclarationError(null);
      onUpdate({
        code: source,
        parameters: reconcileWerkstattParameters(
          parsed.params,
          effect.parameters,
          reset
        ),
      } as Partial<EffectConfig>);
    } catch (cause) {
      setDeclarationError(
        cause instanceof Error
          ? cause.message
          : "Couldn't read the Werkstatt source."
      );
    }
  }

  function selectPreset(id: string) {
    const preset = WERKSTATT_PRESETS.find((item) => item.id === id);
    if (preset) {
      applySource(preset.source, true);
    }
  }

  function updateDraft(event: ChangeEvent<HTMLTextAreaElement>) {
    setDraft(event.target.value);
  }

  function compileDraft() {
    applySource(draft, false);
  }

  function resetParameters() {
    if (declarations) {
      onUpdate({
        parameters: reconcileWerkstattParameters(declarations.params, {}, true),
      } as Partial<EffectConfig>);
    }
  }

  const selectedPreset =
    WERKSTATT_PRESETS.find(({ source }) => source === draft)?.id ?? "custom";
  const controlsAreApplied = draft === appliedSource && !declarationError;

  return (
    <div className="space-y-4">
      <ParamGroup defaultOpen title="Playground">
        <ParamSelect
          label="Example"
          onChange={selectPreset}
          options={[
            ...WERKSTATT_PRESETS.map(({ id, label }) => ({
              label,
              value: id,
            })),
            ...(selectedPreset === "custom"
              ? [{ label: "Custom", value: "custom" }]
              : []),
          ]}
          value={selectedPreset}
        />
        <p className="text-muted-foreground text-xs">
          Pass Through plus all six examples shipped by the pinned openDAW
          release.
        </p>
      </ParamGroup>

      <ParamGroup collapsible defaultOpen={false} title="Source editor">
        <div className="space-y-2">
          <Label htmlFor={`${effect.id}-werkstatt-source`}>
            JavaScript processor
          </Label>
          <Textarea
            className="min-h-72 font-mono text-xs"
            id={`${effect.id}-werkstatt-source`}
            onChange={updateDraft}
            spellCheck={false}
            value={draft}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-7 text-xs"
              disabled={draft === appliedSource || declarationError !== null}
              onClick={compileDraft}
              size="sm"
              type="button"
            >
              Compile source
            </Button>
            <Button
              className="h-7 text-xs"
              disabled={!declarations}
              onClick={resetParameters}
              size="sm"
              type="button"
              variant="outline"
            >
              Reset parameters
            </Button>
          </div>
          {declarationError === null ? null : (
            <InlineError>{declarationError}</InlineError>
          )}
          {!(controlsAreApplied || declarationError) && (
            <p className="text-muted-foreground text-xs">
              Compile the draft to apply its declarations and controls.
            </p>
          )}
        </div>
      </ParamGroup>

      {controlsAreApplied && declarations
        ? declarations.sections.map((section, sectionIndex) => {
            if (section.params.length === 0) {
              return null;
            }
            return (
              <ParamGroup
                key={section.group?.label ?? `parameters-${sectionIndex}`}
                title={section.group?.label ?? "Script parameters"}
              >
                {section.params.map((declaration) => (
                  <DynamicControl
                    declaration={declaration}
                    effect={effect}
                    key={declaration.label}
                    onUpdate={onUpdate}
                  />
                ))}
              </ParamGroup>
            );
          })
        : null}

      <div
        className="rounded-md border p-3 text-xs"
        data-state={runtimeStatus.state}
      >
        <p className="font-medium capitalize">Runtime: {runtimeStatus.state}</p>
        <p className="text-muted-foreground">{runtimeStatus.message}</p>
      </div>

      <div className="rounded-md border border-dashed p-3 text-xs">
        <p className="font-medium">Sample declarations unavailable</p>
        <p className="text-muted-foreground">
          The current official Werkstatt audio-effect bridge parses @sample but
          does not forward samples to the processor. Existing saved references
          remain preserved, but cannot be edited or used here.
        </p>
        {declarations && declarations.samples.length > 0 && (
          <p className="mt-1 text-muted-foreground">
            Declared slots: {declarations.samples.join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}
