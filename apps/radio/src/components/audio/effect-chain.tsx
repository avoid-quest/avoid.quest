/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { Label } from "@avoid.quest/ui/components/label";
import { cn } from "@avoid.quest/ui/lib/utils";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PlusIcon } from "lucide-react";
import {
  type Dispatch,
  type FocusEvent,
  type SetStateAction,
  useState,
} from "react";
import type { EffectConfig, EffectType } from "@/lib/audio";
import {
  clampEffectTempo,
  MAX_EFFECT_TEMPO,
  MIN_EFFECT_TEMPO,
} from "@/lib/audio/dsp/effects/tempo";
import { visitEffectTree } from "@/lib/audio/dsp/routing/effect-tree";
import { EffectItem } from "./effect-item";
import { EffectPicker } from "./effect-picker";

type EffectChainProps = {
  effects: EffectConfig[];
  onAddEffect: (type: EffectType) => void;
  onUpdateEffect: (effectId: string, config: Partial<EffectConfig>) => void;
  onRemoveEffect: (effectId: string) => void;
  onReorderEffects: (effectIds: string[]) => void;
  title?: string;
  showAddButton?: boolean;
  showEffectsList?: boolean;
  deckId?: "deck-a" | "deck-b";
  tempo?: number;
  onTempoChange?: (tempo: number) => void;
};

/**
 * Only delay-style effects follow the synced tempo. Containers forward tempo
 * to their nested chains, so search the whole tree, not just the top level.
 */
export function effectsUseTempo(effects: readonly EffectConfig[]): boolean {
  let usesTempo = false;
  visitEffectTree(effects, (effect) => {
    if ("tempoSync" in effect || "preSyncTimeLeft" in effect) {
      usesTempo = true;
    }
  });
  return usesTempo;
}

function ignoreEffectUpdate(_config: Partial<EffectConfig>) {
  return null;
}

function noop() {
  return null;
}

function EffectTempoControl({
  deckId,
  onTempoChange,
  tempo,
}: {
  deckId?: "deck-a" | "deck-b";
  onTempoChange: (tempo: number) => void;
  tempo: number;
}) {
  function updateTempo(event: FocusEvent<HTMLInputElement>) {
    const nextTempo = Number(event.target.value);
    if (Number.isFinite(nextTempo)) {
      onTempoChange(clampEffectTempo(nextTempo));
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Label
        className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider"
        htmlFor={`${deckId}-effects-tempo`}
      >
        Sync tempo
      </Label>
      <Input
        className="h-7 w-16 text-xs"
        defaultValue={tempo}
        id={`${deckId}-effects-tempo`}
        key={tempo}
        max={MAX_EFFECT_TEMPO}
        min={MIN_EFFECT_TEMPO}
        onBlur={updateTempo}
        step={0.1}
        type="number"
      />
      <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">
        bpm
      </span>
    </div>
  );
}

export function EffectChain({
  effects,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onReorderEffects,
  title,
  showAddButton = true,
  showEffectsList = true,
  deckId,
  tempo,
  onTempoChange,
}: EffectChainProps) {
  const [expandedEffectId, setExpandedEffectId] = useState<string | null>(null);
  // Hide the tempo field unless something in the tree follows it.
  const usesTempo = effectsUseTempo(effects);
  const [showPicker, setShowPicker] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleAddEffect(type: EffectType) {
    onAddEffect(type);
    setShowPicker(false);
  }

  function openPicker() {
    setShowPicker(true);
  }

  function closePicker() {
    setShowPicker(false);
  }

  // Local optimistic order — prevents snap-back when external store update
  // hasn't propagated yet at the time dnd-kit clears transforms on drag end
  const [localOrder, setLocalOrder] = useState<string[]>(() =>
    effects.map((effect) => effect.id)
  );

  // Sync local order when effects are added/removed externally.
  // We compare sorted ID sets to detect structural changes (add/remove)
  // without resetting on every reorder from the store.
  const [prevIdKey, setPrevIdKey] = useState(() =>
    effects
      .map((e) => e.id)
      .sort()
      .join(",")
  );
  const currentIdKey = effects
    .map((e) => e.id)
    .sort()
    .join(",");
  if (currentIdKey !== prevIdKey) {
    const added = effects
      .map((effect) => effect.id)
      .filter((id) => !localOrder.includes(id));
    setPrevIdKey(currentIdKey);
    setLocalOrder(effects.map((effect) => effect.id));
    if (added.length === 1 && added[0] !== undefined) {
      setExpandedEffectId(added[0]);
    }
  }

  const effectsById = new Map(effects.map((e) => [e.id, e]));
  const sortedEffects = localOrder
    .map((id) => effectsById.get(id))
    .filter((e): e is EffectConfig => e !== undefined);
  const sortedIds = sortedEffects.map((e) => e.id);

  const activeEffect = activeId ? (effectsById.get(activeId) ?? null) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = sortedIds.indexOf(active.id as string);
    const newIndex = sortedIds.indexOf(over.id as string);

    if (oldIndex !== -1 && newIndex !== -1) {
      const newOrder = arrayMove(sortedIds, oldIndex, newIndex);
      setLocalOrder(newOrder);
      onReorderEffects(newOrder);
    }
  }

  return (
    <div className="w-full min-w-0 space-y-2">
      {Boolean(title?.trim()) && (
        <div className="font-medium text-muted-foreground text-sm">{title}</div>
      )}

      {tempo !== undefined && onTempoChange !== undefined && usesTempo ? (
        <EffectTempoControl
          deckId={deckId}
          onTempoChange={onTempoChange}
          tempo={tempo}
        />
      ) : null}

      {showEffectsList ? (
        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          sensors={sensors}
        >
          <div className="space-y-2">
            <SortableContext
              items={sortedIds}
              strategy={verticalListSortingStrategy}
            >
              {sortedEffects.map((effect) => (
                <EffectListItem
                  deckId={deckId}
                  effect={effect}
                  expandedEffectId={expandedEffectId}
                  isDraggingAny={activeId !== null}
                  key={effect.id}
                  onRemoveEffect={onRemoveEffect}
                  onUpdateEffect={onUpdateEffect}
                  setExpandedEffectId={setExpandedEffectId}
                />
              ))}
            </SortableContext>
          </div>
          <DragOverlay>
            {activeEffect ? (
              <div className="scale-[1.02] rounded-lg shadow-lg ring-2 ring-primary/50">
                <EffectItem
                  effect={activeEffect}
                  isExpanded={false}
                  onExpand={noop}
                  onRemove={noop}
                  onUpdate={ignoreEffectUpdate}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : null}

      {showAddButton ? (
        <>
          <Button
            className="h-7 w-full text-xs"
            onClick={openPicker}
            size="sm"
            variant="outline"
          >
            <PlusIcon className="size-3.5" />
            Add effect
          </Button>

          {showPicker ? (
            <EffectPicker onClose={closePicker} onSelect={handleAddEffect} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function EffectListItem({
  deckId,
  effect,
  expandedEffectId,
  isDraggingAny,
  onRemoveEffect,
  onUpdateEffect,
  setExpandedEffectId,
}: {
  deckId?: "deck-a" | "deck-b";
  effect: EffectConfig;
  expandedEffectId: string | null;
  isDraggingAny: boolean;
  onRemoveEffect: (effectId: string) => void;
  onUpdateEffect: (effectId: string, config: Partial<EffectConfig>) => void;
  setExpandedEffectId: Dispatch<SetStateAction<string | null>>;
}) {
  function expand() {
    setExpandedEffectId((currentId) =>
      currentId === effect.id ? null : effect.id
    );
  }

  function remove() {
    onRemoveEffect(effect.id);
  }

  function update(config: Partial<EffectConfig>) {
    onUpdateEffect(effect.id, config);
  }

  return (
    <SortableEffectItem
      deckId={deckId}
      effect={effect}
      isDraggingAny={isDraggingAny}
      isExpanded={expandedEffectId === effect.id}
      onExpand={expand}
      onRemove={remove}
      onUpdate={update}
    />
  );
}

function SortableEffectItem({
  effect,
  isExpanded,
  isDraggingAny,
  onUpdate,
  onRemove,
  onExpand,
  deckId,
}: {
  effect: EffectConfig;
  isExpanded: boolean;
  isDraggingAny: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  onRemove: () => void;
  onExpand: () => void;
  deckId?: "deck-a" | "deck-b";
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: effect.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      className={cn(
        "rounded-lg transition-all duration-150",
        isDragging && "opacity-40",
        isDraggingAny && !isDragging && "opacity-75"
      )}
      ref={setNodeRef}
      style={style}
    >
      <EffectItem
        deckId={deckId}
        dragHandleAttributes={attributes}
        dragHandleListeners={listeners}
        dragHandleRef={setActivatorNodeRef}
        effect={effect}
        isDragging={isDragging}
        isExpanded={isExpanded}
        onExpand={onExpand}
        onRemove={onRemove}
        onUpdate={onUpdate}
      />
    </div>
  );
}
