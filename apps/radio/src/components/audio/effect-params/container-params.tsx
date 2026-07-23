import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { Toggle } from "@avoid.quest/ui/components/toggle";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import {
  createDefaultEffectConfig,
  type EffectChainConfig,
  type EffectConfig,
  getEffectMetadata,
} from "@/lib/audio";
import { getEffectSchema } from "@/lib/audio/dsp/effects/schema";
import { isEffectContainer } from "@/lib/audio/dsp/routing/effect-tree";
import { EffectPicker } from "../effect-picker";
import { DeclarativeParams } from "./declarative-params";
import { ParamSelect } from "./param-select";
import { ParamSlider } from "./param-slider";
import { SidechainParams } from "./sidechain-params";
import { Tone3000ModelParams } from "./tone3000-model-params";
import { UniversalParams } from "./universal-params";
import { WerkstattParams } from "./werkstatt-params";

type ContainerEffectConfig = Extract<
  EffectConfig,
  { type: "fxComposite" | "stereoSplit" | "frequencySplit" }
>;

type ContainerParamsProps = {
  effect: ContainerEffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  deckId?: "deck-a" | "deck-b";
  effectId?: string;
  midiTargetPrefix?: string;
};

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nestedMidiTargetPrefix(
  deckId: "deck-a" | "deck-b" | undefined,
  effectId: string,
  chainId: string,
  childId: string,
  parentPrefix?: string
): string | undefined {
  const prefix =
    parentPrefix ?? (deckId ? `${deckId}:effect:${effectId}` : undefined);
  return prefix ? `${prefix}:chain:${chainId}:effect:${childId}` : undefined;
}

function NestedEffect({
  effect,
  deckId,
  onRemove,
  onUpdate,
  midiTargetPrefix,
}: {
  effect: EffectConfig;
  deckId?: "deck-a" | "deck-b";
  onRemove: () => void;
  onUpdate: (config: Partial<EffectConfig>) => void;
  midiTargetPrefix?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const metadata = getEffectMetadata(effect.type);
  const schema = getEffectSchema(effect.type);

  return (
    <div className="rounded-md border bg-background/70">
      <div className="flex items-center gap-2 p-2">
        <Button
          className="h-7 flex-1 justify-start px-2"
          onClick={() => setExpanded((value) => !value)}
          size="sm"
          variant="ghost"
        >
          {expanded ? (
            <ChevronDownIcon className="mr-2 size-3.5" />
          ) : (
            <ChevronRightIcon className="mr-2 size-3.5" />
          )}
          {metadata?.name ?? effect.type}
        </Button>
        <Toggle
          onPressedChange={(enabled) => onUpdate({ enabled })}
          pressed={effect.enabled}
          size="sm"
        >
          {effect.enabled ? "ON" : "OFF"}
        </Toggle>
        <Button
          className="size-7 p-0"
          onClick={onRemove}
          size="sm"
          variant="ghost"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      {expanded && schema && (
        <div className="space-y-4 border-t p-3">
          {isEffectContainer(effect) ? (
            <ContainerParams
              deckId={deckId}
              effect={effect}
              effectId={effect.id}
              midiTargetPrefix={midiTargetPrefix}
              onUpdate={onUpdate}
            />
          ) : (
            <>
              <DeclarativeParams
                deckId={deckId}
                effect={effect}
                effectId={effect.id}
                midiTargetPrefix={midiTargetPrefix}
                onUpdate={onUpdate}
                schema={schema}
              />
              {(effect.type === "compressor" ||
                effect.type === "gate" ||
                effect.type === "vocoder") && (
                <SidechainParams
                  deckId={deckId}
                  effect={effect}
                  onUpdate={onUpdate}
                />
              )}
              {effect.type === "werkstatt" && (
                <WerkstattParams effect={effect} onUpdate={onUpdate} />
              )}
              {effect.type === "neuralAmp" && (
                <Tone3000ModelParams effect={effect} onUpdate={onUpdate} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ContainerParams({
  effect,
  onUpdate,
  deckId,
  effectId,
  midiTargetPrefix,
}: ContainerParamsProps) {
  const [pickerChainId, setPickerChainId] = useState<string | null>(null);

  const updateChains = (chains: EffectChainConfig[]) => {
    onUpdate({ chains } as Partial<EffectConfig>);
  };

  const updateChain = (chainId: string, update: Partial<EffectChainConfig>) => {
    updateChains(
      effect.chains.map((chain) =>
        chain.id === chainId ? { ...chain, ...update } : chain
      )
    );
  };

  const addEffect = (chain: EffectChainConfig, type: EffectConfig["type"]) => {
    const child = createDefaultEffectConfig(
      type,
      createId("effect"),
      chain.effects.length
    );
    updateChain(chain.id, { effects: [...chain.effects, child] });
    setPickerChainId(null);
  };

  const addChain = () => {
    const order = effect.chains.length;
    updateChains([
      ...effect.chains,
      {
        id: createId("chain"),
        name: `Chain ${order + 1}`,
        order,
        gain: 1,
        pan: 0,
        muted: false,
        solo: false,
        effects: [],
      },
    ]);
  };

  const setFrequencyBandCount = (bandCount: 2 | 3 | 4) => {
    if (effect.type !== "frequencySplit") {
      return;
    }
    let labels = ["Low", "Low Mid", "High Mid", "High"];
    if (bandCount === 2) {
      labels = ["Low", "High"];
    } else if (bandCount === 3) {
      labels = ["Low", "Mid", "High"];
    }
    const existing = [...effect.chains].sort((a, b) => a.order - b.order);
    const chains = labels.map(
      (name, order): EffectChainConfig => ({
        ...(existing[order] ?? {
          id: createId("band"),
          gain: 1,
          pan: 0,
          muted: false,
          solo: false,
          effects: [],
        }),
        name,
        order,
      })
    );
    onUpdate({
      frequencyBandCount: bandCount,
      chains,
      crossoverFrequencies: [200, 1000, 5000].slice(0, bandCount - 1),
    } as Partial<EffectConfig>);
  };

  return (
    <div className="space-y-4">
      {effect.type === "frequencySplit" && (
        <ParamSelect
          label="Bands"
          onChange={(value) =>
            setFrequencyBandCount(Number.parseInt(value, 10) as 2 | 3 | 4)
          }
          options={[
            { value: "2", label: "2 bands" },
            { value: "3", label: "3 bands" },
            { value: "4", label: "4 bands" },
          ]}
          value={String(effect.frequencyBandCount ?? effect.chains.length)}
        />
      )}
      {effect.type === "frequencySplit" &&
        effect.crossoverFrequencies.map((frequency, index) => {
          const previous = effect.crossoverFrequencies[index - 1];
          const next = effect.crossoverFrequencies[index + 1];
          return (
            <ParamSlider
              formatKey="frequency"
              key={`crossover-${effect.chains[index + 1]?.id}`}
              label={`Crossover ${index + 1}`}
              max={next === undefined ? 20_000 : next - 20}
              min={previous === undefined ? 20 : previous + 20}
              onChange={(value) => {
                const crossoverFrequencies = [...effect.crossoverFrequencies];
                crossoverFrequencies[index] = value;
                onUpdate({ crossoverFrequencies } as Partial<EffectConfig>);
              }}
              step={1}
              value={frequency}
            />
          );
        })}

      {[...effect.chains]
        .sort((a, b) => a.order - b.order)
        .map((chain) => (
          <div className="space-y-3 rounded-lg border p-3" key={chain.id}>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Chain name"
                className="h-8 font-medium"
                disabled={effect.type !== "fxComposite"}
                onChange={(event) =>
                  updateChain(chain.id, { name: event.target.value })
                }
                value={chain.name}
              />
              {effect.type === "fxComposite" && effect.chains.length > 1 && (
                <Button
                  className="size-8 p-0"
                  onClick={() =>
                    updateChains(
                      effect.chains
                        .filter((item) => item.id !== chain.id)
                        .map((item, order) => ({ ...item, order }))
                    )
                  }
                  size="sm"
                  variant="ghost"
                >
                  <XIcon className="size-4" />
                </Button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ParamSlider
                formatKey="linearGain"
                label="Branch gain"
                max={4}
                min={0}
                onChange={(gain) => updateChain(chain.id, { gain })}
                step={0.01}
                value={chain.gain}
              />
              <ParamSlider
                formatKey="pan"
                label="Branch pan"
                max={1}
                min={-1}
                onChange={(pan) => updateChain(chain.id, { pan })}
                step={0.01}
                value={chain.pan}
              />
            </div>

            <div className="flex gap-2">
              <Toggle
                onPressedChange={(muted) => updateChain(chain.id, { muted })}
                pressed={chain.muted}
                size="sm"
              >
                Mute
              </Toggle>
              <Toggle
                onPressedChange={(solo) => updateChain(chain.id, { solo })}
                pressed={chain.solo}
                size="sm"
              >
                Solo
              </Toggle>
            </div>

            <div className="space-y-2">
              {[...chain.effects]
                .sort((a, b) => a.order - b.order)
                .map((child) => (
                  <NestedEffect
                    deckId={deckId}
                    effect={child}
                    key={child.id}
                    midiTargetPrefix={nestedMidiTargetPrefix(
                      deckId,
                      effectId ?? effect.id,
                      chain.id,
                      child.id,
                      midiTargetPrefix
                    )}
                    onRemove={() =>
                      updateChain(chain.id, {
                        effects: chain.effects
                          .filter((item) => item.id !== child.id)
                          .map((item, order) => ({ ...item, order })),
                      })
                    }
                    onUpdate={(config) =>
                      updateChain(chain.id, {
                        effects: chain.effects.map((item) =>
                          item.id === child.id
                            ? ({ ...item, ...config } as EffectConfig)
                            : item
                        ),
                      })
                    }
                  />
                ))}
              <Button
                className="w-full"
                onClick={() => setPickerChainId(chain.id)}
                size="sm"
                variant="outline"
              >
                <PlusIcon className="mr-2 size-4" />
                Add nested effect
              </Button>
            </div>

            {pickerChainId === chain.id && (
              <EffectPicker
                onClose={() => setPickerChainId(null)}
                onSelect={(type) => addEffect(chain, type)}
              />
            )}
          </div>
        ))}

      {effect.type === "fxComposite" && (
        <Button
          className="w-full"
          onClick={addChain}
          size="sm"
          variant="outline"
        >
          <PlusIcon className="mr-2 size-4" />
          Add parallel chain
        </Button>
      )}

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
