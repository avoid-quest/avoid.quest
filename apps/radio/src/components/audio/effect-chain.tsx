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
import { useState } from "react";
import type { EffectConfig, EffectType } from "@/lib/audio";
import {
  clampEffectTempo,
  MAX_EFFECT_TEMPO,
  MIN_EFFECT_TEMPO,
} from "@/lib/audio/dsp/effects/tempo";
import { serializeEffectOrder } from "@/lib/effect-order";
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

  const handleAddEffect = (type: EffectType) => {
    onAddEffect(type);
    setShowPicker(false);
  };

  // Local optimistic order — prevents snap-back when external store update
  // hasn't propagated yet at the time dnd-kit clears transforms on drag end
  const [localOrder, setLocalOrder] = useState<string[]>(() =>
    serializeEffectOrder(effects)
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
    setPrevIdKey(currentIdKey);
    setLocalOrder(serializeEffectOrder(effects));
  }

  const effectsById = new Map(effects.map((e) => [e.id, e]));
  const sortedEffects = localOrder
    .map((id) => effectsById.get(id))
    .filter((e): e is EffectConfig => e !== undefined);
  const sortedIds = sortedEffects.map((e) => e.id);

  const activeEffect = activeId ? (effectsById.get(activeId) ?? null) : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
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
  };

  return (
    <div className="w-full min-w-0 space-y-2">
      {title?.trim() && (
        <div className="font-medium text-muted-foreground text-sm">{title}</div>
      )}

      {tempo !== undefined && onTempoChange && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/20 p-2">
          <Label className="flex-1 text-xs" htmlFor={`${deckId}-effects-tempo`}>
            Synced effect tempo
          </Label>
          <Input
            className="h-8 w-24"
            defaultValue={tempo}
            id={`${deckId}-effects-tempo`}
            key={tempo}
            max={MAX_EFFECT_TEMPO}
            min={MIN_EFFECT_TEMPO}
            onBlur={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                onTempoChange(clampEffectTempo(value));
              }
            }}
            step={0.1}
            type="number"
          />
          <span className="text-muted-foreground text-xs">BPM</span>
        </div>
      )}

      {showEffectsList && (
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
                <SortableEffectItem
                  deckId={deckId}
                  effect={effect}
                  isDraggingAny={activeId !== null}
                  isExpanded={expandedEffectId === effect.id}
                  key={effect.id}
                  onExpand={() =>
                    setExpandedEffectId(
                      expandedEffectId === effect.id ? null : effect.id
                    )
                  }
                  onRemove={() => onRemoveEffect(effect.id)}
                  onUpdate={(config) => onUpdateEffect(effect.id, config)}
                />
              ))}
            </SortableContext>
            {sortedEffects.length >= 2 && (
              <p className="py-1 text-center text-muted-foreground text-xs">
                Drag to reorder
              </p>
            )}
          </div>
          <DragOverlay>
            {activeEffect ? (
              <div className="scale-[1.02] rounded-lg shadow-lg ring-2 ring-primary/50">
                <EffectItem
                  effect={activeEffect}
                  isExpanded={false}
                  onExpand={() => undefined}
                  onRemove={() => undefined}
                  onUpdate={() => undefined}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {showAddButton && (
        <>
          <Button
            className="w-full"
            onClick={() => setShowPicker(true)}
            size="sm"
            variant="outline"
          >
            <PlusIcon className="mr-2 size-4" />
            Add Effect
          </Button>

          {showPicker && (
            <EffectPicker
              onClose={() => setShowPicker(false)}
              onSelect={handleAddEffect}
            />
          )}
        </>
      )}
    </div>
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
