import { toast } from "@avoid.quest/ui/components/sonner";
import { type EffectConfig, getEffectMetadata } from "@/lib/audio";
import {
  appendEffectToTree,
  findEffectChain,
  findEffectInTree,
  isEffectContainer,
  isValidFrequencySplitShape,
  removeEffectFromTree,
  reorderEffectTreeChain,
  visitEffectTree,
} from "@/lib/audio/dsp/routing/effect-tree";
import type { ChannelEffectsChange } from "@/lib/channel-effects";
import { getPlaybackChannel } from "@/lib/collections/playback-sessions";
import { type DeckId, getDjDeckModule } from "@/lib/dj-deck";
import { getMidiControl, type MidiMapping } from "@/lib/midi";
import { createEffectMidiActions } from "@/lib/midi/effect-actions";

type Position = { chainId: string | null; index: number; siblings: string[] };
type Snapshot = { effect: EffectConfig; positions: Position[] };
type EffectEdit = Extract<ChannelEffectsChange, { type: "remove" | "update" }>;

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identified(value: unknown): value is { id: string } {
  return record(value) && typeof value.id === "string";
}

/** Anchor to surviving neighbours, falling back to the former index. */
function restoreIndex(
  ids: string[],
  position: Pick<Position, "index" | "siblings">
): number {
  for (const id of position.siblings.slice(position.index + 1)) {
    const next = ids.indexOf(id);
    if (next !== -1) {
      return next;
    }
  }
  for (const id of position.siblings.slice(0, position.index).reverse()) {
    const previous = ids.indexOf(id);
    if (previous !== -1) {
      return previous + 1;
    }
  }
  return Math.min(position.index, ids.length);
}

function undoArray(
  before: { id: string }[],
  after: { id: string }[],
  current: { id: string }[]
): unknown[] {
  const beforeIds = before.map(({ id }) => id);
  const result = current.filter((entry) => {
    const added =
      !beforeIds.includes(entry.id) && after.find(({ id }) => id === entry.id);
    return !(added && equal(entry, added));
  });
  for (const [index, entry] of before.entries()) {
    const reset = after.find(({ id }) => id === entry.id);
    const currentIndex = result.findIndex(({ id }) => id === entry.id);
    if (reset && currentIndex !== -1) {
      result[currentIndex] = undoValue(entry, reset, result[currentIndex]) as {
        id: string;
      };
    } else if (!reset && currentIndex === -1) {
      const at = restoreIndex(
        result.map(({ id }) => id),
        { index, siblings: beforeIds }
      );
      result.splice(at, 0, structuredClone(entry));
    }
  }
  return result;
}

/** Revert only reset-owned values; later edits and additions keep their values. */
function undoValue(before: unknown, after: unknown, current: unknown): unknown {
  if (equal(current, after)) {
    return structuredClone(before);
  }
  if (
    Array.isArray(before) &&
    Array.isArray(after) &&
    Array.isArray(current) &&
    before.every(identified) &&
    after.every(identified) &&
    current.every(identified)
  ) {
    return undoArray(before, after, current);
  }
  if (!(record(before) && record(after) && record(current))) {
    return current;
  }
  const result = { ...current };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (equal(before[key], after[key])) {
      continue;
    }
    const previous = before[key];
    const reset = after[key];
    const latest = current[key];
    const restored =
      key === "chains" &&
      Array.isArray(previous) &&
      Array.isArray(reset) &&
      Array.isArray(latest)
        ? undoChains(previous, reset, latest)
        : undoValue(previous, reset, latest);
    if (restored === undefined) {
      delete result[key];
    } else {
      result[key] = restored;
    }
  }
  return result;
}

function recoverReset(
  before: EffectConfig,
  after: EffectConfig,
  current: EffectConfig
): EffectConfig {
  const restored = undoValue(before, after, current) as EffectConfig;
  const layoutChanged =
    isEffectContainer(after) &&
    isEffectContainer(current) &&
    !equal(
      after.chains.map(({ id }) => id),
      current.chains.map(({ id }) => id)
    );
  // Band count, chains and crossovers are one layout. Restore conflicting
  // layouts together so independent parameter edits cannot make it invalid.
  if (
    before.type === "frequencySplit" &&
    restored.type === "frequencySplit" &&
    (layoutChanged ||
      !isValidFrequencySplitShape(
        restored.chains,
        restored.crossoverFrequencies
      ))
  ) {
    return {
      ...restored,
      chains: structuredClone(before.chains),
      crossoverFrequencies: [...before.crossoverFrequencies],
      frequencyBandCount: before.frequencyBandCount,
    };
  }
  if (
    before.type === "stereoSplit" &&
    restored.type === "stereoSplit" &&
    (layoutChanged || restored.chains.length !== 2)
  ) {
    return { ...restored, chains: structuredClone(before.chains) };
  }
  return restored;
}

/** Reset may replace chain IDs; keep later edits in the corresponding original slot. */
function undoChains(
  before: { id: string }[],
  after: { id: string }[],
  current: { id: string }[]
): unknown[] {
  const aliases = new Map<string, string>();
  for (const [index, chain] of after.entries()) {
    const original = before[index];
    if (
      original &&
      !before.some(({ id }) => id === chain.id) &&
      !after.some(({ id }) => id === original.id)
    ) {
      aliases.set(chain.id, original.id);
    }
  }
  const align = (chains: { id: string }[]) =>
    chains.map((chain) => ({
      ...chain,
      id: aliases.get(chain.id) ?? chain.id,
    }));
  return undoArray(before, align(after), align(current));
}

function snapshots(
  tree: readonly EffectConfig[],
  capture: (effect: EffectConfig) => boolean
): Snapshot[] {
  const result: Snapshot[] = [];
  const visit = (
    effects: readonly EffectConfig[],
    ancestors: Position[],
    chainId: string | null
  ) => {
    const siblings = effects.map(({ id }) => id);
    for (const [index, effect] of effects.entries()) {
      const positions = [...ancestors, { chainId, index, siblings }];
      if (capture(effect)) {
        result.push({ effect: structuredClone(effect), positions });
      } else if (isEffectContainer(effect)) {
        for (const chain of effect.chains) {
          visit(chain.effects, positions, chain.id);
        }
      }
    }
  };
  visit(tree, [], null);
  return result;
}

/** The deck's MIDI binding drops these mappings once their effects are gone. */
function droppedMappings(
  mappings: readonly MidiMapping[],
  deckId: DeckId,
  effect: EffectConfig,
  remaining: ReadonlySet<string>
): MidiMapping[] {
  const ids: string[] = [];
  visitEffectTree([effect], ({ id }) => {
    if (!remaining.has(id)) {
      ids.push(id);
    }
  });
  return mappings.filter(
    ({ targetId }) =>
      targetId.startsWith(`${deckId}:`) &&
      ids.some((id) => targetId.includes(`:effect:${id}:`))
  );
}

/** Only mappings whose targets came back, so none outlive their effect. */
function restoreMappings(
  deckId: DeckId,
  tree: readonly EffectConfig[],
  mappings: readonly MidiMapping[]
): void {
  if (mappings.length === 0) {
    return;
  }
  const targets = new Set(
    createEffectMidiActions({ change: () => undefined, deckId, tree }).map(
      ({ targetId }) => targetId
    )
  );
  getMidiControl().change({
    mappings: mappings.filter(({ targetId }) => targets.has(targetId)),
    type: "restore-mappings",
  });
}

function restoreRemoved(
  tree: readonly EffectConfig[],
  snapshot: Snapshot
): EffectConfig[] {
  const position = [...snapshot.positions]
    .reverse()
    .find(({ chainId }) => chainId === null || findEffectChain(tree, chainId));
  if (!position) {
    return [...tree];
  }
  const siblings =
    position.chainId === null
      ? tree
      : (findEffectChain(tree, position.chainId)?.effects ?? []);
  const ids = siblings.map(({ id }) => id);
  ids.splice(restoreIndex(ids, position), 0, snapshot.effect.id);
  return reorderEffectTreeChain(
    appendEffectToTree(
      tree,
      structuredClone(snapshot.effect),
      position.chainId
    ),
    ids,
    position.chainId
  );
}

/** DJ-only recovery; Node mode retains its own history. */
export function changeDjEffectWithUndo(
  deckId: DeckId,
  change: EffectEdit,
  reset = false
): void {
  const readTree = () => getPlaybackChannel("dj", deckId)?.effects ?? [];
  const before = readTree();
  // Read before the deck's MIDI binding reconciles the change away.
  const { mappings } = getMidiControl().getSnapshot();
  const apply = (input: ChannelEffectsChange) =>
    getDjDeckModule().deck(deckId).change({ change: input, type: "effect" });
  apply(change);
  const after = readTree();
  const remaining = new Set<string>();
  visitEffectTree(after, ({ id }) => remaining.add(id));
  const removed = snapshots(before, (effect) =>
    reset ? effect.id === change.effectId : !remaining.has(effect.id)
  );
  for (const snapshot of removed) {
    const dropped = droppedMappings(
      mappings,
      deckId,
      snapshot.effect,
      remaining
    );
    const afterEffect = structuredClone(
      findEffectInTree(after, snapshot.effect.id)
    );
    let undone = false;
    toast.success(
      `${getEffectMetadata(snapshot.effect.type)?.name ?? snapshot.effect.type} ${reset ? "reset" : "removed"}`,
      {
        action: {
          label: "Undo",
          onClick: () => {
            if (undone) {
              return;
            }
            undone = true;
            const current = readTree();
            const currentEffect = findEffectInTree(current, snapshot.effect.id);
            if (reset && afterEffect && currentEffect) {
              const restored = recoverReset(
                snapshot.effect,
                afterEffect,
                currentEffect
              );
              const [location] = snapshots(
                current,
                (effect) => effect.id === currentEffect.id
              );
              if (location) {
                apply({
                  tree: restoreRemoved(
                    removeEffectFromTree(current, currentEffect.id),
                    { ...location, effect: restored }
                  ),
                  type: "replace",
                });
              }
            } else if (!currentEffect) {
              apply({
                tree: restoreRemoved(current, snapshot),
                type: "replace",
              });
            }
            restoreMappings(deckId, readTree(), dropped);
          },
        },
        duration: 8000,
      }
    );
  }
}
