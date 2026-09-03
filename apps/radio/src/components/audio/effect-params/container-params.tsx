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
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
import {
  createDefaultEffectConfig,
  type EffectChainConfig,
  type EffectConfig,
  getEffectMetadata,
} from "@/lib/audio";
import { getEffectSchema } from "@/lib/audio/dsp/effects/schema";
import {
  isEffectContainer,
  isEffectContainerType,
  MAX_EFFECT_TREE_DEPTH,
} from "@/lib/audio/dsp/routing/effect-tree";
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
  depth?: number;
  effectId?: string;
  midiTargetPrefix?: string;
};

const DEFAULT_CROSSOVER_FREQUENCIES = [200, 1000, 5000] as const;
const FREQUENCY_BAND_LABELS = {
  2: ["Low", "High"],
  3: ["Low", "Mid", "High"],
  4: ["Low", "Low Mid", "High Mid", "High"],
} as const;
const MIN_CROSSOVER_FREQUENCY = 20;
const MAX_CROSSOVER_FREQUENCY = 20_000;
const MIN_CROSSOVER_SPACING = 20;

export function canAddNestedEffect(
  depth: number,
  type: EffectConfig["type"]
): boolean {
  return (
    depth < MAX_EFFECT_TREE_DEPTH &&
    (depth + 1 < MAX_EFFECT_TREE_DEPTH || !isEffectContainerType(type))
  );
}

export function resizeFrequencyCrossovers(
  frequencies: readonly number[],
  bandCount: 2 | 3 | 4
): number[] {
  const count = bandCount - 1;
  const result: number[] = [];
  for (let index = 0; index < count; index++) {
    const minimum =
      index === 0
        ? MIN_CROSSOVER_FREQUENCY
        : (result[index - 1] ?? MIN_CROSSOVER_FREQUENCY) +
          MIN_CROSSOVER_SPACING;
    const maximum =
      MAX_CROSSOVER_FREQUENCY - (count - index - 1) * MIN_CROSSOVER_SPACING;
    const preferred =
      frequencies[index] ?? DEFAULT_CROSSOVER_FREQUENCIES[index] ?? minimum;
    result.push(
      Math.max(
        minimum,
        Math.min(maximum, Number.isFinite(preferred) ? preferred : minimum)
      )
    );
  }
  return result;
}

export function resizeFrequencyChains(
  chains: readonly EffectChainConfig[],
  bandCount: 2 | 3 | 4,
  createBandId: () => string = () => createId("band")
): EffectChainConfig[] {
  const existing = [...chains].sort((a, b) => a.order - b.order);
  const createBand = (): EffectChainConfig => ({
    id: createBandId(),
    name: "",
    order: 0,
    gain: 1,
    pan: 0,
    muted: false,
    solo: false,
    effects: [],
  });
  const low = existing[0] ?? createBand();
  const high =
    existing.length > 1 ? (existing.at(-1) ?? createBand()) : createBand();
  const middleCount = bandCount - 2;
  const middle = existing.slice(1, -1).slice(0, middleCount);
  while (middle.length < middleCount) {
    middle.push(createBand());
  }
  return [low, ...middle, high].map((chain, order) => ({
    ...chain,
    name: FREQUENCY_BAND_LABELS[bandCount][order] ?? chain.name,
    order,
  }));
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function getChainMidiTargetPrefix(
  deckId: "deck-a" | "deck-b" | undefined,
  effectId: string,
  chainId: string,
  parentPrefix?: string
): string | undefined {
  const prefix =
    parentPrefix ?? (deckId ? `${deckId}:effect:${effectId}` : undefined);
  return prefix ? `${prefix}:chain:${chainId}` : undefined;
}

function nestedMidiTargetPrefix(
  deckId: "deck-a" | "deck-b" | undefined,
  effectId: string,
  chainId: string,
  childId: string,
  parentPrefix?: string
): string | undefined {
  const prefix = getChainMidiTargetPrefix(
    deckId,
    effectId,
    chainId,
    parentPrefix
  );
  return prefix ? `${prefix}:effect:${childId}` : undefined;
}

function NestedEffect({
  effect,
  deckId,
  depth,
  onRemove,
  onUpdate,
  midiTargetPrefix,
}: {
  effect: EffectConfig;
  deckId?: "deck-a" | "deck-b";
  depth: number;
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
              depth={depth}
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
  depth = 0,
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

  const wrapChainSlider = (
    chainId: string,
    param: "gain" | "pan",
    slider: React.ReactNode
  ) => {
    const prefix = getChainMidiTargetPrefix(
      deckId,
      effectId ?? effect.id,
      chainId,
      midiTargetPrefix
    );
    return prefix ? (
      <MidiControlWrapper targetId={`${prefix}:${param}`}>
        {slider}
      </MidiControlWrapper>
    ) : (
      slider
    );
  };

  const addEffect = (chain: EffectChainConfig, type: EffectConfig["type"]) => {
    if (!canAddNestedEffect(depth, type)) {
      return;
    }
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
    onUpdate({
      frequencyBandCount: bandCount,
      chains: resizeFrequencyChains(effect.chains, bandCount),
      crossoverFrequencies: resizeFrequencyCrossovers(
        effect.crossoverFrequencies,
        bandCount
      ),
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
              {wrapChainSlider(
                chain.id,
                "gain",
                <ParamSlider
                  formatKey="linearGain"
                  label="Branch gain"
                  max={4}
                  min={0}
                  onChange={(gain) => updateChain(chain.id, { gain })}
                  step={0.01}
                  value={chain.gain}
                />
              )}
              {wrapChainSlider(
                chain.id,
                "pan",
                <ParamSlider
                  formatKey="pan"
                  label="Branch pan"
                  max={1}
                  min={-1}
                  onChange={(pan) => updateChain(chain.id, { pan })}
                  step={0.01}
                  value={chain.pan}
                />
              )}
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
                    depth={depth + 1}
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
              {depth < MAX_EFFECT_TREE_DEPTH && (
                <Button
                  className="w-full"
                  onClick={() => setPickerChainId(chain.id)}
                  size="sm"
                  variant="outline"
                >
                  <PlusIcon className="mr-2 size-4" />
                  Add nested effect
                </Button>
              )}
            </div>

            {pickerChainId === chain.id && (
              <EffectPicker
                allowContainers={depth + 1 < MAX_EFFECT_TREE_DEPTH}
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
