/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { Switch } from "@avoid.quest/ui/components/switch";
import { Toggle } from "@avoid.quest/ui/components/toggle";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import {
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
  useState,
} from "react";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
import {
  createDefaultEffectConfig,
  type EffectChainConfig,
  type EffectConfig,
  getEffectMetadata,
} from "@/lib/audio";
import {
  EFFECT_DEFINITIONS,
  getEffectSchema,
} from "@/lib/audio/dsp/effects/schema";
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
  for (let index = 0; index < count; index += 1) {
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
    effects: [],
    gain: 1,
    id: createBandId(),
    muted: false,
    name: "",
    order: 0,
    pan: 0,
    solo: false,
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
  const effectName = metadata?.name ?? effect.type;
  function toggleExpanded() {
    setExpanded((value) => !value);
  }

  function updateEnabled(enabled: boolean) {
    onUpdate({ enabled });
  }

  return (
    <div className="rounded-md border bg-background/70">
      <div className="flex items-center gap-2 p-2">
        <Button
          aria-expanded={expanded}
          className="h-7 flex-1 justify-start px-2 text-xs"
          onClick={toggleExpanded}
          size="sm"
          variant="ghost"
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
          {effectName}
        </Button>
        <Switch
          aria-label={`${effectName} enabled`}
          checked={effect.enabled}
          onCheckedChange={updateEnabled}
        />
        <Button
          aria-label={`Remove ${effectName}`}
          className="size-7"
          onClick={onRemove}
          size="icon"
          variant="ghost"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      {expanded && schema ? (
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
      ) : null}
    </div>
  );
}

function CrossoverSlider({
  effect,
  frequency,
  index,
  onUpdate,
}: {
  effect: Extract<ContainerEffectConfig, { type: "frequencySplit" }>;
  frequency: number;
  index: number;
  onUpdate: (config: Partial<EffectConfig>) => void;
}) {
  const previous = effect.crossoverFrequencies[index - 1];
  const next = effect.crossoverFrequencies[index + 1];
  function updateFrequency(value: number) {
    const crossoverFrequencies = [...effect.crossoverFrequencies];
    crossoverFrequencies[index] = value;
    onUpdate({ crossoverFrequencies } as Partial<EffectConfig>);
  }

  return (
    <ParamSlider
      defaultValue={DEFAULT_CROSSOVER_FREQUENCIES[index]}
      formatKey="frequency"
      label={`Crossover ${index + 1}`}
      max={next === undefined ? 20_000 : next - 20}
      min={previous === undefined ? 20 : previous + 20}
      onChange={updateFrequency}
      step={1}
      value={frequency}
    />
  );
}

function NestedEffectRow({
  chain,
  child,
  deckId,
  depth,
  effectId,
  midiTargetPrefix,
  updateChain,
}: {
  chain: EffectChainConfig;
  child: EffectConfig;
  deckId?: "deck-a" | "deck-b";
  depth: number;
  effectId: string;
  midiTargetPrefix?: string;
  updateChain: (chainId: string, update: Partial<EffectChainConfig>) => void;
}) {
  function remove() {
    updateChain(chain.id, {
      effects: chain.effects
        .filter((item) => item.id !== child.id)
        .map((item, order) => ({ ...item, order })),
    });
  }

  function update(config: Partial<EffectConfig>) {
    updateChain(chain.id, {
      effects: chain.effects.map((item) =>
        item.id === child.id ? ({ ...item, ...config } as EffectConfig) : item
      ),
    });
  }

  return (
    <NestedEffect
      deckId={deckId}
      depth={depth + 1}
      effect={child}
      midiTargetPrefix={nestedMidiTargetPrefix(
        deckId,
        effectId,
        chain.id,
        child.id,
        midiTargetPrefix
      )}
      onRemove={remove}
      onUpdate={update}
    />
  );
}

function ChainEditor({
  chain,
  deckId,
  depth,
  effect,
  effectId,
  midiTargetPrefix,
  pickerChainId,
  setPickerChainId,
  updateChain,
  updateChains,
}: {
  chain: EffectChainConfig;
  deckId?: "deck-a" | "deck-b";
  depth: number;
  effect: ContainerEffectConfig;
  effectId: string;
  midiTargetPrefix?: string;
  pickerChainId: string | null;
  setPickerChainId: Dispatch<SetStateAction<string | null>>;
  updateChain: (chainId: string, update: Partial<EffectChainConfig>) => void;
  updateChains: (chains: EffectChainConfig[]) => void;
}) {
  const targetPrefix = getChainMidiTargetPrefix(
    deckId,
    effectId,
    chain.id,
    midiTargetPrefix
  );
  const defaultChain =
    EFFECT_DEFINITIONS[effect.type].defaultConfig.chains[chain.order] ??
    EFFECT_DEFINITIONS[effect.type].defaultConfig.chains[0];
  function updateName(event: ChangeEvent<HTMLInputElement>) {
    updateChain(chain.id, { name: event.target.value });
  }

  function removeChain() {
    updateChains(
      effect.chains
        .filter((item) => item.id !== chain.id)
        .map((item, order) => ({ ...item, order }))
    );
  }

  function updateGain(gain: number) {
    updateChain(chain.id, { gain });
  }

  function updatePan(pan: number) {
    updateChain(chain.id, { pan });
  }

  function updateMuted(muted: boolean) {
    updateChain(chain.id, { muted });
  }

  function updateSolo(solo: boolean) {
    updateChain(chain.id, { solo });
  }

  function openPicker() {
    setPickerChainId(chain.id);
  }

  function closePicker() {
    setPickerChainId(null);
  }

  function addEffect(type: EffectConfig["type"]) {
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
  }
  const gainSlider = (
    <ParamSlider
      defaultValue={defaultChain.gain}
      formatKey="linearGain"
      label="Branch gain"
      max={4}
      min={0}
      onChange={updateGain}
      step={0.01}
      value={chain.gain}
    />
  );
  const panSlider = (
    <ParamSlider
      defaultValue={defaultChain.pan}
      formatKey="pan"
      label="Branch pan"
      max={1}
      min={-1}
      onChange={updatePan}
      step={0.01}
      value={chain.pan}
    />
  );

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Chain name"
          className="h-8 font-medium"
          disabled={effect.type !== "fxComposite"}
          onChange={updateName}
          value={chain.name}
        />
        {effect.type === "fxComposite" && effect.chains.length > 1 ? (
          <Button
            aria-label={`Remove ${chain.name || "chain"}`}
            className="size-7"
            onClick={removeChain}
            size="icon"
            variant="ghost"
          >
            <XIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {targetPrefix ? (
          <MidiControlWrapper targetId={`${targetPrefix}:gain`}>
            {gainSlider}
          </MidiControlWrapper>
        ) : (
          gainSlider
        )}
        {targetPrefix ? (
          <MidiControlWrapper targetId={`${targetPrefix}:pan`}>
            {panSlider}
          </MidiControlWrapper>
        ) : (
          panSlider
        )}
      </div>

      <div className="flex gap-2">
        <Toggle onPressedChange={updateMuted} pressed={chain.muted} size="sm">
          Mute
        </Toggle>
        <Toggle onPressedChange={updateSolo} pressed={chain.solo} size="sm">
          Solo
        </Toggle>
      </div>

      <div className="space-y-2">
        {[...chain.effects]
          .sort((a, b) => a.order - b.order)
          .map((child) => (
            <NestedEffectRow
              chain={chain}
              child={child}
              deckId={deckId}
              depth={depth}
              effectId={effectId}
              key={child.id}
              midiTargetPrefix={midiTargetPrefix}
              updateChain={updateChain}
            />
          ))}
        {depth < MAX_EFFECT_TREE_DEPTH ? (
          <Button
            className="h-7 w-full text-xs"
            onClick={openPicker}
            size="sm"
            variant="outline"
          >
            <PlusIcon className="size-3.5" />
            Add nested effect
          </Button>
        ) : null}
      </div>

      {pickerChainId === chain.id ? (
        <EffectPicker
          allowContainers={depth + 1 < MAX_EFFECT_TREE_DEPTH}
          onClose={closePicker}
          onSelect={addEffect}
        />
      ) : null}
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

  function updateChains(chains: EffectChainConfig[]) {
    onUpdate({ chains } as Partial<EffectConfig>);
  }

  function updateChain(chainId: string, update: Partial<EffectChainConfig>) {
    updateChains(
      effect.chains.map((chain) =>
        chain.id === chainId ? { ...chain, ...update } : chain
      )
    );
  }

  function addChain() {
    const order = effect.chains.length;
    updateChains([
      ...effect.chains,
      {
        effects: [],
        gain: 1,
        id: createId("chain"),
        muted: false,
        name: `Chain ${order + 1}`,
        order,
        pan: 0,
        solo: false,
      },
    ]);
  }

  function updateFrequencyBandCount(value: string) {
    if (effect.type !== "frequencySplit") {
      return;
    }
    const bandCount = Number.parseInt(value, 10) as 2 | 3 | 4;
    onUpdate({
      chains: resizeFrequencyChains(effect.chains, bandCount),
      crossoverFrequencies: resizeFrequencyCrossovers(
        effect.crossoverFrequencies,
        bandCount
      ),
      frequencyBandCount: bandCount,
    } as Partial<EffectConfig>);
  }

  return (
    <div className="space-y-4">
      {effect.type === "frequencySplit" && (
        <ParamSelect
          label="Bands"
          onChange={updateFrequencyBandCount}
          options={[
            { label: "2 bands", value: "2" },
            { label: "3 bands", value: "3" },
            { label: "4 bands", value: "4" },
          ]}
          value={String(effect.frequencyBandCount ?? effect.chains.length)}
        />
      )}
      {effect.type === "frequencySplit" &&
        effect.crossoverFrequencies.map((frequency, index) => (
          <CrossoverSlider
            effect={effect}
            frequency={frequency}
            index={index}
            key={`crossover-${effect.chains[index + 1]?.id}`}
            onUpdate={onUpdate}
          />
        ))}

      {[...effect.chains]
        .sort((a, b) => a.order - b.order)
        .map((chain) => (
          <ChainEditor
            chain={chain}
            deckId={deckId}
            depth={depth}
            effect={effect}
            effectId={effectId ?? effect.id}
            key={chain.id}
            midiTargetPrefix={midiTargetPrefix}
            pickerChainId={pickerChainId}
            setPickerChainId={setPickerChainId}
            updateChain={updateChain}
            updateChains={updateChains}
          />
        ))}

      {effect.type === "fxComposite" && (
        <Button
          className="h-7 w-full text-xs"
          onClick={addChain}
          size="sm"
          variant="outline"
        >
          <PlusIcon className="size-3.5" />
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
